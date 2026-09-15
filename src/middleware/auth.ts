import type { NextFunction, Request, Response } from "express";
import { env } from "#/config/env.js";
import { UnauthorizedError } from "#/lib/errors.js";
import { verifyAccessToken } from "#/lib/jwt.js";

/**
 * Verifies the access token and attaches `req.auth`. Does NOT set the tenant
 * RLS context — that's `tenantContextMiddleware`'s job — and does NOT load
 * permissions — that's `loadPermissions`'s job. Keeping these separate means
 * a route that only needs identity (e.g. `GET /me`) doesn't pay for a
 * permission-cache lookup it never uses.
 *
 * Reads the token from the access-token cookie first, falling back to
 * `Authorization: Bearer` for non-browser clients (CLIs, mobile, server-to-server).
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      throw new UnauthorizedError("Missing access token");
    }

    const claims = await verifyAccessToken(token);

    req.auth = {
      userId: claims.sub,
      tenantId: claims.tid,
      email: claims.email,
      roleId: claims.rid,
    };
    next();
  } catch (err) {
    next(
      err instanceof UnauthorizedError
        ? err
        : new UnauthorizedError("Invalid or expired token"),
    );
  }
}

function extractToken(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const cookieToken = cookies?.[env.COOKIE_ACCESS_NAME];
  if (typeof cookieToken === "string" && cookieToken.length > 0) {
    return cookieToken;
  }

  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const bearer = header.slice("Bearer ".length).trim();
    if (bearer) return bearer;
  }

  return null;
}
