import type { NextFunction, Request, Response } from 'express';
import { TenantContextError } from '#/lib/errors.js';

/**
 * Mount AFTER authMiddleware. Establishes `req.tenantId` from the verified
 * JWT claim. Handlers then pass it to withTenantContext() to scope queries.
 *
 * NOTE: This middleware does NOT itself open a DB transaction or set the
 * RLS GUC — that happens lazily inside withTenantContext() so we only burn
 * a connection when we actually need one. (Health checks, 304 cache hits,
 * static asset routes etc. don't touch the DB.)
 *
 * If you need tenant resolution from a subdomain or header instead of the
 * JWT (e.g., for a public route that's still tenant-scoped), build a separate
 * middleware that sets req.tenantId from req.hostname / req.headers and mount
 * it INSTEAD of authMiddleware on those routes.
 */
export function tenantContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.auth) {
    return next(
      new TenantContextError(
        'tenantContextMiddleware ran before authMiddleware (or auth was skipped)',
      ),
    );
  }
  req.tenantId = req.auth.tenantId;
  next();
}

/**
 * Type-narrowing accessor — throws (a real error, never undefined) if used in
 * a handler where tenant context isn't established. Prefer this over
 * `req.tenantId!` in handler code.
 */
export function requireTenantId(req: Request): string {
  if (!req.tenantId) {
    throw new TenantContextError('Handler requires tenant context but none was set');
  }
  return req.tenantId;
}
