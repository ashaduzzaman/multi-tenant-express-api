import compression from 'compression';
import cors from 'cors';
import express, { type Application } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from '#/config/env.js';
import { pingTenantContext } from '#/db/tenant-context.js';
import { errorHandler, notFoundHandler } from '#/middleware/error-handler.js';
import { requestLogger } from '#/middleware/request-logger.js';

export function createApp(): Application {
  const app = express();

  // Trust proxy ONLY in production behind a known load balancer
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // ─── Security & basics ──────────────────────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS,
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // ─── Logging ────────────────────────────────────────────────────────────
  app.use(requestLogger);

  // ─── Rate limiting ──────────────────────────────────────────────────────
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  // ─── Health checks ──────────────────────────────────────────────────────
  // Liveness: process is up
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
  // Readiness: DB reachable + RLS context mechanism works
  app.get('/readyz', (_req, res, next) => {
    pingTenantContext()
      .then((ok) => {
        if (ok) res.json({ status: 'ready' });
        else res.status(503).json({ status: 'not_ready', reason: 'db_or_rls' });
      })
      .catch(next);
  });

  // ─── Feature routes ─────────────────────────────────────────────────────
  // TODO (Claude Code): mount module routers here, e.g.
  //   app.use('/api/v1/auth', authRouter);
  //   app.use('/api/v1/users', authMiddleware, tenantContextMiddleware, usersRouter);
  // See CLAUDE.md → "Adding a New Feature Module" for the pattern.

  // ─── 404 + error handler MUST be last ───────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
