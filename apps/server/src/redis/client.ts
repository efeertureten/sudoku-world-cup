import { randomUUID } from 'node:crypto';
import { Redis, type Result } from 'ioredis';
import { keys } from './keys';
import {
  FINISH_SCRIPT,
  MOVE_SCRIPT,
  PAIR_POP_SCRIPT,
  POP_DUE_SCRIPT,
  RELEASE_LOCK_SCRIPT,
  RENEW_LOCK_SCRIPT,
  TRANSITION_SCRIPT,
} from './scripts';

declare module 'ioredis' {
  interface RedisCommander<Context> {
    swcMove(
      matchKey: string,
      playerKey: string,
      logKey: string,
      ...args: (string | number)[]
    ): Result<[string, string, number, number, number, number, number], Context>;
    swcFinish(matchKey: string, winner: string, reason: string, now: number): Result<number, Context>;
    swcTransition(
      key: string,
      from: string,
      to: string,
      ...fields: (string | number)[]
    ): Result<number, Context>;
    swcPairPop(ratingKey: string, timeKey: string, a: string, b: string): Result<number, Context>;
    swcPopDue(timersKey: string, now: number, limit: number): Result<string[], Context>;
    swcRenewLock(lockKey: string, owner: string, ttlMs: number): Result<number, Context>;
    swcReleaseLock(lockKey: string, owner: string): Result<number, Context>;
  }
}

export type { Redis };

export function createRedis(url: string): Redis {
  const redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
  redis.defineCommand('swcMove', { numberOfKeys: 3, lua: MOVE_SCRIPT });
  redis.defineCommand('swcFinish', { numberOfKeys: 1, lua: FINISH_SCRIPT });
  redis.defineCommand('swcTransition', { numberOfKeys: 1, lua: TRANSITION_SCRIPT });
  redis.defineCommand('swcPairPop', { numberOfKeys: 2, lua: PAIR_POP_SCRIPT });
  redis.defineCommand('swcPopDue', { numberOfKeys: 1, lua: POP_DUE_SCRIPT });
  redis.defineCommand('swcRenewLock', { numberOfKeys: 1, lua: RENEW_LOCK_SCRIPT });
  redis.defineCommand('swcReleaseLock', { numberOfKeys: 1, lua: RELEASE_LOCK_SCRIPT });
  return redis;
}

/**
 * Short-lived mutual exclusion across instances (e.g. bracket updates).
 * Retries until acquired or `waitMs` elapses.
 */
export async function withLock<T>(
  redis: Redis,
  name: string,
  fn: () => Promise<T>,
  { ttlMs = 10_000, waitMs = 10_000 } = {},
): Promise<T> {
  const key = keys.lock(name);
  const owner = randomUUID();
  const deadline = Date.now() + waitMs;
  while ((await redis.set(key, owner, 'PX', ttlMs, 'NX')) !== 'OK') {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for lock ${name}`);
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 30));
  }
  try {
    return await fn();
  } finally {
    await redis.swcReleaseLock(key, owner);
  }
}

/** Fixed-window rate limiter. Returns true when the call is allowed. */
export async function allowRate(
  redis: Redis,
  bucket: string,
  id: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const key = keys.rateLimit(bucket, id);
  const results = await redis.multi().incr(key).pexpire(key, windowMs, 'NX').exec();
  const count = Number(results?.[0]?.[1] ?? 0);
  return count <= limit;
}
