import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { env } from "#/config/env.js";
import { UnauthorizedError } from "#/lib/errors.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);

const accessTokenClaimsSchema = z.object({
  sub: z.string().uuid(), // user id
  tid: z.string().uuid(), // tenant id
  email: z.string().email(),
  rid: z.string().uuid(), // role id — permissions are looked up fresh, never embedded
});

export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

export async function signAccessToken(
  claims: AccessTokenClaims,
): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(secret);
}

/** Throws UnauthorizedError (never a raw jose/zod error) for any invalid token. */
export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    const claims = accessTokenClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new UnauthorizedError("Invalid token claims");
    }
    return claims.data;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError("Invalid or expired token");
  }
}
