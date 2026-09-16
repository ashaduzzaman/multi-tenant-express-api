import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPrisma, disconnectAll } from "#/db/client.js";
import { ConflictError } from "#/lib/errors.js";
import { syncPermissions } from "#/lib/sync-permissions.js";
import * as repo from "./roles.repo.js";

describe("roles.repo", () => {
  beforeAll(async () => {
    await syncPermissions(adminPrisma);
  });

  afterAll(async () => {
    await disconnectAll();
  });

  async function makeTenant() {
    return adminPrisma.tenant.create({
      data: { slug: `roles-${randomUUID()}`, name: "X" },
    });
  }

  async function permissionIds(names: string[]): Promise<string[]> {
    const rows = await adminPrisma.permission.findMany({
      where: { name: { in: names } },
    });
    return rows.map((r) => r.id);
  }

  describe("createRole / findRoleById", () => {
    it("creates a role with permissions and returns it with stats", async () => {
      const tenant = await makeTenant();
      const ids = await permissionIds(["users:read", "users:create"]);

      const role = await repo.createRole(tenant.id, {
        name: "Support",
        permissionIds: ids,
      });

      expect(role.name).toBe("Support");
      expect(role.isSystem).toBe(false);
      expect(role.permissionIds.sort()).toEqual([...ids].sort());
      expect(role.userCount).toBe(0);

      const found = await repo.findRoleById(tenant.id, role.id);
      expect(found?.id).toBe(role.id);
    });

    it("creates a role with no permissions when permissionIds is omitted", async () => {
      const tenant = await makeTenant();
      const role = await repo.createRole(tenant.id, { name: "Empty" });
      expect(role.permissionIds).toEqual([]);
    });

    it("throws ConflictError for a duplicate name within the same tenant", async () => {
      const tenant = await makeTenant();
      await repo.createRole(tenant.id, { name: "Dup" });
      await expect(repo.createRole(tenant.id, { name: "Dup" })).rejects.toThrow(
        ConflictError,
      );
    });

    it("allows the same role name in two different tenants", async () => {
      const t1 = await makeTenant();
      const t2 = await makeTenant();
      await expect(
        repo.createRole(t1.id, { name: "SameName" }),
      ).resolves.toBeDefined();
      await expect(
        repo.createRole(t2.id, { name: "SameName" }),
      ).resolves.toBeDefined();
    });

    it("does not find a role belonging to a different tenant (RLS)", async () => {
      const t1 = await makeTenant();
      const t2 = await makeTenant();
      const role = await repo.createRole(t1.id, { name: "Isolated" });
      expect(await repo.findRoleById(t2.id, role.id)).toBeNull();
    });
  });

  describe("listRoles", () => {
    it("paginates and includes permissionIds + userCount per role", async () => {
      const tenant = await makeTenant();
      await repo.createRole(tenant.id, { name: "A" });
      await repo.createRole(tenant.id, { name: "B" });

      const page = await repo.listRoles(tenant.id, {
        page: 1,
        pageSize: 10,
        sort: "name",
        order: "asc",
      });

      expect(page.total).toBe(2);
      expect(page.data.map((r) => r.name)).toEqual(["A", "B"]);
      expect(page.data[0]).toHaveProperty("permissionIds");
      expect(page.data[0]).toHaveProperty("userCount");
    });
  });

  describe("updateRole", () => {
    it("renames a role", async () => {
      const tenant = await makeTenant();
      const role = await repo.createRole(tenant.id, { name: "Old" });
      const updated = await repo.updateRole(tenant.id, role.id, {
        name: "New",
      });
      expect(updated.name).toBe("New");
    });

    it("replaces the full permission set when permissionIds is provided", async () => {
      const tenant = await makeTenant();
      const [readId, createId] = await permissionIds([
        "users:read",
        "users:create",
      ]);
      const role = await repo.createRole(tenant.id, {
        name: "R",
        permissionIds: [readId!],
      });

      const updated = await repo.updateRole(tenant.id, role.id, {
        permissionIds: [createId!],
      });

      expect(updated.permissionIds).toEqual([createId]);
    });

    it("leaves permissions untouched when permissionIds is omitted", async () => {
      const tenant = await makeTenant();
      const [readId] = await permissionIds(["users:read"]);
      const role = await repo.createRole(tenant.id, {
        name: "R",
        permissionIds: [readId!],
      });

      const updated = await repo.updateRole(tenant.id, role.id, { name: "R2" });

      expect(updated.permissionIds).toEqual([readId]);
    });
  });

  describe("deleteRole / countUsersForRole", () => {
    it("deletes a role with no users assigned", async () => {
      const tenant = await makeTenant();
      const role = await repo.createRole(tenant.id, { name: "Deletable" });
      await repo.deleteRole(tenant.id, role.id);
      expect(await repo.findRoleById(tenant.id, role.id)).toBeNull();
    });

    it("counts users assigned to a role", async () => {
      const tenant = await makeTenant();
      const role = await repo.createRole(tenant.id, { name: "Staffed" });
      await adminPrisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `u-${randomUUID()}@test.dev`,
          name: "U",
          passwordHash: "x",
          roleId: role.id,
        },
      });

      expect(await repo.countUsersForRole(tenant.id, role.id)).toBe(1);
    });
  });
});
