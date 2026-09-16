import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { adminPrisma, disconnectAll } from "#/db/client.js";
import { syncPermissions } from "#/lib/sync-permissions.js";
import { createApp } from "./app.js";

describe("createApp (smoke)", () => {
  const app = createApp();

  afterAll(async () => {
    await disconnectAll();
  });

  it("GET /healthz reports liveness", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /readyz reports readiness once the DB/RLS mechanism works", async () => {
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready" });
  });

  it("returns a structured 404 for an unmapped route", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("mounts the auth module at /api/v1/auth", async () => {
    await syncPermissions(adminPrisma);
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        tenantName: "Smoke",
        tenantSlug: `smoke-${randomUUID()}`,
        email: `smoke-${randomUUID()}@test.dev`,
        password: "correct-horse-battery",
        name: "Owner",
      });
    expect(res.status).toBe(201);
  });

  it("mounts roles/users behind auth (401 without a token)", async () => {
    const rolesRes = await request(app).get("/api/v1/roles");
    const usersRes = await request(app).get("/api/v1/users");
    expect(rolesRes.status).toBe(401);
    expect(usersRes.status).toBe(401);
  });
});
