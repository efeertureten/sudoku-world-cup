import { loadEnv } from './config/env';
import { createDatabase } from './db/client';
import { createLogger } from './lib/logger';
import { PuzzlePool } from './modules/puzzles/pool';
import { createRedis } from './redis/client';

/**
 * Background worker: keeps every difficulty stocked with PUZZLE_POOL_TARGET
 * unique, graded puzzles so match creation never waits for generation.
 * The server runs migrations; the worker starts after it is healthy.
 */
const env = loadEnv();
const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const database = createDatabase(env.DATABASE_URL, 2);
const redis = createRedis(env.REDIS_URL);
const pool = new PuzzlePool(database.db, redis, log);

let stopping = false;
const shutdown = async () => {
  stopping = true;
  await Promise.allSettled([redis.quit(), database.close()]);
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

log.info({ target: env.PUZZLE_POOL_TARGET }, 'puzzle worker started');
while (!stopping) {
  try {
    await pool.refill(env.PUZZLE_POOL_TARGET);
  } catch (err) {
    log.error({ err }, 'refill failed');
  }
  await new Promise((r) => setTimeout(r, 30_000));
}
