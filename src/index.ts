import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePools } from './db/index.js';
import { logger } from './lib/logger.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, '🚀 server listening');
});

// ─── Graceful shutdown ──────────────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown requested');

  const forceTimer = setTimeout(() => {
    logger.error('forced shutdown after 15s');
    process.exit(1);
  }, 15_000);
  forceTimer.unref();

  server.close((err) => {
    if (err) logger.error({ err }, 'error closing http server');
  });

  try {
    await closePools();
    logger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error closing db pools');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'unhandled rejection — crashing');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — crashing');
  process.exit(1);
});
