import { randomUUID } from 'node:crypto';
import {
  type BracketMatch,
  GAME_RULES,
  TOURNAMENT_ROUNDS,
  type TournamentPlayer,
  type TournamentState,
  type TournamentSummary,
} from '@swcup/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Env } from '../../config/env';
import type { Db } from '../../db/client';
import {
  countryPointsLedger,
  countrySeasonScores,
  currencyLedger,
  playerStats,
  tournamentEntries,
  tournaments,
  users,
} from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { TimerWheel } from '../../lib/timers';
import { type Redis, withLock } from '../../redis/client';
import { keys } from '../../redis/keys';
import { type Realtime, tournamentRoom } from '../../socket/realtime';
import type { EconomyService } from '../economy/service';
import type { MatchFinishedEvent, MatchService } from '../match/service';
import type { Matchmaker } from '../matchmaking/service';
import type { PuzzlePool } from '../puzzles/pool';
import {
  BOT_CUP_CHAMPION_COUNTRY_BONUS,
  CHAMPION_COUNTRY_BONUS,
  placementForElimination,
  TOURNAMENT_PLACEMENT_COINS,
} from '../rating/rewards';
import type { SeasonClock } from '../seasons/service';
import type { UserService } from '../users/service';

interface TournamentRecord {
  id: string;
  status: TournamentState['status'];
  createdAt: number;
  fillAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  players: TournamentPlayer[];
  rounds: BracketMatch[][];
  roundPuzzles: number[];
  championId: string | null;
  seasonId: number | null;
}

/** Standard seeding: seeds 1 and 2 can only meet in the final. */
export const SEED_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];
const LOBBY_LOCK = 'tournament-lobby';
const NEXT_ROUND_DELAY_MS = 8_000;
const LOCK_OPTIONS = { ttlMs: 30_000, waitMs: 30_000 };

export function emptyBracket(size: number): BracketMatch[][] {
  const rounds: BracketMatch[][] = [];
  for (let round = 0, n = size / 2; n >= 1; round++, n /= 2) {
    rounds.push(
      Array.from({ length: n }, (_, slot) => ({
        round,
        slot,
        a: null,
        b: null,
        winner: null,
        matchId: null,
        status: 'pending' as const,
        simulated: false,
      })),
    );
  }
  return rounds;
}

/** Elo-style win probability from trophies, used only for bot-vs-bot ties. */
export function simulatedWinner(a: TournamentPlayer, b: TournamentPlayer, random: () => number): string {
  const pA = 1 / (1 + 10 ** ((b.trophies - a.trophies) / 800));
  return random() < pA ? a.userId : b.userId;
}

/**
 * 16-player knockout cups. The lobby fills with people for
 * TOURNAMENT_FILL_MS, then bots take the empty seats. Every match of a round
 * uses the same puzzle, difficulty rises each round, and bot-vs-bot ties are
 * simulated so humans never wait on them.
 */
export class TournamentService {
  private matchmaker: Matchmaker | null = null;

  constructor(
    private readonly deps: {
      db: Db;
      redis: Redis;
      env: Env;
      log: Logger;
      timers: TimerWheel;
      realtime: Realtime;
      users: UserService;
      matches: MatchService;
      pool: PuzzlePool;
      seasons: SeasonClock;
      economy: EconomyService;
    },
  ) {
    deps.timers.on('tfill', (id) => this.onFillDeadline(id));
    deps.timers.on('tlaunch', (arg) => {
      const [id, round, slot] = arg.split(':');
      return this.locked(id!, async (rec) => {
        await this.launch(rec, Number(round), Number(slot));
      });
    });
    deps.matches.onFinished((event) => this.onMatchFinished(event));
  }

  attachMatchmaker(matchmaker: Matchmaker): void {
    this.matchmaker = matchmaker;
  }

  // ------------------------------------------------------------- storage

  private async load(id: string): Promise<TournamentRecord | null> {
    const raw = await this.deps.redis.get(keys.tournament(id));
    return raw ? (JSON.parse(raw) as TournamentRecord) : null;
  }

  private async save(rec: TournamentRecord): Promise<void> {
    const ttl = rec.status === 'finished' ? 3600 : 6 * 3600;
    await this.deps.redis.set(keys.tournament(rec.id), JSON.stringify(rec), 'EX', ttl);
  }

  private async locked(id: string, fn: (rec: TournamentRecord) => Promise<void>): Promise<void> {
    await withLock(
      this.deps.redis,
      `tournament:${id}`,
      async () => {
        const rec = await this.load(id);
        if (!rec) return;
        await fn(rec);
        await this.save(rec);
        this.broadcast(rec);
      },
      LOCK_OPTIONS,
    );
  }

  toState(rec: TournamentRecord): TournamentState {
    return {
      id: rec.id,
      status: rec.status,
      size: GAME_RULES.tournamentSize,
      players: rec.players,
      fillAt: rec.fillAt,
      startedAt: rec.startedAt,
      finishedAt: rec.finishedAt,
      rounds: rec.rounds,
      championId: rec.championId,
      serverNow: Date.now(),
    };
  }

  private broadcast(rec: TournamentRecord): void {
    this.deps.realtime.toRoom(tournamentRoom(rec.id)).emit('tournament:state', this.toState(rec));
  }

  // ---------------------------------------------------------------- lobby

  async join(userId: string): Promise<TournamentState> {
    const { redis, matches, users, timers, realtime, env } = this.deps;
    if (await matches.activeMatchOf(userId))
      throw new AppError('already_in_match', 'Finish your current match first');
    await this.matchmaker?.leave(userId);

    const current = await redis.get(keys.userTournament(userId));
    if (current) {
      const rec = await this.load(current);
      if (rec && rec.status !== 'finished') {
        realtime.joinRoom(userId, tournamentRoom(rec.id));
        return this.toState(rec);
      }
      await redis.del(keys.userTournament(userId));
    }

    const profile = await users.getCompetitive(userId);
    let state: TournamentState | null = null;
    await withLock(
      redis,
      LOBBY_LOCK,
      async () => {
        const lobbyId = await redis.get(keys.tournamentLobby);
        let rec = lobbyId ? await this.load(lobbyId) : null;
        if (rec?.status !== 'lobby') {
          const now = Date.now();
          rec = {
            id: randomUUID(),
            status: 'lobby',
            createdAt: now,
            fillAt: now + env.TOURNAMENT_FILL_MS,
            startedAt: null,
            finishedAt: null,
            players: [],
            rounds: emptyBracket(GAME_RULES.tournamentSize),
            roundPuzzles: [],
            championId: null,
            seasonId: null,
          };
          await redis.set(keys.tournamentLobby, rec.id);
          await timers.schedule('tfill', rec.id, rec.fillAt!);
        }
        if (!rec.players.some((p) => p.userId === userId)) {
          rec.players.push({
            userId,
            username: profile.username,
            countryCode: profile.countryCode,
            avatar: profile.avatar,
            isBot: false,
            trophies: profile.trophies,
          });
        }
        await redis.set(keys.userTournament(userId), rec.id, 'EX', 6 * 3600);
        realtime.joinRoom(userId, tournamentRoom(rec.id));
        if (rec.players.length >= GAME_RULES.tournamentSize) {
          await timers.cancel('tfill', rec.id);
          await withLock(redis, `tournament:${rec.id}`, () => this.start(rec!), LOCK_OPTIONS);
        }
        await this.save(rec);
        this.broadcast(rec);
        state = this.toState(rec);
      },
      LOCK_OPTIONS,
    );
    return state!;
  }

  async leave(userId: string): Promise<void> {
    const { redis, realtime, timers } = this.deps;
    const id = await redis.get(keys.userTournament(userId));
    if (!id) return;
    await withLock(redis, LOBBY_LOCK, async () => {
      const rec = await this.load(id);
      if (rec && rec.status !== 'lobby')
        throw new AppError('tournament_closed', 'The tournament has already started');
      await redis.del(keys.userTournament(userId));
      realtime.leaveRoom(userId, tournamentRoom(id));
      if (!rec) return;
      rec.players = rec.players.filter((p) => p.userId !== userId);
      if (rec.players.every((p) => p.isBot)) {
        await timers.cancel('tfill', id);
        await redis.del(keys.tournament(id));
        if ((await redis.get(keys.tournamentLobby)) === id) await redis.del(keys.tournamentLobby);
        return;
      }
      await this.save(rec);
      this.broadcast(rec);
    });
  }

  /** Live state from Redis, or the archived bracket from Postgres. */
  async get(id: string): Promise<TournamentState> {
    const rec = await this.load(id);
    return rec ? this.toState(rec) : this.fromDatabase(id);
  }

  /** Like `get`, and subscribes the user's sockets to live updates while the cup runs. */
  async watch(userId: string, id: string): Promise<TournamentState> {
    const state = await this.get(id);
    if (state.status !== 'finished') this.deps.realtime.joinRoom(userId, tournamentRoom(id));
    return state;
  }

  async current(): Promise<TournamentState | null> {
    const id = await this.deps.redis.get(keys.tournamentLobby);
    const rec = id ? await this.load(id) : null;
    return rec ? this.toState(rec) : null;
  }

  async handleReconnect(userId: string): Promise<void> {
    const id = await this.deps.redis.get(keys.userTournament(userId));
    if (!id) return;
    const rec = await this.load(id);
    if (!rec) {
      await this.deps.redis.del(keys.userTournament(userId));
      return;
    }
    this.deps.realtime.joinRoom(userId, tournamentRoom(id));
    this.deps.realtime.toUser(userId).emit('tournament:state', this.toState(rec));
  }

  private async onFillDeadline(id: string): Promise<void> {
    const { redis } = this.deps;
    await withLock(
      redis,
      LOBBY_LOCK,
      async () => {
        const rec = await this.load(id);
        if (rec?.status !== 'lobby') return;
        if (!rec.players.some((p) => !p.isBot)) {
          await redis.del(keys.tournament(id));
          if ((await redis.get(keys.tournamentLobby)) === id) await redis.del(keys.tournamentLobby);
          return;
        }
        await this.fillWithBots(rec);
        await withLock(redis, `tournament:${id}`, () => this.start(rec), LOCK_OPTIONS);
        await this.save(rec);
        this.broadcast(rec);
      },
      LOCK_OPTIONS,
    );
  }

  private async fillWithBots(rec: TournamentRecord): Promise<void> {
    const humans = rec.players.filter((p) => !p.isBot);
    const avgTrophies = humans.reduce((s, p) => s + p.trophies, 0) / Math.max(1, humans.length);
    const needed = GAME_RULES.tournamentSize - rec.players.length;
    const rows = await this.deps.db
      .select({ user: users, trophies: playerStats.trophies })
      .from(users)
      .innerJoin(playerStats, eq(playerStats.userId, users.id))
      .where(eq(users.isBot, true))
      .orderBy(sql`abs(${playerStats.trophies} - ${avgTrophies}) + random() * 400`)
      .limit(needed);
    for (const { user, trophies } of rows) {
      rec.players.push({
        userId: user.id,
        username: user.username,
        countryCode: user.countryCode,
        avatar: user.avatar,
        isBot: true,
        trophies,
      });
    }
  }

  // ---------------------------------------------------------------- bracket

  private async start(rec: TournamentRecord): Promise<void> {
    const { db, pool, seasons, redis } = this.deps;
    const now = Date.now();
    const season = await seasons.get();
    const seeded = [...rec.players].sort((a, b) => b.trophies - a.trophies);
    const order = SEED_ORDER.map((s) => seeded[s - 1]!.userId);
    rec.rounds = emptyBracket(GAME_RULES.tournamentSize);
    rec.rounds[0]!.forEach((m, slot) => {
      m.a = order[slot * 2]!;
      m.b = order[slot * 2 + 1]!;
    });
    const humanIds = rec.players.filter((p) => !p.isBot).map((p) => p.userId);
    rec.roundPuzzles = [];
    for (const difficulty of GAME_RULES.tournamentRoundDifficulties) {
      rec.roundPuzzles.push((await pool.pick(difficulty, humanIds)).id);
    }
    rec.status = 'running';
    rec.startedAt = now;
    rec.fillAt = null;
    rec.seasonId = season.id;
    if ((await redis.get(keys.tournamentLobby)) === rec.id) await redis.del(keys.tournamentLobby);

    await db.transaction(async (tx) => {
      await tx.insert(tournaments).values({
        id: rec.id,
        seasonId: season.id,
        size: GAME_RULES.tournamentSize,
        humanPlayers: humanIds.length,
        startedAt: new Date(now),
        bracket: rec.rounds,
      });
      await tx
        .insert(tournamentEntries)
        .values(seeded.map((p, i) => ({ tournamentId: rec.id, userId: p.userId, bracketSeed: i + 1 })));
    });
    this.deps.log.info({ tournamentId: rec.id, humans: humanIds.length }, 'tournament started');
    // Persist the running bracket before any match:found goes out, so clients can fetch it.
    await this.save(rec);
    for (let slot = 0; slot < rec.rounds[0]!.length; slot++) await this.launch(rec, 0, slot);
  }

  private player(rec: TournamentRecord, userId: string): TournamentPlayer {
    return rec.players.find((p) => p.userId === userId)!;
  }

  private async launch(rec: TournamentRecord, round: number, slot: number): Promise<void> {
    const match = rec.rounds[round]?.[slot];
    if (match?.status !== 'pending' || !match.a || !match.b) return;
    const a = this.player(rec, match.a);
    const b = this.player(rec, match.b);
    if (a.isBot && b.isBot) {
      const winner = simulatedWinner(a, b, Math.random);
      match.winner = winner;
      match.status = 'finished';
      match.simulated = true;
      await this.eliminate(rec, winner === a.userId ? b.userId : a.userId, round);
      await this.advance(rec, round, slot, winner);
      return;
    }
    match.matchId = await this.deps.matches.create({
      type: 'tournament',
      difficulty: GAME_RULES.tournamentRoundDifficulties[round] ?? 'medium',
      playerIds: [match.a, match.b],
      ...(rec.roundPuzzles[round] ? { puzzleId: rec.roundPuzzles[round] } : {}),
      tournament: { id: rec.id, round, slot },
    });
    match.status = 'live';
  }

  private async advance(rec: TournamentRecord, round: number, slot: number, winner: string): Promise<void> {
    if (round === TOURNAMENT_ROUNDS - 1) {
      await this.finishTournament(rec, winner);
      return;
    }
    const next = rec.rounds[round + 1]![slot >> 1]!;
    if (slot % 2 === 0) next.a = winner;
    else next.b = winner;
    if (!next.a || !next.b) return;
    const humansInvolved = !this.player(rec, next.a).isBot || !this.player(rec, next.b).isBot;
    if (humansInvolved) {
      // Give players a moment on the result screen before the next kick-off.
      await this.deps.timers.schedule(
        'tlaunch',
        `${rec.id}:${round + 1}:${slot >> 1}`,
        Date.now() + NEXT_ROUND_DELAY_MS,
      );
    } else {
      await this.launch(rec, round + 1, slot >> 1);
    }
  }

  private async onMatchFinished(event: MatchFinishedEvent): Promise<void> {
    if (!event.tournament) return;
    const { id, round, slot } = event.tournament;
    await this.locked(id, async (rec) => {
      const match = rec.rounds[round]?.[slot];
      if (!match || match.status === 'finished' || !match.a || !match.b) return;
      const winner = event.winnerId ?? (Math.random() < 0.5 ? match.a : match.b);
      match.winner = winner;
      match.status = 'finished';
      await this.eliminate(rec, winner === match.a ? match.b : match.a, round);
      await this.advance(rec, round, slot, winner);
    });
  }

  /** Records a knockout and pays the eliminated human their placement coins right away. */
  private async eliminate(rec: TournamentRecord, userId: string, round: number): Promise<void> {
    const { db, redis } = this.deps;
    const place = placementForElimination(round);
    await db
      .update(tournamentEntries)
      .set({ eliminatedRound: round, finalPlace: place })
      .where(and(eq(tournamentEntries.tournamentId, rec.id), eq(tournamentEntries.userId, userId)));
    if (this.player(rec, userId).isBot) return;
    await redis.del(keys.userTournament(userId));
    const coins = TOURNAMENT_PLACEMENT_COINS[place] ?? 0;
    await db.transaction(async (tx) => {
      const [paid] = await tx
        .insert(currencyLedger)
        .values({ userId, delta: coins, reason: 'tournament', refId: rec.id })
        .onConflictDoNothing()
        .returning({ id: currencyLedger.id });
      if (paid) {
        await tx
          .update(playerStats)
          .set({ coins: sql`${playerStats.coins} + ${coins}` })
          .where(eq(playerStats.userId, userId));
      }
    });
  }

  private async finishTournament(rec: TournamentRecord, championId: string): Promise<void> {
    const { db, redis, economy, log } = this.deps;
    rec.status = 'finished';
    rec.championId = championId;
    rec.finishedAt = Date.now();
    const champion = this.player(rec, championId);
    const humans = rec.players.filter((p) => !p.isBot).length;

    await db.transaction(async (tx) => {
      await tx
        .update(tournaments)
        .set({ status: 'finished', finishedAt: new Date(rec.finishedAt!), championId, bracket: rec.rounds })
        .where(eq(tournaments.id, rec.id));
      await tx
        .update(tournamentEntries)
        .set({ finalPlace: 1 })
        .where(and(eq(tournamentEntries.tournamentId, rec.id), eq(tournamentEntries.userId, championId)));
      if (champion.isBot) return;
      const coins = TOURNAMENT_PLACEMENT_COINS[1]!;
      const [paid] = await tx
        .insert(currencyLedger)
        .values({ userId: championId, delta: coins, reason: 'tournament', refId: rec.id })
        .onConflictDoNothing()
        .returning({ id: currencyLedger.id });
      if (!paid) return;
      const [stats] = await tx
        .update(playerStats)
        .set({
          coins: sql`${playerStats.coins} + ${coins}`,
          tournamentWins: sql`${playerStats.tournamentWins} + 1`,
        })
        .where(eq(playerStats.userId, championId))
        .returning();
      if (rec.seasonId) {
        // A cup won against bots alone still counts, just for much less.
        const bonus = humans >= 2 ? CHAMPION_COUNTRY_BONUS : BOT_CUP_CHAMPION_COUNTRY_BONUS;
        const [awarded] = await tx
          .insert(countryPointsLedger)
          .values({
            seasonId: rec.seasonId,
            countryCode: champion.countryCode,
            userId: championId,
            points: bonus,
            reason: 'tournament_champion',
            refId: rec.id,
          })
          .onConflictDoNothing()
          .returning({ id: countryPointsLedger.id });
        if (awarded) {
          await tx
            .insert(countrySeasonScores)
            .values({ seasonId: rec.seasonId, countryCode: champion.countryCode, points: bonus })
            .onConflictDoUpdate({
              target: [countrySeasonScores.seasonId, countrySeasonScores.countryCode],
              set: { points: sql`${countrySeasonScores.points} + ${bonus}` },
            });
        }
      }
      if (stats) {
        await economy.grantEarned(tx, championId, {
          trophies: stats.trophies,
          wins: stats.wins,
          tournamentWins: stats.tournamentWins,
        });
      }
    });
    if (!champion.isBot) await redis.del(keys.userTournament(championId));
    log.info({ tournamentId: rec.id, champion: champion.username }, 'tournament finished');
  }

  // ----------------------------------------------------------------- reads

  private async fromDatabase(id: string): Promise<TournamentState> {
    const [row] = await this.deps.db.select().from(tournaments).where(eq(tournaments.id, id)).limit(1);
    if (!row) throw new AppError('not_found', 'Tournament not found');
    const entries = await this.deps.db
      .select({ user: users, trophies: playerStats.trophies })
      .from(tournamentEntries)
      .innerJoin(users, eq(users.id, tournamentEntries.userId))
      .innerJoin(playerStats, eq(playerStats.userId, users.id))
      .where(eq(tournamentEntries.tournamentId, id));
    return {
      id,
      status: row.status,
      size: row.size,
      players: entries.map(({ user, trophies }) => ({
        userId: user.id,
        username: user.username,
        countryCode: user.countryCode,
        avatar: user.avatar,
        isBot: user.isBot,
        trophies,
      })),
      fillAt: null,
      startedAt: row.startedAt.getTime(),
      finishedAt: row.finishedAt?.getTime() ?? null,
      rounds: row.bracket as BracketMatch[][],
      championId: row.championId,
      serverNow: Date.now(),
    };
  }

  async recent(limit = 10): Promise<TournamentSummary[]> {
    const rows = await this.deps.db
      .select()
      .from(tournaments)
      .orderBy(desc(tournaments.startedAt))
      .limit(limit);
    const championIds = rows.map((r) => r.championId).filter((id): id is string => Boolean(id));
    const champions = championIds.length
      ? await this.deps.db
          .select({
            id: users.id,
            username: users.username,
            countryCode: users.countryCode,
            isBot: users.isBot,
          })
          .from(users)
          .where(inArray(users.id, championIds))
      : [];
    return rows.map((r) => {
      const c = champions.find((x) => x.id === r.championId);
      return {
        id: r.id,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        champion: c ? { username: c.username, countryCode: c.countryCode, isBot: c.isBot } : null,
        humanPlayers: r.humanPlayers,
      };
    });
  }
}
