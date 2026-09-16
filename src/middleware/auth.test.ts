import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { signAccessToken } from "#/lib/jwt.js";
import { UnauthorizedError } from "#/lib/errors.js";
import { authMiddleware } from "./auth.js";

function fakeRequest(opts: { cookie?: string; bearer?: string }): Request {
  return {
    cookies: opts.cookie !== undefined ? { mt_access: opts.cookie } : {},
    headers:
      opts.bearer !== undefined
        ? { authorization: `Bearer ${opts.bearer}` }
        : {},
  } as unknown as Request;
}

async function validToken(
  overrides: Partial<Record<string, string>> = {},
): Promise<{
  token: string;
  userId: string;
  tenantId: string;
  roleId: string;
  email: string;
}> {
  const userId = overrides.sub ?? randomUUID();
  const tenantId = overrides.tid ?? randomUUID();
  const roleId = overrides.rid ?? randomUUID();
  const email = overrides.email ?? "user@example.test";
  const token = await signAccessToken({
    sub: userId,
    tid: tenantId,
    rid: roleId,
    email,
  });
  return { token, userId, tenantId, roleId, email };
}

describe("authMiddleware", () => {
  it("authenticates from the access cookie and populates req.auth", async () => {
    const { token, userId, tenantId, roleId, email } = await validToken();
    const req = fakeRequest({ cookie: token });
    const next = vi.fn() as NextFunction;

    await authMiddleware(req, {} as Response, next);

    expect(req.auth).toEqual({ userId, tenantId, roleId, email });
    expect(next).toHaveBeenCalledWith();
  });

  it("falls back to the Authorization: Bearer header when there is no cookie", async () => {
    const { token, userId } = await validToken();
    const req = fakeRequest({ bearer: token });
    const next = vi.fn() as NextFunction;

    await authMiddleware(req, {} as Response, next);

    expect(req.auth?.userId).toBe(userId);
    expect(next).toHaveBeenCalledWith();
  });

  it("prefers the cookie over the Bearer header when both are present", async () => {
    const cookieToken = await validToken();
    const bearerToken = await validToken();
    const req = {
      cookies: { mt_access: cookieToken.token },
      headers: { authorization: `Bearer ${bearerToken.token}` },
    } as unknown as Request;
    const next = vi.fn() as NextFunction;

    await authMiddleware(req, {} as Response, next);

    expect(req.auth?.userId).toBe(cookieToken.userId);
  });

  it("calls next with UnauthorizedError when neither cookie nor header is present", async () => {
    const req = fakeRequest({});
    const next = vi.fn() as NextFunction;

    await authMiddleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("calls next with UnauthorizedError for a malformed Bearer header", async () => {
    const req = {
      cookies: {},
      headers: { authorization: "Basic abc123" },
    } as unknown as Request;
    const next = vi.fn() as NextFunction;

    await authMiddleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it("calls next with UnauthorizedError for an invalid token", async () => {
    const req = fakeRequest({ cookie: "garbage.token.value" });
    const next = vi.fn() as NextFunction;

    await authMiddleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });
});
