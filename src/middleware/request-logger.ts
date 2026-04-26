import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import { logger } from '#/lib/logger.js';

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers['x-request-id'];
    const id = typeof existing === 'string' && existing.length > 0 ? existing : randomUUID();
    res.setHeader('x-request-id', id);
    // Make available on req for handlers + error handler
    (req as unknown as { requestId: string }).requestId = id;
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${String(res.statusCode)}`,
  customErrorMessage: (req, res) => `${req.method} ${req.url} ${String(res.statusCode)} (error)`,
});
