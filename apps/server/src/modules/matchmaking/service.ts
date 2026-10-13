import { DIFFICULTIES, type Difficulty, leagueBySlug, type QueueMode } from '@swcup/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Env } from '../../config/env';
import type { Db } from '../../db/client';
import { playerStats, users } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { Redis } from '../../redis/client';
import { keys } from '../../redis/keys';
import type { Realtime } from '../../socket/realtime';
import type { MatchService } from '../match/service';
import type { UserService } from '../users/service';

interface QueueEntry {
  queue: string;
  mode: QueueMode;
  difficulty: Difficulty | null;
  rating: number;
  enqueuedAt: number;
}

const BASE_WINDOW = 50;
const WINDOW_GROWTH_PER_SEC = 50;
const MAX_WINDOW = 400;

export const searchWindow = (elapsedMs: number) =>
  Math.min(MAX_WINDOW, Math.round(BASE_WINDOW + (WINDOW_GROWTH_PER_SEC * elapsedMs) / 1000));

/**
 * Rating-based 1v1 matchmaking. Each queue is two sorted sets (by hidden
 * rating and by enqueue time). The search window widens the longer a player
 * waits; after BOT_FALLBACK_MS a human-like bot of similar rating steps in.
 */
export class Matchmaker {
  private ticks = 0;

  constructor(
    private readonly deps: {
      db: Db;
      redis: Redis;
      env: Env;
      log: Logger;
      realtime: Realtime;
      users: UserService;
      matches: MatchService;
    },
  ) {}

  async join(userId: string, mode: QueueMode, difficulty?: Difficulty): Promise<{ queuedAt: number }> {
    const { redis, users, matches } = this.deps;
    if (await matches.activeMatchOf(userId))
      throw new AppError('already_in_match', 'Finish your current match first');
    if (await redis.exists(keys.userTournament(userId))) {
      throw new AppError('already_in_tournament', 'Leave the tournament lobby first');
    }
    const existing = await redis.get(keys.userQueue(userId));
    if (existing) return { queuedAt: (JSON.parse(existing) as QueueEntry).enqueuedAt };

    const me = await users.getCompetitive(userId);
    const queueDifficulty = mode === 'casual' ? (difficulty ?? leagueBySlug(me.league).difficulty) : null;
    const queue = mode === 'ranked' ? 'ranked' : `casual:${queueDifficulty}`;
    const entry: QueueEntry = {
      queue,
      mode,
      difficulty: queueDifficulty,
      rating: me.rating,
      enqueuedAt: Date.now(),
    };
    await redis
      .multi()
      .set(keys.userQueue(userId), JSON.stringify(entry), 'EX', 60 * 30)
      .zadd(keys.queueRating(queue), me.rating, userId)
      .zadd(keys.queueTime(queue), entry.enqueuedAt, userId)
      .sadd(keys.queues, queue)
      .exec();
    return { queuedAt: entry.enqueuedAt };
  }

  async leave(userId: string): Promise<void> {
    const { redis } = this.deps;
    const raw = await redis.get(keys.userQueue(userId));
    if (!raw) return;
    const entry = JSON.parse(raw) as QueueEntry;
    await redis
      .multi()
      .zrem(keys.queueRating(entry.queue), userId)
      .zrem(keys.queueTime(entry.queue), userId)
      .del(keys.userQueue(userId))
      .exec();
  }

  /** One matchmaking pass over every queue; run by the leader a few times per second. */
  async tick(now = Date.now()): Promise<void> {
    const { redis } = this.deps;
    this.ticks++;
    const emitStatus = this.ticks % 4 === 0;
    const queues = await redis.smembers(keys.queues);
    for (const queue of queues) {
      const waiting = await redis.zrange(keys.queueTime(queue), 0, -1, 'WITHSCORES');
      if (waiting.length === 0) {
        await redis.srem(keys.queues, queue);
        continue;
      }
      const taken = new Set<string>();
      for (let i = 0; i < waiting.length; i += 2) {
        const userId = waiting[i]!;
        if (taken.has(userId)) continue;
        const enqueuedAt = Number(waiting[i + 1]);
        const elapsed = now - enqueuedAt;
        const window = searchWindow(elapsed);
        const ratingRaw = await redis.zscore(keys.queueRating(queue), userId);
        if (ratingRaw === null) continue;
        const rating = Number(ratingRaw);

        const nearby = await redis.zrangebyscore(
          keys.queueRating(queue),
          rating - window,
          rating + window,
          'WITHSCORES',
        );
        let best: string | null = null;
        let bestGap = Number.POSITIVE_INFINITY;
        for (let j = 0; j < nearby.length; j += 2) {
          const other = nearby[j]!;
          if (other === userId || taken.has(other)) continue;
          const gap = Math.abs(Number(nearby[j + 1]) - rating);
          if (gap < bestGap) {
            best = other;
            bestGap = gap;
          }
        }

        if (best) {
          const popped = await redis.swcPairPop(keys.queueRating(queue), keys.queueTime(queue), userId, best);
          if (popped) {
            taken.add(userId).add(best);
            await this.launch(queue, [userId, best]);
          }
          continue;
        }

        if (elapsed >= this.deps.env.BOT_FALLBACK_MS) {
          const removed = await redis.zrem(keys.queueRating(queue), userId);
          if (removed) {
            await redis.zrem(keys.queueTime(queue), userId);
            taken.add(userId);
            const bot = await this.pickBot(rating);
            await this.launch(queue, [userId, bot]);
          }
          continue;
        }

        if (emitStatus) {
          this.deps.realtime.toUser(userId).emit('queue:status', {
            mode: queue === 'ranked' ? 'ranked' : 'casual',
            elapsedMs: elapsed,
            searchRange: window,
            botInMs: Math.max(0, this.deps.env.BOT_FALLBACK_MS - elapsed),
          });
        }
      }
    }
  }

  private async launch(queue: string, players: [string, string]): Promise<void> {
    const { redis, users, matches, log } = this.deps;
    const entries = await Promise.all(players.map((p) => redis.get(keys.userQueue(p))));
    await redis.del(...players.map((p) => keys.userQueue(p)));
    try {
      let difficulty: Difficulty;
      if (queue.startsWith('casual:')) {
        difficulty = queue.slice('casual:'.length) as Difficulty;
      } else {
        // Ranked plays the easier league's puzzle so neither side is out of their depth.
        const profiles = await users.getCompetitiveMany(players.filter((_, i) => entries[i] !== null));
        const ranks = profiles.map((p) => DIFFICULTIES.indexOf(leagueBySlug(p.league).difficulty));
        difficulty = DIFFICULTIES[Math.min(...ranks)] ?? 'easy';
      }
      await matches.create({
        type: queue === 'ranked' ? 'ranked' : 'casual',
        difficulty,
        playerIds: players,
      });
    } catch (err) {
      log.error({ err, players }, 'failed to create match');
      for (const p of players) {
        this.deps.realtime
          .toUser(p)
          .emit('notice', { code: 'match_failed', message: 'Could not start the match' });
      }
    }
  }

  /** The closest-rated free bot (a few candidates, chosen at random so opponents vary). */
  async pickBot(rating: number): Promise<string> {
    const { db, redis } = this.deps;
    const candidates = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(playerStats, eq(playerStats.userId, users.id))
      .where(and(eq(users.isBot, true)))
      .orderBy(sql`abs(${playerStats.rating} - ${rating})`)
      .limit(12);
    if (candidates.length === 0) throw new Error('No bots seeded');
    const busy = await Promise.all(candidates.map((c) => redis.sismember(keys.busyBots, c.id)));
    const free = candidates.filter((_, i) => busy[i] === 0).slice(0, 4);
    const pool = free.length > 0 ? free : candidates.slice(0, 4);
    return pool[Math.floor(Math.random() * pool.length)]!.id;
  }
}
