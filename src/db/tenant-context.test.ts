import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { adminPrisma, disconnectAll } from "./client.js";
import {
  pingTenantContext,
  withTenantContext,
  withTenantContextReadOnly,
} from "./tenant-context.js";
import { TenantContextError } from "#/lib/errors.js";

describe("withTenantContext", () => {
  afterAll(async () => {
    await disconnectAll();
  });

  it("rejects a missing tenantId before touching the database", async () => {
    await expect(
      withTenantContext("", async (tx) => tx.tenant.findMany()),
    ).rejects.toThrow(TenantContextError);
  });

  it("scopes SELECTs to only the given tenant — proves RLS isolation", async () => {
    const tenantA = await adminPrisma.tenant.create({
      data: { slug: `a-${randomUUID()}`, name: "Tenant A" },
    });
    const tenantB = await adminPrisma.tenant.create({
      data: { slug: `b-${randomUUID()}`, name: "Tenant B" },
    });

    const seenByA = await withTenantContext(tenantA.id, (tx) =>
      tx.tenant.findMany(),
    );
    expect(seenByA.map((t) => t.id)).toEqual([tenantA.id]);

    const seenByB = await withTenantContext(tenantB.id, (tx) =>
      tx.tenant.findMany(),
    );
    expect(seenByB.map((t) => t.id)).toEqual([tenantB.id]);
  });

  it("returns zero rows for a tenant id that matches no row", async () => {
    const seen = await withTenantContext(randomUUID(), (tx) =>
      tx.tenant.findMany(),
    );
    expect(seen).toHaveLength(0);
  });

  it("rolls back and rethrows when the callback throws", async () => {
    const tenant = await adminPrisma.tenant.create({
      data: { slug: `rollback-${randomUUID()}`, name: "Rollback Tenant" },
    });

    await expect(
      withTenantContext(tenant.id, async (tx) => {
        await tx.tenant.update({
          where: { id: tenant.id },
          data: { name: "mutated" },
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const reread = await adminPrisma.tenant.findUniqueOrThrow({
      where: { id: tenant.id },
    });
    expect(reread.name).toBe("Rollback Tenant");
  });

  describe("withTenantContextReadOnly", () => {
    it("rejects a missing tenantId before touching the database", async () => {
      await expect(
        withTenantContextReadOnly("", async (tx) => tx.tenant.findMany()),
      ).rejects.toThrow(TenantContextError);
    });

    it("allows reads scoped to the tenant", async () => {
      const tenant = await adminPrisma.tenant.create({
        data: { slug: `ro-${randomUUID()}`, name: "RO Tenant" },
      });
      const seen = await withTenantContextReadOnly(tenant.id, (tx) =>
        tx.tenant.findMany(),
      );
      expect(seen.map((t) => t.id)).toEqual([tenant.id]);
    });

    it("rejects a write attempted inside the read-only transaction", async () => {
      const tenant = await adminPrisma.tenant.create({
        data: { slug: `ro-write-${randomUUID()}`, name: "RO Write Tenant" },
      });

      await expect(
        withTenantContextReadOnly(tenant.id, (tx) =>
          tx.tenant.update({
            where: { id: tenant.id },
            data: { name: "nope" },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("pingTenantContext", () => {
    it("confirms the GUC mechanism round-trips through a real transaction", async () => {
      await expect(pingTenantContext()).resolves.toBe(true);
    });
  });
});
