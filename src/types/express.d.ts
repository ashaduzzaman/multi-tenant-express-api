/**
 * Augments Express's Request type with our auth + tenant context.
 *
 * Populated by middleware in this order:
 *   1. authMiddleware       → req.auth         (the verified JWT claims)
 *   2. tenantContextMiddleware → req.tenantId  (resolved + verified tenant)
 *
 * Any handler that requires these fields MUST be mounted AFTER both middlewares.
 * Reading them when not set is a programmer error — use the `requireAuth()` /
 * `requireTenant()` helpers in lib/request-context.ts (TODO: write these) to
 * fail loudly instead of silently coercing to undefined.
 */

export interface AuthContext {
  userId: string;
  tenantId: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      tenantId?: string;
      requestId?: string;
    }
  }
}

export {};
