import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { env } from "#/config/env.js";
import { UnauthorizedError } from "#/lib/errors.js";
import {
  signAccessToken,
  verifyAccessToken,
  type AccessTokenClaims,
} from "./jwt.js";

function claims(overrides: Partial<AccessTokenClaims> = {}): AccessTokenClaims {
  return {
    sub: randomUUID(),
    tid: randomUUID(),
    email: "user@example.test",
    rid: randomUUID(),
    ...overrides,
  };
}

describe("signAccessToken / verifyAccessToken", () => {
  it("round-trips claims through sign then verify", async () => {
    const input = claims();
    const token = await signAccessToken(input);
    const output = await verifyAccessToken(token);
    expect(output).toEqual(input);
  });

  it("rejects a token signed with a different secret", async () => {
    const badSecret = new TextEncoder().encode(
      "a-completely-different-secret-of-32-plus-chars",
    );
    const token = await new SignJWT({ ...claims() })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setExpirationTime("15m")
      .sign(badSecret);

    await expect(verifyAccessToken(token)).rejects.toThrow(UnauthorizedError);
  });

  it("rejects an expired token", async () => {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const token = await new SignJWT({ ...claims() })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .sign(secret);

    await expect(verifyAccessToken(token)).rejects.toThrow(UnauthorizedError);
  });

  it("rejects a token with the wrong issuer", async () => {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const token = await new SignJWT({ ...claims() })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer("someone-else")
      .setAudience(env.JWT_AUDIENCE)
      .setExpirationTime("15m")
      .sign(secret);

    await expect(verifyAccessToken(token)).rejects.toThrow(UnauthorizedError);
  });

  it("rejects a structurally valid token missing required claims", async () => {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const token = await new SignJWT({ sub: randomUUID() }) // missing tid/email/rid
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setExpirationTime("15m")
      .sign(secret);

    await expect(verifyAccessToken(token)).rejects.toThrow(UnauthorizedError);
  });

  it("rejects garbage input", async () => {
    await expect(verifyAccessToken("not-a-jwt")).rejects.toThrow(
      UnauthorizedError,
    );
  });
});
