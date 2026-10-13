import { createGameApp } from './app';
import { loadEnv } from './config/env';
import { createLogger } from './lib/logger';

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

const app = await createGameApp(env, { logger: log });
const port = await app.listen(env.PORT);
log.info({ port, instance: env.INSTANCE_ID }, 'server listening');

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await app.stop();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
