import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client';

/** Resolves to src/db/migrations in development and dist/migrations in the bundle. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));
const MIGRATION_LOCK_ID = 727_2026;

/** Runs pending migrations; the advisory lock makes concurrent replicas wait their turn. */
export async function runMigrations(database: Database): Promise<void> {
  const client = await database.pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await migrate(database.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
