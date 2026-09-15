import cookieParser from "cookie-parser";
import express, { type Application } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPrisma, disconnectAll } from "#/db/client.js";
import { errorHandler, notFoundHandler } from "#/middleware/error-handler.js";
import { syncPermissions } from "#/lib/sync-permissions.js";
import { authRouter } from "#/modules/auth/auth.router.js";
import {
  registerOwner,
  loginAsSeededRole,
} from "../../../tests/helpers/e2e-auth.js";
import { usersRouter } from "./users.router.js";

function buildTestApp(): Application {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/users", usersRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("users router (e2e)", () => {
  const app = buildTestApp();

  beforeAll(async () => {
    await syncPermissions(adminPrisma);
  });

  afterAll(async () => {
    await disconnectAll();
  });

  it("lists the owner as the sole user right after registration", async () => {
    const owner = await registerOwner(app);
    const res = await request(app)
      .get("/api/v1/users")
      .set("Cookie", owner.cookies.join("; "));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].email).toBe(owner.email);
    expect(res.body.data[0]).not.toHaveProperty("passwordHash");
  });

  it("creates, fetches, updates, and soft-deletes a user as Owner", async () => {
    const owner = await registerOwner(app);
    const memberRole = await adminPrisma.role.findFirstOrThrow({
      where: { tenantId: owner.tenantId, name: "Member" },
    });

    const createRes = await request(app)
      .post("/api/v1/users")
      .set("Cookie", owner.cookies.join("; "))
      .send({
        email: "new@acme.test",
        name: "New User",
        password: "password123",
        roleId: memberRole.id,
      });
    expect(createRes.status).toBe(201);
    const userId = createRes.body.data.id;

    const getRes = await request(app)
      .get(`/api/v1/users/${userId}`)
      .set("Cookie", owner.cookies.join("; "));
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.email).toBe("new@acme.test");

    const updateRes = await request(app)
      .put(`/api/v1/users/${userId}`)
      .set("Cookie", owner.cookies.join("; "))
      .send({ name: "Renamed User" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.name).toBe("Renamed User");

    const deleteRes = await request(app)
      .delete(`/api/v1/users/${userId}`)
      .set("Cookie", owner.cookies.join("; "));
    expect(deleteRes.status).toBe(204);

    const getAfterDelete = await request(app)
      .get(`/api/v1/users/${userId}`)
      .set("Cookie", owner.cookies.join("; "));
    expect(getAfterDelete.status).toBe(404);
  });

  it("refuses to let a user delete themself (400)", async () => {
    const owner = await registerOwner(app);
    const res = await request(app)
      .delete(`/api/v1/users/${owner.userId}`)
      .set("Cookie", owner.cookies.join("; "));
    expect(res.status).toBe(400);
  });

  it("lets a Member change their OWN password without users:update", async () => {
    const owner = await registerOwner(app);
    const member = await loginAsSeededRole(app, owner.tenantSlug, "Member");

    const res = await request(app)
      .put(`/api/v1/users/${member.userId}/password`)
      .set("Cookie", member.cookies.join("; "))
      .send({ password: "brand-new-password-1" });

    expect(res.status).toBe(200);
  });

  it("refuses a Member changing someone ELSE's password (403)", async () => {
    const owner = await registerOwner(app);
    const member = await loginAsSeededRole(app, owner.tenantSlug, "Member");

    const res = await request(app)
      .put(`/api/v1/users/${owner.userId}/password`)
      .set("Cookie", member.cookies.join("; "))
      .send({ password: "brand-new-password-2" });

    expect(res.status).toBe(403);
  });

  it("rejects user creation from a Member (403 — lacks users:create)", async () => {
    const owner = await registerOwner(app);
    const member = await loginAsSeededRole(app, owner.tenantSlug, "Member");
    const memberRole = await adminPrisma.role.findFirstOrThrow({
      where: { tenantId: owner.tenantId, name: "Member" },
    });

    const res = await request(app)
      .post("/api/v1/users")
      .set("Cookie", member.cookies.join("; "))
      .send({
        email: "x@acme.test",
        name: "X",
        password: "password123",
        roleId: memberRole.id,
      });

    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated access (401)", async () => {
    const res = await request(app).get("/api/v1/users");
    expect(res.status).toBe(401);
  });
});
