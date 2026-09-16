import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import express, { type Application } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPrisma, disconnectAll } from "#/db/client.js";
import { errorHandler, notFoundHandler } from "#/middleware/error-handler.js";
import { syncPermissions } from "#/lib/sync-permissions.js";
import { authRouter } from "./auth.router.js";

function buildTestApp(): Application {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/v1/auth", authRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("auth router (e2e)", () => {
  const app = buildTestApp();

  beforeAll(async () => {
    await syncPermissions(adminPrisma);
  });

  afterAll(async () => {
    await disconnectAll();
  });

  function registerPayload(overrides: Partial<Record<string, string>> = {}) {
    const unique = randomUUID();
    return {
      tenantName: "Acme",
      tenantSlug: `acme-${unique}`,
      email: `owner-${unique}@acme.test`,
      password: "correct-horse-battery",
      name: "Ada Owner",
      ...overrides,
    };
  }

  it("registers a tenant + owner, setting access and refresh cookies", async () => {
    const payload = registerPayload();

    const res = await request(app).post("/api/v1/auth/register").send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(payload.email);
    expect(res.body.data.user).not.toHaveProperty("passwordHash");

    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c) => c.startsWith("mt_access="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("mt_refresh="))).toBe(true);
    expect(cookies.find((c) => c.startsWith("mt_refresh="))).toMatch(
      /Path=\/api\/v1\/auth\/refresh/,
    );
  });

  it("rejects registration with an invalid payload (422)", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      tenantName: "",
      tenantSlug: "x",
      email: "not-an-email",
      password: "123",
      name: "",
    });

    expect(res.status).toBe(422);
  });

  it("rejects a duplicate tenant slug with 409", async () => {
    const payload = registerPayload();
    await request(app).post("/api/v1/auth/register").send(payload);

    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(registerPayload({ tenantSlug: payload.tenantSlug }));

    expect(res.status).toBe(409);
  });

  it("logs in with correct credentials and rejects incorrect ones identically", async () => {
    const payload = registerPayload();
    await request(app).post("/api/v1/auth/register").send(payload);

    const good = await request(app).post("/api/v1/auth/login").send({
      tenantSlug: payload.tenantSlug,
      email: payload.email,
      password: payload.password,
    });
    expect(good.status).toBe(200);
    expect(good.body.data.user.email).toBe(payload.email);

    const bad = await request(app).post("/api/v1/auth/login").send({
      tenantSlug: payload.tenantSlug,
      email: payload.email,
      password: "wrong",
    });
    expect(bad.status).toBe(401);

    const unknownTenant = await request(app).post("/api/v1/auth/login").send({
      tenantSlug: "does-not-exist",
      email: payload.email,
      password: payload.password,
    });
    expect(unknownTenant.status).toBe(401);
    expect(unknownTenant.body.error.message).toBe(bad.body.error.message);
  });

  it("supports the full register → me → refresh → logout → refresh-fails flow", async () => {
    const payload = registerPayload();
    const registerRes = await request(app)
      .post("/api/v1/auth/register")
      .send(payload);
    const cookies = extractCookies(registerRes);

    const meRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", cookies.join("; "));
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.email).toBe(payload.email);
    expect(meRes.body.data.permissions).toContain("users:read");

    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set(
        "Cookie",
        cookies.filter((c) => c.startsWith("mt_refresh=")).join("; "),
      );
    expect(refreshRes.status).toBe(200);
    const newCookies = extractCookies(refreshRes);

    // Old refresh token was rotated out — reusing it must fail.
    const reuseOldRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set(
        "Cookie",
        cookies.filter((c) => c.startsWith("mt_refresh=")).join("; "),
      );
    expect(reuseOldRefresh.status).toBe(401);

    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set(
        "Cookie",
        newCookies.filter((c) => c.startsWith("mt_refresh=")).join("; "),
      );
    expect(logoutRes.status).toBe(200);

    const refreshAfterLogout = await request(app)
      .post("/api/v1/auth/refresh")
      .set(
        "Cookie",
        newCookies.filter((c) => c.startsWith("mt_refresh=")).join("; "),
      );
    expect(refreshAfterLogout.status).toBe(401);
  });

  it("rejects /me without a token (401)", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });
});

function extractCookies(res: request.Response): string[] {
  const raw = res.headers["set-cookie"] as unknown as string[];
  return raw.map((c) => c.split(";")[0]!);
}
