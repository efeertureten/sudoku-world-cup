import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://sudoku:sudoku@localhost:5432/sudoku'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PUBLIC_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: booleanish.default(false),
  ADMIN_TOKEN: z.string().default(''),
  BOT_FALLBACK_MS: z.coerce.number().int().min(0).default(5_000),
  MATCH_TIME_LIMIT_MS: z.coerce.number().int().min(10_000).default(900_000),
  TOURNAMENT_FILL_MS: z.coerce.number().int().min(1_000).default(60_000),
  PUZZLE_POOL_TARGET: z.coerce.number().int().min(10).default(300),
  RUN_MIGRATIONS: booleanish.default(true),
  INSTANCE_ID: z.string().default(() => randomUUID().slice(0, 8)),
});

export type Env = z.infer<typeof envSchema>;

/** Fails fast with a readable message instead of crashing later on a bad value. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
