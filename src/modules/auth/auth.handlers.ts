import type { CookieOptions, Request, Response } from "express";
import { asyncHandler } from "#/lib/async-handler.js";
import { env } from "#/config/env.js";
import { UnauthorizedError } from "#/lib/errors.js";
import { requireTenantId } from "#/middleware/tenant-context.js";
import { authService, type AuthResult } from "./auth.service.js";
import { loginInput, registerInput } from "./auth.schema.js";

const REFRESH_COOKIE_PATH = "/api/v1/auth/refresh";

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
  };
}

function setAuthCookies(res: Response, result: AuthResult): void {
  res.cookie(env.COOKIE_ACCESS_NAME, result.accessToken, {
    ...baseCookieOptions(),
    maxAge: 15 * 60 * 1000, // matches the access token's own TTL (JWT_ACCESS_TTL)
  });
  res.cookie(env.COOKIE_REFRESH_NAME, result.refreshToken, {
    ...baseCookieOptions(),
    path: REFRESH_COOKIE_PATH,
    expires: result.refreshTokenExpiresAt,
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(env.COOKIE_ACCESS_NAME, baseCookieOptions());
  res.clearCookie(env.COOKIE_REFRESH_NAME, {
    ...baseCookieOptions(),
    path: REFRESH_COOKIE_PATH,
  });
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const input = registerInput.parse(req.body);
  const result = await authService.register(input);
  setAuthCookies(res, result);
  res.status(201).json({ data: { user: result.user } });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const input = loginInput.parse(req.body);
  const result = await authService.login(input);
  setAuthCookies(res, result);
  res.status(200).json({ data: { user: result.user } });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const refreshToken = cookies?.[env.COOKIE_REFRESH_NAME];
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    throw new UnauthorizedError("No refresh token");
  }

  const result = await authService.refresh(refreshToken);
  setAuthCookies(res, result);
  res.status(200).json({ data: { user: result.user } });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const refreshToken = cookies?.[env.COOKIE_REFRESH_NAME];
  await authService.logout(
    typeof refreshToken === "string" ? refreshToken : undefined,
  );
  clearAuthCookies(res);
  res.status(200).json({ data: { message: "Logged out" } });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireTenantId(req);
  const userId = req.auth?.userId;
  if (!userId) throw new UnauthorizedError();
  const user = await authService.me(tenantId, userId);
  res
    .status(200)
    .json({ data: { user, permissions: req.auth?.permissions ?? [] } });
});
