import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '#/lib/errors.js';
import { logger } from '#/lib/logger.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.requestId;

  // Zod validation errors → 422 with field details
  if (err instanceof ZodError) {
    const body: ErrorBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.flatten(),
        requestId,
      },
    };
    res.status(422).json(body);
    return;
  }

  // Known operational errors → use their statusCode/code
  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    };
    if (err.statusCode >= 500) {
      logger.error({ err, requestId }, 'operational error (5xx)');
    } else {
      logger.warn({ err, requestId }, 'operational error');
    }
    res.status(err.statusCode).json(body);
    return;
  }

  // Unknown errors → never expose internals
  logger.error({ err, requestId }, 'unexpected error');
  const body: ErrorBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    },
  };
  res.status(500).json(body);
};

// 404 handler — mount AFTER all routes, BEFORE errorHandler.
//
// Must be a plain (3-arg) RequestHandler, NOT ErrorRequestHandler. Express
// decides whether a middleware is an error handler purely by counting its
// declared parameters (arity 4 = error handler). A 4-arg "404 handler"
// would only ever run when something upstream calls next(err) — at which
// point it intercepts EVERY error before errorHandler ever sees it and
// reports a misleading generic 404 instead of the real error. It only runs
// for real "nothing matched" cases when it takes no err param at all.
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
};
