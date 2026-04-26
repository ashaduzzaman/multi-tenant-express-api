import type { NextFunction, Request, Response } from 'express';
import { jwtVerify } from 'jose';
import { z } from 'zod';
import { env } from '#/config/env.js';
import { UnauthorizedError } from '#/lib/errors.js';

const jwtPayloadSchema = z.object({
  sub: z.string().uuid(), // user id
  tid: z.string().uuid(), // tenant id
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member']),
});

const secret = new TextEncoder().encode(env.JWT_SECRET);

/**
 * Verifies the Bearer token and attaches `req.auth`.
 * Does NOT set the tenant RLS context — that's `tenantContextMiddleware`'s job.
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new UnauthorizedError('Empty bearer token');

    const { payload } = await jwtVerify(token, secret, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

    const claims = jwtPayloadSchema.safeParse(payload);
    if (!claims.success) {
      throw new UnauthorizedError('Invalid token claims');
    }

    req.auth = {
      userId: claims.data.sub,
      tenantId: claims.data.tid,
      email: claims.data.email,
      role: claims.data.role,
    };
    next();
  } catch (err) {
    if (err instanceof UnauthorizedError) return next(err);
    next(new UnauthorizedError('Invalid or expired token'));
  }
}

/**
 * Role-gating helper. Mount AFTER authMiddleware.
 *   router.delete('/x', authMiddleware, requireRole('owner', 'admin'), handler)
 */
export function requireRole(...allowed: Array<'owner' | 'admin' | 'member'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(new UnauthorizedError());
    if (!allowed.includes(req.auth.role)) {
      return next(new UnauthorizedError('Insufficient role'));
    }
    next();
  };
}
