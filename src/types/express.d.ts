/**
 * Augments Express's Request type with our auth + tenant context.
 *
 * Populated by middleware in this order:
 *   1. authMiddleware          → req.auth        (the verified JWT claims)
 *   2. tenantContextMiddleware → req.tenantId    (resolved + verified tenant)
 *   3. loadPermissions         → req.auth.permissions (fetched via the RBAC cache)
 *
 * Any handler that requires these fields MUST be mounted AFTER the relevant
 * middlewares. Reading them when not set is a programmer error — use
 * `requireTenantId()` (middleware/tenant-context.ts) to fail loudly instead
 * of silently coercing to undefined.
 */

export interface AuthContext {
  userId: string;
  tenantId: string;
  email: string;
  roleId: string;
  /** Populated by `loadPermissions` middleware; absent before it runs. */
  permissions?: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      tenantId?: string;
      requestId?: string;
    }
  }
}

export {};
