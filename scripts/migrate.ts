import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { adminDb, closePools } from '#/db/index.js';
import { logger } from '#/lib/logger.js';

async function main(): Promise<void> {
  logger.info('running migrations…');
  await migrate(adminDb, { migrationsFolder: './db/migrations' });
  logger.info('✅ migrations complete');
  await closePools();
}

main().catch((err: unknown) => {
  logger.error({ err }, '❌ migration failed');
  process.exit(1);
});
