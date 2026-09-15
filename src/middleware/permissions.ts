import type { NextFunction, Request, Response } from 'express';
import { withTenantContextReadOnly } from '#/db/tenant-context.js';
import { ForbiddenError, UnauthorizedError } from '#/lib/errors.js';
import { permissionCache } from '#/lib/permission-cache.js';

/**
 * Mount AFTER authMiddleware + tenantContextMiddleware. Loads the caller's
 * permissions (via the 5-minute cache, falling back to a real query on a
 * miss) and attaches them to `req.auth.permissions`.
 *
 * Deliberately its own middleware, not folded into authMiddleware: routes
 * that only need identity (e.g. `GET /me`) shouldn't pay for a permission
 * lookup they never use.
 */
export async function loadPermissions(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.auth) {
      throw new UnauthorizedError();
    }
    const { tenantId, roleId } = req.auth;
    req.auth.permissions = await permissionCache.getPermissions(tenantId, roleId, () =>
      fetchPermissions(tenantId, roleId),
    );
    next();
  } catch (err) {
    next(err);
  }
}

async function fetchPermissions(tenantId: string, roleId: string): Promise<string[]> {
  const rows = await withTenantContextReadOnly(tenantId, (tx) =>
    tx.rolePermission.findMany({ where: { roleId }, include: { permission: true } }),
  );
  return rows.map((r) => r.permission.name);
}

/** Mount AFTER loadPermissions. */
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth?.permissions?.includes(permission)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}

/**
 * Passes if the caller holds ANY of the given permissions — for routes
 * shared across contexts where no single static permission covers every
 * legitimate caller.
 */
export function requireAnyPermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!permissions.some((p) => req.auth?.permissions?.includes(p))) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}

/**
 * Passes if the caller IS the resource identified by `req.params[paramName]`
 * (e.g. changing your own password), OR holds `permission` (e.g. an admin
 * changing someone else's). Everyone should always be able to act on their
 * own account regardless of what else their role grants — this is the
 * middleware-level expression of that rule, kept out of handlers/services.
 */
export function requireSelfOrPermission(paramName: string, permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const isSelf = !!req.auth && req.params[paramName] === req.auth.userId;
    const hasPermission = !!req.auth?.permissions?.includes(permission);
    if (!isSelf && !hasPermission) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}
