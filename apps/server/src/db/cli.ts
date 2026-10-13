import { loadEnv } from '../config/env';
import { createLogger } from '../lib/logger';
import { createDatabase } from './client';
import { runMigrations } from './migrate';
import { seed } from './seed';

const command = process.argv[2];
const env = loadEnv();
const log = createLogger(env.LOG_LEVEL, false);
const database = createDatabase(env.DATABASE_URL, 2);

try {
  if (command === 'migrate') {
    await runMigrations(database);
    log.info('migrations applied');
  } else if (command === 'seed') {
    await seed(database.db, log);
    log.info('seed complete');
  } else {
    log.error('usage: cli.ts <migrate|seed>');
    process.exitCode = 1;
  }
} finally {
  await database.close();
}
