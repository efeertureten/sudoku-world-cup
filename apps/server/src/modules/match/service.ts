import { randomUUID } from 'node:crypto';
import {
  type Difficulty,
  type EmoteId,
  GAME_RULES,
  leagueForTrophies,
  type MatchEndPayload,
  type MatchEndReason,
  type MatchResultEntry,
  type MatchResumePayload,
  type MatchType,
  type MoveAck,
  type MoveRejectReason,
  type MoveVerdict,
} from '@swcup/shared';
import { and, eq, gte, like, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Env } from '../../config/env';
import type { Db } from '../../db/client';
import {
  anticheatFlags,
  countryPointsLedger,
  countrySeasonScores,
  currencyLedger,
  type MoveRecord,
  matches,
  matchParticipants,
  playerStats,
} from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { TimerWheel } from '../../lib/timers';
import type { Redis } from '../../redis/client';
import { keys, MATCH_TTL_SECONDS } from '../../redis/keys';
import type { Realtime } from '../../socket/realtime';
import { analyzeMoves, type CheatAnalysis } from '../anticheat/analyzer';
import type { EconomyService } from '../economy/service';
import type { PuzzlePool } from '../puzzles/pool';
import { glicko2Update } from '../rating/glicko2';
import { cappedBotPoints, countryPoints, matchCoins, type Outcome, trophyDelta } from '../rating/rewards';
import type { SeasonClock } from '../seasons/service';
import { type CompetitiveProfile, competitiveToPublic, type UserService } from '../users/service';

export type LiveStatus = 'ready_check' | 'countdown' | 'in_progress';
export type MatchStatus = LiveStatus | 'finished' | 'aborted';

export interface MatchMeta {
  id: string;
  type: MatchType;
  difficulty: Difficulty;
  puzzleId: number;
  seed: number;
  givens: string;
  solution: string;
  totalEmpty: number;
  status: MatchStatus;
  players: [string, string];
  bots: string[];
  readyDeadline: number;
  startsAt: number | null;
  startedAt: number | null;
  endsAt: number | null;
  winner: string | null;
  endReason: MatchEndReason | null;
  endedAt: number | null;
  tournamentId: string | null;
  round: number | null;
  slot: number | null;
}

export interface PlayerState {
  board: string;
  filled: number;
  mistakes: number;
  lockedUntil: number;
  lastSeq: number;
  ready: boolean;
  connected: boolean;
  lastCorrectAt: number;
  finishedAt: number | null;
}

export interface CreateMatchOptions {
  type: MatchType;
  difficulty: Difficulty;
  playerIds: [string, string];
  puzzleId?: number;
  tournament?: { id: string; round: number; slot: number };
}

export interface MatchFinishedEvent {
  matchId: string;
  type: MatchType;
  winnerId: string | null;
  loserId: string | null;
  tournament: { id: string; round: number; slot: number } | null;
}

interface BotDriver {
  begin(matchId: string, botId: string): Promise<void>;
  prepare(
    matchId: string,
    bot: CompetitiveProfile,
    humanId: string | null,
    difficulty: Difficulty,
  ): Promise<void>;
}

const LIVE: ReadonlySet<string> = new Set(['ready_check', 'countdown', 'in_progress']);
/** Ledger reasons for points won against bots end with this, so the daily cap can find them. */
const BOT_REASON_SUFFIX = '_bot';

/**
 * Server-authoritative match lifecycle:
 *   ready_check -> countdown -> in_progress -> finished
 *                                           \-> aborted (nobody showed up)
 * Live state lives in Redis; the finished match is persisted to Postgres in a
 * single transaction by `finalize`, which is idempotent.
 */
export class MatchService {
  private readonly finishedListeners: ((event: MatchFinishedEvent) => Promise<void>)[] = [];
  private bots: BotDriver | null = null;

  constructor(
    private readonly deps: {
      db: Db;
      redis: Redis;
      log: Logger;
      env: Env;
      timers: TimerWheel;
      realtime: Realtime;
      pool: PuzzlePool;
      users: UserService;
      seasons: SeasonClock;
      economy: EconomyService;
    },
  ) {
    const { timers } = deps;
    timers.on('ready', (id) => this.onReadyTimeout(id));
    timers.on('start', (id) => this.onStart(id));
    timers.on('timeout', (id) => this.onTimeLimit(id));
    timers.on('grace', (arg) => {
      const [matchId, userId] = arg.split(':') as [string, string];
      return this.onGraceExpired(matchId, userId);
    });
  }

  attachBots(driver: BotDriver): void {
    this.bots = driver;
  }

  onFinished(listener: (event: MatchFinishedEvent) => Promise<void>): void {
    this.finishedListeners.push(listener);
  }

  // ------------------------------------------------------------------ reads

  async getMeta(matchId: string): Promise<MatchMeta | null> {
    const h = await this.deps.redis.hgetall(keys.match(matchId));
    if (!h.id) return null;
    const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));
    return {
      id: h.id,
      type: h.type as MatchType,
      difficulty: h.difficulty as Difficulty,
      puzzleId: Number(h.puzzleId),
      seed: Number(h.seed),
      givens: h.givens!,
      solution: h.solution!,
      totalEmpty: Number(h.totalEmpty),
      status: h.status as MatchStatus,
      players: h.players!.split(',') as [string, string],
      bots: h.bots ? h.bots.split(',') : [],
      readyDeadline: Number(h.readyDeadline),
      startsAt: num(h.startsAt),
      startedAt: num(h.startedAt),
      endsAt: num(h.endsAt),
      winner: h.winner ?? null,
      endReason: (h.endReason as MatchEndReason) ?? null,
      endedAt: num(h.endedAt),
      tournamentId: h.tournamentId || null,
      round: num(h.round),
      slot: num(h.slot),
    };
  }

  async getPlayerState(matchId: string, userId: string): Promise<PlayerState> {
    const h = await this.deps.redis.hgetall(keys.matchPlayer(matchId, userId));
    return {
      board: h.board ?? '',
      filled: Number(h.filled ?? 0),
      mistakes: Number(h.mistakes ?? 0),
      lockedUntil: Number(h.lockedUntil ?? 0),
      lastSeq: Number(h.lastSeq ?? 0),
      ready: h.ready === '1',
      connected: h.connected !== '0',
      lastCorrectAt: Number(h.lastCorrectAt ?? 0),
      finishedAt: h.finishedAt ? Number(h.finishedAt) : null,
    };
  }

  async activeMatchOf(userId: string): Promise<MatchMeta | null> {
    const matchId = await this.deps.redis.get(keys.userMatch(userId));
    if (!matchId) return null;
    const meta = await this.getMeta(matchId);
    if (!meta || !LIVE.has(meta.status)) {
      await this.deps.redis.del(keys.userMatch(userId));
      return null;
    }
    return meta;
  }

  // --------------------------------------------------------------- lifecycle

  async create(options: CreateMatchOptions): Promise<string> {
    const { redis, pool, users, timers, realtime } = this.deps;
    const profiles = await users.getCompetitiveMany(options.playerIds);
    if (profiles.length !== 2) throw new Error('Both players must exist');
    const humans = profiles.filter((p) => !p.isBot);
    const bots = profiles.filter((p) => p.isBot);

    const puzzle = options.puzzleId
      ? await pool.load(options.puzzleId)
      : await pool.pick(
          options.difficulty,
          humans.map((h) => h.id),
        );
    await pool.markSeen(
      humans.map((h) => h.id),
      puzzle.id,
    );

    const id = randomUUID();
    const now = Date.now();
    const readyDeadline = now + GAME_RULES.readyCheckMs;
    const totalEmpty = [...puzzle.givens].filter((c) => c === '0').length;

    const pipeline = redis.multi();
    pipeline.hset(keys.match(id), {
      id,
      type: options.type,
      difficulty: puzzle.difficulty,
      puzzleId: puzzle.id,
      seed: puzzle.generatorSeed,
      givens: puzzle.givens,
      solution: puzzle.solution,
      totalEmpty,
      status: 'ready_check',
      players: options.playerIds.join(','),
      bots: bots.map((b) => b.id).join(','),
      readyDeadline,
      createdAt: now,
      tournamentId: options.tournament?.id ?? '',
      round: options.tournament?.round ?? '',
      slot: options.tournament?.slot ?? '',
    });
    pipeline.expire(keys.match(id), MATCH_TTL_SECONDS);
    for (const p of profiles) {
      const playerKey = keys.matchPlayer(id, p.id);
      pipeline.hset(playerKey, {
        board: puzzle.givens,
        filled: 0,
        mistakes: 0,
        lockedUntil: 0,
        lastSeq: 0,
        lastCorrectAt: 0,
        ready: p.isBot ? 1 : 0,
        connected: 1,
      });
      pipeline.expire(playerKey, MATCH_TTL_SECONDS);
      if (p.isBot) pipeline.sadd(keys.busyBots, p.id);
      else pipeline.set(keys.userMatch(p.id), id, 'EX', MATCH_TTL_SECONDS);
    }
    await pipeline.exec();
    await timers.schedule('ready', id, readyDeadline);

    for (const bot of bots) {
      const human = humans[0]?.id ?? null;
      await this.bots?.prepare(id, bot, human, puzzle.difficulty);
    }

    for (const me of humans) {
      const opponent = profiles.find((p) => p.id !== me.id)!;
      realtime.toUser(me.id).emit('match:found', {
        matchId: id,
        type: options.type,
        difficulty: puzzle.difficulty,
        you: competitiveToPublic(me),
        opponent: competitiveToPublic(opponent),
        readyDeadline,
        ...(options.tournament
          ? { tournament: { id: options.tournament.id, round: options.tournament.round } }
          : {}),
      });
    }
    this.deps.log.info({ matchId: id, type: options.type, players: options.playerIds }, 'match created');
    if (humans.length === 0) await this.beginCountdown(id);
    return id;
  }

  async markReady(matchId: string, userId: string): Promise<void> {
    const meta = await this.requireParticipant(matchId, userId);
    if (meta.status !== 'ready_check') return;
    const { redis } = this.deps;
    await redis.hset(keys.matchPlayer(matchId, userId), 'ready', 1);
    const flags = await Promise.all(
      meta.players.map((p) => redis.hget(keys.matchPlayer(matchId, p), 'ready')),
    );
    if (flags.every((f) => f === '1')) await this.beginCountdown(matchId);
  }

  private async beginCountdown(matchId: string): Promise<void> {
    const { redis, timers } = this.deps;
    const now = Date.now();
    const startsAt = now + GAME_RULES.countdownMs;
    const ok = await redis.swcTransition(
      keys.match(matchId),
      'ready_check',
      'countdown',
      'startsAt',
      startsAt,
    );
    if (!ok) return;
    await timers.cancel('ready', matchId);
    await timers.schedule('start', matchId, startsAt);
    const meta = (await this.getMeta(matchId))!;
    for (const userId of this.humans(meta)) {
      this.deps.realtime.toUser(userId).emit('match:countdown', { matchId, startsAt, serverNow: now });
    }
  }

  private async onStart(matchId: string): Promise<void> {
    const { redis, timers, env } = this.deps;
    const now = Date.now();
    const endsAt = now + env.MATCH_TIME_LIMIT_MS;
    const ok = await redis.swcTransition(
      keys.match(matchId),
      'countdown',
      'in_progress',
      'startedAt',
      now,
      'endsAt',
      endsAt,
    );
    if (!ok) return;
    await timers.schedule('timeout', matchId, endsAt);
    const meta = (await this.getMeta(matchId))!;
    for (const userId of this.humans(meta)) {
      this.deps.realtime.toUser(userId).emit('match:start', {
        matchId,
        givens: meta.givens,
        difficulty: meta.difficulty,
        startedAt: now,
        endsAt,
        serverNow: now,
        totalEmpty: meta.totalEmpty,
      });
    }
    for (const botId of meta.bots) await this.bots?.begin(matchId, botId);
  }

  private async onReadyTimeout(matchId: string): Promise<void> {
    const meta = await this.getMeta(matchId);
    if (meta?.status !== 'ready_check') return;
    const states = await Promise.all(meta.players.map((p) => this.getPlayerState(matchId, p)));
    const ready = meta.players.filter((_, i) => states[i]!.ready);
    if (ready.length === 1) {
      await this.finish(matchId, ready[0]!, 'no_show');
    } else if (meta.tournamentId) {
      // A bracket needs a winner even if nobody showed up.
      await this.finish(matchId, meta.players[Math.floor(Math.random() * 2)]!, 'no_show');
    } else {
      await this.abort(meta);
    }
  }

  private async onTimeLimit(matchId: string): Promise<void> {
    const meta = await this.getMeta(matchId);
    if (meta?.status !== 'in_progress') return;
    const [a, b] = meta.players;
    const [sa, sb] = await Promise.all([this.getPlayerState(matchId, a), this.getPlayerState(matchId, b)]);
    let winner: string | null = null;
    if (sa.filled !== sb.filled) winner = sa.filled > sb.filled ? a : b;
    else if (sa.mistakes !== sb.mistakes) winner = sa.mistakes < sb.mistakes ? a : b;
    else if (sa.filled > 0 && sa.lastCorrectAt !== sb.lastCorrectAt)
      winner = sa.lastCorrectAt < sb.lastCorrectAt ? a : b;
    if (!winner && meta.tournamentId) winner = meta.players[Math.floor(Math.random() * 2)]!;
    await this.finish(matchId, winner, 'timeout');
  }

  private async onGraceExpired(matchId: string, userId: string): Promise<void> {
    const meta = await this.getMeta(matchId);
    if (!meta || !LIVE.has(meta.status)) return;
    const state = await this.getPlayerState(matchId, userId);
    if (state.connected) return;
    await this.finish(matchId, this.opponentOf(meta, userId), 'disconnect');
  }

  async forfeit(matchId: string, userId: string): Promise<void> {
    const meta = await this.requireParticipant(matchId, userId);
    if (!LIVE.has(meta.status)) return;
    await this.finish(matchId, this.opponentOf(meta, userId), 'forfeit');
  }

  private async finish(matchId: string, winner: string | null, reason: MatchEndReason): Promise<void> {
    const ended = await this.deps.redis.swcFinish(keys.match(matchId), winner ?? '', reason, Date.now());
    if (ended) await this.finalize(matchId);
  }

  private async abort(meta: MatchMeta): Promise<void> {
    const ok = await this.deps.redis.swcTransition(keys.match(meta.id), meta.status, 'aborted');
    if (!ok) return;
    await this.cleanup(meta);
    for (const userId of this.humans(meta)) {
      this.deps.realtime
        .toUser(userId)
        .emit('notice', { code: 'match_aborted', message: 'Nobody confirmed the match in time' });
    }
  }

  // ------------------------------------------------------------------- moves

  async applyMove(
    matchId: string,
    userId: string,
    cell: number,
    value: number,
    seq: number,
  ): Promise<MoveAck> {
    const { redis, log } = this.deps;
    const header = await redis.hmget(keys.match(matchId), 'players', 'bots', 'totalEmpty');
    const players = header[0]?.split(',') ?? [];
    if (!players.includes(userId)) {
      return {
        seq,
        cell,
        value,
        verdict: 'rejected',
        reason: 'not_in_match',
        mistakes: 0,
        lockedUntil: 0,
        filled: 0,
        completed: false,
      };
    }
    const opponentId = players.find((p) => p !== userId)!;
    const [verdict, reason, mistakes, lockedUntil, filled, completed, ended] = await redis.swcMove(
      keys.match(matchId),
      keys.matchPlayer(matchId, userId),
      keys.matchLog(matchId, userId),
      userId,
      opponentId,
      cell,
      String(value),
      seq,
      Date.now(),
      GAME_RULES.penaltyLockMs,
      GAME_RULES.maxMistakes,
      GAME_RULES.maxMovesPerSecond,
    );
    const ack: MoveAck = {
      seq,
      cell,
      value,
      verdict: verdict as MoveVerdict,
      ...(reason ? { reason: reason as MoveRejectReason } : {}),
      mistakes: Number(mistakes),
      lockedUntil: Number(lockedUntil),
      filled: Number(filled),
      completed: Number(completed) === 1,
    };
    const bots = header[1] ? header[1].split(',') : [];
    if (ack.verdict !== 'rejected' && !bots.includes(opponentId)) {
      this.deps.realtime.toUser(opponentId).emit('match:opponent_progress', {
        matchId,
        filled: ack.filled,
        totalEmpty: Number(header[2]),
        mistakes: ack.mistakes,
        ...(ack.verdict === 'correct' ? { cell } : { lockedUntil: ack.lockedUntil }),
      });
    }
    if (Number(ended) === 1) {
      // Let the ack reach the player before the end-of-match payload.
      setImmediate(
        () => void this.finalize(matchId).catch((err) => log.error({ err, matchId }, 'finalize failed')),
      );
    }
    return ack;
  }

  async emote(matchId: string, userId: string, emoteId: EmoteId): Promise<void> {
    const meta = await this.requireParticipant(matchId, userId);
    if (!LIVE.has(meta.status)) return;
    const allowed = await this.deps.redis.set(
      keys.matchEmote(matchId, userId),
      '1',
      'PX',
      GAME_RULES.emoteCooldownMs,
      'NX',
    );
    if (allowed !== 'OK') throw new AppError('rate_limited', 'Slow down');
    const opponentId = this.opponentOf(meta, userId);
    if (!meta.bots.includes(opponentId)) {
      this.deps.realtime.toUser(opponentId).emit('match:emote', { matchId, from: userId, emoteId });
    }
  }

  // ------------------------------------------------------------ connections

  async handleDisconnect(userId: string): Promise<void> {
    const meta = await this.activeMatchOf(userId);
    if (!meta) return;
    const graceEndsAt = Date.now() + GAME_RULES.reconnectGraceMs;
    await this.deps.redis.hset(keys.matchPlayer(meta.id, userId), 'connected', 0);
    await this.deps.timers.schedule('grace', `${meta.id}:${userId}`, graceEndsAt);
    const opponentId = this.opponentOf(meta, userId);
    this.deps.realtime
      .toUser(opponentId)
      .emit('match:opponent_connection', { matchId: meta.id, connected: false, graceEndsAt });
  }

  /** Called on every new socket: restores the player's live match, if any. */
  async handleReconnect(userId: string): Promise<void> {
    const meta = await this.activeMatchOf(userId);
    if (!meta) return;
    const state = await this.getPlayerState(meta.id, userId);
    if (!state.connected) {
      await this.deps.redis.hset(keys.matchPlayer(meta.id, userId), 'connected', 1);
      await this.deps.timers.cancel('grace', `${meta.id}:${userId}`);
      this.deps.realtime
        .toUser(this.opponentOf(meta, userId))
        .emit('match:opponent_connection', { matchId: meta.id, connected: true });
    }
    this.deps.realtime.toUser(userId).emit('match:resume', await this.buildResume(meta, userId));
  }

  async buildResume(meta: MatchMeta, userId: string): Promise<MatchResumePayload> {
    const opponentId = this.opponentOf(meta, userId);
    const [me, opp] = await Promise.all([
      this.getPlayerState(meta.id, userId),
      this.getPlayerState(meta.id, opponentId),
    ]);
    const [youProfile, oppProfile] = await this.deps.users.getCompetitiveMany([userId, opponentId]);
    const inProgress = meta.status === 'in_progress';
    return {
      matchId: meta.id,
      type: meta.type,
      status: meta.status as LiveStatus,
      difficulty: meta.difficulty,
      you: competitiveToPublic(youProfile!),
      opponent: competitiveToPublic(oppProfile!),
      serverNow: Date.now(),
      readyDeadline: meta.readyDeadline,
      ...(meta.startsAt ? { startsAt: meta.startsAt } : {}),
      ...(inProgress && meta.startedAt ? { startedAt: meta.startedAt, endsAt: meta.endsAt! } : {}),
      ...(inProgress ? { givens: meta.givens, board: me.board } : {}),
      totalEmpty: meta.totalEmpty,
      filled: me.filled,
      mistakes: me.mistakes,
      lockedUntil: me.lockedUntil,
      lastSeq: me.lastSeq,
      opponentProgress: { filled: opp.filled, mistakes: opp.mistakes, connected: opp.connected },
      ...(meta.tournamentId ? { tournament: { id: meta.tournamentId, round: meta.round ?? 0 } } : {}),
    };
  }

  // ---------------------------------------------------------------- finalize

  /**
   * Turns a finished live match into permanent records exactly once:
   * results, ratings, trophies, coins, country points, unlocks and
   * anti-cheat flags in one Postgres transaction, then notifies players.
   */
  async finalize(matchId: string): Promise<void> {
    const { redis, db, users, seasons, economy, log } = this.deps;
    const claimed = await redis.hsetnx(keys.match(matchId), 'finalized', '1');
    if (!claimed) return;
    const meta = await this.getMeta(matchId);
    if (meta?.status !== 'finished') return;

    const profiles = await users.getCompetitiveMany(meta.players);
    const states = await Promise.all(meta.players.map((p) => this.getPlayerState(matchId, p)));
    const logs = await Promise.all(meta.players.map((p) => redis.lrange(keys.matchLog(matchId, p), 0, -1)));
    const season = await seasons.get();
    const endedAt = new Date(meta.endedAt ?? Date.now());
    const startedAt = new Date(meta.startedAt ?? meta.readyDeadline);

    const outcomes: Outcome[] = meta.players.map((p) =>
      meta.winner === 'draw' || !meta.winner ? 'draw' : meta.winner === p ? 'win' : 'loss',
    );

    interface Computed {
      profile: CompetitiveProfile;
      opponent: CompetitiveProfile;
      state: PlayerState;
      outcome: Outcome;
      moves: MoveRecord[];
      trophiesDelta: number;
      trophiesAfter: number;
      rating: { rating: number; rd: number; vol: number };
      coins: number;
      points: number;
      analysis: CheatAnalysis | null;
      unlocks: string[];
    }

    const computed: Computed[] = meta.players.map((_, i) => {
      const profile = profiles[i]!;
      const opponent = profiles[1 - i]!;
      const outcome = outcomes[i]!;
      const vsBot = opponent.isBot;
      const moves = logs[i]!.map((line) => {
        const [cell, value, ok, t] = line.split(',').map(Number) as [number, number, number, number];
        return { cell, value, ok: ok === 1, t };
      });
      const ranked = meta.type === 'ranked' && !profile.isBot;
      const trophiesDelta = ranked
        ? trophyDelta({ myTrophies: profile.trophies, opponentTrophies: opponent.trophies, outcome, vsBot })
        : 0;
      const rating = ranked
        ? glicko2Update(
            { rating: profile.rating, rd: profile.ratingDeviation, vol: profile.volatility },
            { rating: opponent.rating, rd: opponent.ratingDeviation, vol: opponent.volatility },
            outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0,
          )
        : { rating: profile.rating, rd: profile.ratingDeviation, vol: profile.volatility };
      return {
        profile,
        opponent,
        state: states[i]!,
        outcome,
        moves,
        trophiesDelta,
        trophiesAfter: profile.trophies + trophiesDelta,
        rating,
        coins: profile.isBot ? 0 : matchCoins(meta.type, outcome, vsBot),
        points: profile.isBot
          ? 0
          : countryPoints({
              type: meta.type,
              outcome,
              vsBot,
              myTrophies: profile.trophies,
              opponentTrophies: opponent.trophies,
              round: meta.round ?? 0,
            }),
        analysis: profile.isBot ? null : analyzeMoves(meta.givens, moves, meta.difficulty),
        unlocks: [],
      };
    });

    const persisted = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(matches)
        .values({
          id: matchId,
          type: meta.type,
          difficulty: meta.difficulty,
          puzzleId: meta.puzzleId,
          endReason: meta.endReason ?? 'completed',
          winnerId: meta.winner && meta.winner !== 'draw' ? meta.winner : null,
          tournamentId: meta.tournamentId,
          round: meta.round,
          bracketSlot: meta.slot,
          startedAt,
          endedAt,
        })
        .onConflictDoNothing()
        .returning({ id: matches.id });
      if (inserted.length === 0) return false;

      // Points from beating bots are capped per player and UTC day.
      for (const c of computed) {
        if (c.points <= 0 || !c.opponent.isBot) continue;
        const [today] = await tx
          .select({ used: sql<number>`coalesce(sum(${countryPointsLedger.points}), 0)::int` })
          .from(countryPointsLedger)
          .where(
            and(
              eq(countryPointsLedger.userId, c.profile.id),
              like(countryPointsLedger.reason, `%${BOT_REASON_SUFFIX.replace('_', '\\_')}`),
              gte(
                countryPointsLedger.createdAt,
                sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
              ),
            ),
          );
        c.points = cappedBotPoints(c.points, Number(today?.used ?? 0));
      }

      await tx.insert(matchParticipants).values(
        computed.map((c) => ({
          matchId,
          userId: c.profile.id,
          countryCode: c.profile.countryCode,
          result: c.outcome,
          finishTimeMs: c.state.finishedAt,
          mistakes: c.state.mistakes,
          cellsFilled: c.state.filled,
          trophiesDelta: c.trophiesDelta,
          trophiesAfter: c.trophiesAfter,
          ratingBefore: c.profile.rating,
          ratingAfter: c.rating.rating,
          countryPoints: c.analysis?.flagged ? 0 : c.points,
          coinsEarned: c.coins,
          moves: c.moves,
          cheatScore: c.analysis?.score ?? null,
          endedAt,
        })),
      );

      for (const c of computed) {
        if (c.profile.isBot) continue;
        const userId = c.profile.id;
        const wins = c.profile.wins + (c.outcome === 'win' ? 1 : 0);
        const finish = c.state.finishedAt;
        await tx
          .update(playerStats)
          .set({
            trophies: c.trophiesAfter,
            league: leagueForTrophies(c.trophiesAfter).slug,
            rating: c.rating.rating,
            ratingDeviation: c.rating.rd,
            volatility: c.rating.vol,
            wins: sql`${playerStats.wins} + ${c.outcome === 'win' ? 1 : 0}`,
            losses: sql`${playerStats.losses} + ${c.outcome === 'loss' ? 1 : 0}`,
            draws: sql`${playerStats.draws} + ${c.outcome === 'draw' ? 1 : 0}`,
            winStreak: c.outcome === 'win' ? sql`${playerStats.winStreak} + 1` : 0,
            coins: sql`${playerStats.coins} + ${c.coins}`,
            ...(finish !== null
              ? { bestTimeMs: sql`least(coalesce(${playerStats.bestTimeMs}, ${finish}), ${finish})` }
              : {}),
          })
          .where(eq(playerStats.userId, userId));
        if (c.coins > 0) {
          await tx
            .insert(currencyLedger)
            .values({ userId, delta: c.coins, reason: 'match', refId: matchId })
            .onConflictDoNothing();
        }
        if (c.points > 0 && !c.analysis?.flagged) {
          await tx
            .insert(countryPointsLedger)
            .values({
              seasonId: season.id,
              countryCode: c.profile.countryCode,
              userId,
              points: c.points,
              reason: c.opponent.isBot ? `${meta.type}${BOT_REASON_SUFFIX}` : meta.type,
              refId: matchId,
            })
            .onConflictDoNothing();
          await tx
            .insert(countrySeasonScores)
            .values({ seasonId: season.id, countryCode: c.profile.countryCode, points: c.points })
            .onConflictDoUpdate({
              target: [countrySeasonScores.seasonId, countrySeasonScores.countryCode],
              set: { points: sql`${countrySeasonScores.points} + ${c.points}` },
            });
        }
        if (c.analysis?.flagged) {
          await tx.insert(anticheatFlags).values({
            matchId,
            userId,
            score: c.analysis.score,
            signals: { reasons: c.analysis.reasons, ...c.analysis.signals },
            heldPoints: c.points,
            heldSeasonId: season.id,
            heldCountryCode: c.profile.countryCode,
          });
          log.warn(
            { matchId, userId, score: c.analysis.score, reasons: c.analysis.reasons },
            'match flagged',
          );
        }
        c.unlocks = await economy.grantEarned(tx, userId, {
          trophies: c.trophiesAfter,
          wins,
          tournamentWins: c.profile.tournamentWins,
        });
      }
      return true;
    });

    await this.cleanup(meta);
    if (!persisted) return;

    const results: MatchResultEntry[] = computed.map((c) => ({
      userId: c.profile.id,
      username: c.profile.username,
      countryCode: c.profile.countryCode,
      avatar: c.profile.avatar,
      isBot: c.profile.isBot,
      result: c.outcome,
      finishTimeMs: c.state.finishedAt,
      mistakes: c.state.mistakes,
      filled: c.state.filled,
      trophiesDelta: c.trophiesDelta,
      trophiesAfter: c.trophiesAfter,
      countryPoints: c.points,
      coins: c.coins,
      unlocks: c.unlocks,
    }));
    const winnerId = meta.winner && meta.winner !== 'draw' ? meta.winner : null;

    for (const c of computed) {
      if (c.profile.isBot) continue;
      const payload: MatchEndPayload = {
        matchId,
        type: meta.type,
        difficulty: meta.difficulty,
        winnerId,
        reason: meta.endReason ?? 'completed',
        results,
        givens: meta.givens,
        solution: meta.solution,
        puzzleId: meta.puzzleId,
        generatorSeed: meta.seed,
        totalEmpty: meta.totalEmpty,
        ...(meta.tournamentId
          ? {
              tournament: {
                id: meta.tournamentId,
                round: meta.round ?? 0,
                eliminated: c.outcome !== 'win',
                champion: c.outcome === 'win' && (meta.round ?? 0) === 3,
              },
            }
          : {}),
      };
      this.deps.realtime.toUser(c.profile.id).emit('match:end', payload);
    }
    log.info({ matchId, winnerId, reason: meta.endReason }, 'match finalized');

    const event: MatchFinishedEvent = {
      matchId,
      type: meta.type,
      winnerId,
      loserId: winnerId ? this.opponentOf(meta, winnerId) : null,
      tournament:
        meta.tournamentId !== null
          ? { id: meta.tournamentId, round: meta.round ?? 0, slot: meta.slot ?? 0 }
          : null,
    };
    for (const listener of this.finishedListeners) {
      await listener(event).catch((err) => log.error({ err, matchId }, 'match finished listener failed'));
    }
  }

  private async cleanup(meta: MatchMeta): Promise<void> {
    const { redis, timers } = this.deps;
    await timers.cancelMany([
      ['ready', meta.id],
      ['start', meta.id],
      ['timeout', meta.id],
      ...meta.players.flatMap((p): [string, string][] => [
        ['grace', `${meta.id}:${p}`],
        ['bot', `${meta.id}:${p}`],
      ]),
    ]);
    const pipeline = redis.pipeline();
    for (const p of meta.players) {
      pipeline.expire(keys.matchPlayer(meta.id, p), 600);
      pipeline.expire(keys.matchLog(meta.id, p), 600);
      pipeline.del(keys.matchBot(meta.id, p));
    }
    pipeline.expire(keys.match(meta.id), 600);
    if (meta.bots.length > 0) pipeline.srem(keys.busyBots, ...meta.bots);
    await pipeline.exec();
    for (const p of this.humans(meta)) {
      const current = await redis.get(keys.userMatch(p));
      if (current === meta.id) await redis.del(keys.userMatch(p));
    }
  }

  // ----------------------------------------------------------------- helpers

  private humans(meta: MatchMeta): string[] {
    return meta.players.filter((p) => !meta.bots.includes(p));
  }

  private opponentOf(meta: MatchMeta, userId: string): string {
    return meta.players[0] === userId ? meta.players[1] : meta.players[0];
  }

  private async requireParticipant(matchId: string, userId: string): Promise<MatchMeta> {
    const meta = await this.getMeta(matchId);
    if (!meta?.players.includes(userId)) throw new AppError('not_in_match', 'You are not in this match');
    return meta;
  }
}
