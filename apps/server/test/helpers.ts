import { randomBytes } from 'node:crypto';
import type { AckResponse, ClientToServerEvents, ServerToClientEvents } from '@swcup/shared';
import { Redis } from 'ioredis';
import { io as connect, type Socket } from 'socket.io-client';
import { createGameApp, type GameApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { createLogger } from '../src/lib/logger';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://sudoku:sudoku@localhost:5432/sudoku_test';
export const TEST_ADMIN_TOKEN = 'test-admin-token';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/5';

/** True when Postgres and Redis for integration tests are reachable. */
export async function infrastructureAvailable(): Promise<boolean> {
  const redis = new Redis(TEST_REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    await redis.ping();
    const pg = await import('pg');
    const client = new pg.default.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

export async function startTestApp(
  overrides: Record<string, string> = {},
): Promise<{ app: GameApp; url: string }> {
  const flush = new Redis(TEST_REDIS_URL);
  await flush.flushdb();
  flush.disconnect();
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    BOT_FALLBACK_MS: '400',
    MATCH_TIME_LIMIT_MS: '120000',
    TOURNAMENT_FILL_MS: '1500',
    ADMIN_TOKEN: TEST_ADMIN_TOKEN,
    ...overrides,
  });
  const app = await createGameApp(env, { logger: createLogger('silent', false) });
  const port = await app.listen(0);
  // Wait until this instance holds the leader lease (runs timers and matchmaking).
  for (let i = 0; i < 50 && !app.services.leader.isLeader; i++) await sleep(100);
  return { app, url: `http://127.0.0.1:${port}` };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const uniqueName = (prefix: string) => `${prefix}_${randomBytes(3).toString('hex')}`;

export async function createGuest(url: string, username: string, countryCode = 'TR') {
  const res = await fetch(`${url}/api/v1/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, countryCode }),
  });
  if (res.status !== 201) throw new Error(`guest failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  const me = (await res.json()) as { id: string };
  return { id: me.id, cookie };
}

export async function openSocket(url: string, cookie: string): Promise<ClientSocket> {
  const socket: ClientSocket = connect(url, {
    path: '/socket.io',
    transports: ['websocket'],
    extraHeaders: { cookie },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}

/** Emits an event and resolves with the acknowledged data (throws on `ok: false`). */
export function call<E extends keyof ClientToServerEvents>(
  socket: ClientSocket,
  event: E,
  payload: Parameters<ClientToServerEvents[E]>[0],
): Promise<Parameters<Parameters<ClientToServerEvents[E]>[1]>[0] extends AckResponse<infer T> ? T : never> {
  return new Promise((resolve, reject) => {
    // biome-ignore lint/suspicious/noExplicitAny: generic event plumbing
    (socket.emit as any)(event, payload, (res: AckResponse<unknown>) => {
      if (res.ok) resolve(res.data as never);
      else reject(Object.assign(new Error(res.message), { code: res.code }));
    });
  });
}

export function next<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  timeoutMs = 15_000,
  predicate: (payload: Parameters<ServerToClientEvents[E]>[0]) => boolean = () => true,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // biome-ignore lint/suspicious/noExplicitAny: generic event plumbing
      (socket.off as any)(event, handler);
      reject(new Error(`timed out waiting for ${String(event)}`));
    }, timeoutMs);
    const handler = (payload: Parameters<ServerToClientEvents[E]>[0]) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      // biome-ignore lint/suspicious/noExplicitAny: generic event plumbing
      (socket.off as any)(event, handler);
      resolve(payload);
    };
    // biome-ignore lint/suspicious/noExplicitAny: generic event plumbing
    (socket.on as any)(event, handler);
  });
}
