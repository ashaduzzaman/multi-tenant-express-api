import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wrap an async Express handler so thrown errors / rejected promises are
 * forwarded to next() and reach the global error handler.
 *
 * Usage:
 *   router.get('/', asyncHandler(async (req, res) => { ... }));
 *
 * NOTE: Express 5 forwards rejected promises automatically, so this is mostly
 * defensive / for IDE clarity. Keep using it — it makes intent obvious.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
