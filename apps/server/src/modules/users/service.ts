import { hash, verify } from '@node-rs/argon2';
import {
  COSMETICS,
  GAME_RULES,
  type GuestInput,
  type LeagueSlug,
  type LoginInput,
  type MatchHistoryEntry,
  type MeProfile,
  type PlayerProfile,
  type PublicPlayer,
  type RegisterInput,
} from '@swcup/shared';
import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../../db/client';
import { matches, matchParticipants, playerStats, userCosmetics, users } from '../../db/schema';
import { AppError, isUniqueViolation, pgError } from '../../lib/errors';

export interface CompetitiveProfile {
  id: string;
  username: string;
  countryCode: string;
  avatar: string;
  isBot: boolean;
  trophies: number;
  league: LeagueSlug;
  rating: number;
  ratingDeviation: number;
  volatility: number;
  wins: number;
  losses: number;
  winStreak: number;
  tournamentWins: number;
  bestTimeMs: number | null;
}

const COOLDOWN_MS = GAME_RULES.countryChangeCooldownDays * 86_400_000;
const opponent = alias(matchParticipants, 'opponent');
const opponentUser = alias(users, 'opponent_user');

export class UserService {
  constructor(private readonly db: Db) {}

  async createGuest(input: GuestInput): Promise<string> {
    return this.createUser({ username: input.username, countryCode: input.countryCode, isGuest: true });
  }

  /** Upgrades the current guest in place, or creates a full account when signed out. */
  async register(currentUserId: string | null, input: RegisterInput): Promise<string> {
    const passwordHash = await hash(input.password);
    if (currentUserId) {
      const [current] = await this.db.select().from(users).where(eq(users.id, currentUserId)).limit(1);
      if (current?.isGuest) {
        try {
          await this.db
            .update(users)
            .set({
              email: input.email,
              passwordHash,
              isGuest: false,
              ...(input.username ? { username: input.username } : {}),
              ...(input.countryCode && input.countryCode !== current.countryCode
                ? { countryCode: input.countryCode, countryChangedAt: new Date() }
                : {}),
            })
            .where(eq(users.id, currentUserId));
          return currentUserId;
        } catch (err) {
          throw this.mapUniqueError(err);
        }
      }
      if (current && !current.isGuest) throw new AppError('already_registered');
    }
    if (!input.username || !input.countryCode) {
      throw new AppError('bad_request', 'Username and country are required for a new account');
    }
    return this.createUser({
      username: input.username,
      countryCode: input.countryCode,
      isGuest: false,
      email: input.email,
      passwordHash,
    });
  }

  async login(input: LoginInput): Promise<string> {
    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(
        and(
          eq(users.isBot, false),
          sql`(lower(${users.username}) = lower(${input.login}) or lower(${users.email}) = lower(${input.login}))`,
        ),
      )
      .limit(1);
    // Verify against a dummy hash when the user is missing to keep timing uniform.
    const stored = user?.passwordHash ?? DUMMY_HASH;
    const ok = await verify(stored, input.password).catch(() => false);
    if (!user?.passwordHash || !ok) throw new AppError('invalid_credentials', 'Wrong username or password');
    return user.id;
  }

  async getMe(userId: string): Promise<MeProfile> {
    const [row] = await this.db
      .select({ user: users, stats: playerStats })
      .from(users)
      .innerJoin(playerStats, eq(playerStats.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new AppError('unauthorized', 'Session user no longer exists');
    const owned = await this.db
      .select({ slug: userCosmetics.slug })
      .from(userCosmetics)
      .where(eq(userCosmetics.userId, userId));
    const defaults = COSMETICS.filter((c) => c.unlock.type === 'default').map((c) => c.slug);
    const changedAt = row.user.countryChangedAt?.getTime();
    const availableAt =
      changedAt && changedAt + COOLDOWN_MS > Date.now() ? new Date(changedAt + COOLDOWN_MS) : null;
    return {
      id: row.user.id,
      username: row.user.username,
      countryCode: row.user.countryCode,
      avatar: row.user.avatar,
      isBot: row.user.isBot,
      trophies: row.stats.trophies,
      league: row.stats.league as LeagueSlug,
      isGuest: row.user.isGuest,
      email: row.user.email,
      theme: row.user.theme,
      coins: row.stats.coins,
      wins: row.stats.wins,
      losses: row.stats.losses,
      winStreak: row.stats.winStreak,
      bestTimeMs: row.stats.bestTimeMs,
      tournamentWins: row.stats.tournamentWins,
      ownedCosmetics: [...new Set([...defaults, ...owned.map((o) => o.slug)])],
      countryChangeAvailableAt: availableAt?.toISOString() ?? null,
      createdAt: row.user.createdAt.toISOString(),
    };
  }

  async getCompetitive(userId: string): Promise<CompetitiveProfile> {
    const [profile] = await this.getCompetitiveMany([userId]);
    if (!profile) throw new AppError('not_found', 'Player not found');
    return profile;
  }

  async getCompetitiveMany(ids: string[]): Promise<CompetitiveProfile[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ user: users, stats: playerStats })
      .from(users)
      .innerJoin(playerStats, eq(playerStats.userId, users.id))
      .where(inArray(users.id, ids));
    const byId = new Map(
      rows.map(({ user, stats }) => [
        user.id,
        {
          id: user.id,
          username: user.username,
          countryCode: user.countryCode,
          avatar: user.avatar,
          isBot: user.isBot,
          trophies: stats.trophies,
          league: stats.league as LeagueSlug,
          rating: stats.rating,
          ratingDeviation: stats.ratingDeviation,
          volatility: stats.volatility,
          wins: stats.wins,
          losses: stats.losses,
          winStreak: stats.winStreak,
          tournamentWins: stats.tournamentWins,
          bestTimeMs: stats.bestTimeMs,
        } satisfies CompetitiveProfile,
      ]),
    );
    return ids.map((id) => byId.get(id)).filter((p): p is CompetitiveProfile => Boolean(p));
  }

  async getProfile(username: string): Promise<PlayerProfile> {
    const [row] = await this.db
      .select({ user: users, stats: playerStats })
      .from(users)
      .innerJoin(playerStats, eq(playerStats.userId, users.id))
      .where(sql`lower(${users.username}) = lower(${username})`)
      .limit(1);
    if (!row) throw new AppError('not_found', 'Player not found');
    return {
      ...toPublic(row.user, row.stats),
      wins: row.stats.wins,
      losses: row.stats.losses,
      winStreak: row.stats.winStreak,
      bestTimeMs: row.stats.bestTimeMs,
      tournamentWins: row.stats.tournamentWins,
      createdAt: row.user.createdAt.toISOString(),
      recentMatches: await this.getHistory(row.user.id, 10),
    };
  }

  async findIdByUsername(username: string): Promise<string> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`)
      .limit(1);
    if (!row) throw new AppError('not_found', 'Player not found');
    return row.id;
  }

  async getHistory(userId: string, limit: number, before?: Date): Promise<MatchHistoryEntry[]> {
    const rows = await this.db
      .select({
        me: matchParticipants,
        match: matches,
        opp: {
          username: opponentUser.username,
          countryCode: opponentUser.countryCode,
          isBot: opponentUser.isBot,
        },
      })
      .from(matchParticipants)
      .innerJoin(matches, eq(matches.id, matchParticipants.matchId))
      .innerJoin(opponent, and(eq(opponent.matchId, matchParticipants.matchId), ne(opponent.userId, userId)))
      .innerJoin(opponentUser, eq(opponentUser.id, opponent.userId))
      .where(
        and(eq(matchParticipants.userId, userId), before ? lt(matchParticipants.endedAt, before) : undefined),
      )
      .orderBy(desc(matchParticipants.endedAt))
      .limit(limit);
    return rows.map(({ me, match, opp }) => ({
      matchId: match.id,
      type: match.type,
      difficulty: match.difficulty,
      endedAt: me.endedAt.toISOString(),
      result: me.result,
      reason: match.endReason,
      finishTimeMs: me.finishTimeMs,
      mistakes: me.mistakes,
      trophiesDelta: me.trophiesDelta,
      opponent: opp,
    }));
  }

  async updateCountry(userId: string, countryCode: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new AppError('unauthorized');
    if (user.countryCode === countryCode) return;
    const changedAt = user.countryChangedAt?.getTime();
    if (changedAt && Date.now() - changedAt < COOLDOWN_MS) {
      throw new AppError(
        'country_cooldown',
        `Country can be changed again on ${new Date(changedAt + COOLDOWN_MS).toISOString().slice(0, 10)}`,
      );
    }
    await this.db
      .update(users)
      .set({ countryCode, countryChangedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async touch(userId: string): Promise<void> {
    await this.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
  }

  private async createUser(values: {
    username: string;
    countryCode: string;
    isGuest: boolean;
    email?: string;
    passwordHash?: string;
  }): Promise<string> {
    try {
      return await this.db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values(values).returning({ id: users.id });
        await tx.insert(playerStats).values({ userId: user!.id });
        return user!.id;
      });
    } catch (err) {
      throw this.mapUniqueError(err);
    }
  }

  private mapUniqueError(err: unknown): unknown {
    if (!isUniqueViolation(err)) return err;
    const constraint = pgError(err)?.constraint ?? '';
    if (constraint.includes('email')) return new AppError('email_taken', 'That email is already registered');
    return new AppError('username_taken', 'That username is taken');
  }
}

export function toPublic(
  user: typeof users.$inferSelect,
  stats: Pick<typeof playerStats.$inferSelect, 'trophies' | 'league'>,
): PublicPlayer {
  return {
    id: user.id,
    username: user.username,
    countryCode: user.countryCode,
    avatar: user.avatar,
    isBot: user.isBot,
    trophies: stats.trophies,
    league: stats.league as LeagueSlug,
  };
}

export function competitiveToPublic(p: CompetitiveProfile): PublicPlayer {
  return {
    id: p.id,
    username: p.username,
    countryCode: p.countryCode,
    avatar: p.avatar,
    isBot: p.isBot,
    trophies: p.trophies,
    league: p.league,
  };
}

// argon2id hash of a random string; only used to equalize login timing.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0bUvC9cTzvGCeKFbS1Ob3B/2Jb3uh3Y+1Bf0oa5xQ0Y';
