import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { adminPrisma, disconnectAll } from '#/db/client.js';
import { ConflictError } from '#/lib/errors.js';
import * as repo from './users.repo.js';

describe('users.repo', () => {
  afterAll(async () => {
    await disconnectAll();
  });

  async function makeTenantWithRole() {
    const tenant = await adminPrisma.tenant.create({ data: { slug: `u-${randomUUID()}`, name: 'X' } });
    const role = await adminPrisma.role.create({ data: { tenantId: tenant.id, name: 'Member' } });
    return { tenant, role };
  }

  describe('createUser / findUserById', () => {
    it('creates a user and finds it back', async () => {
      const { tenant, role } = await makeTenantWithRole();
      const user = await repo.createUser(tenant.id, {
        email: 'a@b.test',
        name: 'A',
        roleId: role.id,
        passwordHash: 'hash',
      });

      expect(user.email).toBe('a@b.test');
      expect(user.roleId).toBe(role.id);

      const found = await repo.findUserById(tenant.id, user.id);
      expect(found?.id).toBe(user.id);
    });

    it('throws ConflictError for a duplicate email within the same tenant', async () => {
      const { tenant, role } = await makeTenantWithRole();
      await repo.createUser(tenant.id, {
        email: 'dup@b.test',
        name: 'A',
        roleId: role.id,
        passwordHash: 'hash',
      });

      await expect(
        repo.createUser(tenant.id, {
          email: 'dup@b.test',
          name: 'B',
          roleId: role.id,
          passwordHash: 'hash',
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('does not find a user belonging to a different tenant (RLS)', async () => {
      const t1 = await makeTenantWithRole();
      const t2 = await makeTenantWithRole();
      const user = await repo.createUser(t1.tenant.id, {
        email: 'x@b.test',
        name: 'X',
        roleId: t1.role.id,
        passwordHash: 'hash',
      });

      expect(await repo.findUserById(t2.tenant.id, user.id)).toBeNull();
    });

    it('does not find a soft-deleted user', async () => {
      const { tenant, role } = await makeTenantWithRole();
      const user = await repo.createUser(tenant.id, {
        email: 'del@b.test',
        name: 'D',
        roleId: role.id,
        passwordHash: 'hash',
      });
      await repo.softDeleteUser(tenant.id, user.id);

      expect(await repo.findUserById(tenant.id, user.id)).toBeNull();
    });
  });

  describe('listUsers', () => {
    it('paginates and excludes soft-deleted users', async () => {
      const { tenant, role } = await makeTenantWithRole();
      const kept = await repo.createUser(tenant.id, {
        email: 'kept@b.test',
        name: 'Kept',
        roleId: role.id,
        passwordHash: 'hash',
      });
      const gone = await repo.createUser(tenant.id, {
        email: 'gone@b.test',
        name: 'Gone',
        roleId: role.id,
        passwordHash: 'hash',
      });
      await repo.softDeleteUser(tenant.id, gone.id);

      const page = await repo.listUsers(tenant.id, {
        page: 1,
        pageSize: 10,
        sort: 'email',
        order: 'asc',
      });

      expect(page.total).toBe(1);
      expect(page.data.map((u) => u.id)).toEqual([kept.id]);
    });
  });

  describe('updateUser', () => {
    it('updates name/email/roleId', async () => {
      const { tenant, role } = await makeTenantWithRole();
      const otherRole = await adminPrisma.role.create({
        data: { tenantId: tenant.id, name: 'Admin' },
      });
      const user = await repo.createUser(tenant.id, {
        email: 'up@b.test',
        name: 'Before',
        roleId: role.id,
        passwordHash: 'hash',
      });

      const updated = await repo.updateUser(tenant.id, user.id, {
        name: 'After',
        roleId: otherRole.id,
      });

      expect(updated?.name).toBe('After');
      expect(updated?.roleId).toBe(otherRole.id);
    });

    it('returns null when the user does not exist', async () => {
      const { tenant } = await makeTenantWithRole();
      expect(await repo.updateUser(tenant.id, randomUUID(), { name: 'X' })).toBeNull();
    });
  });

  describe('updatePassword', () => {
    it('updates the password hash', async () => {
      const { tenant, role } = await makeTenantWithRole();
      const user = await repo.createUser(tenant.id, {
        email: 'pw@b.test',
        name: 'P',
        roleId: role.id,
        passwordHash: 'old-hash',
      });

      await repo.updatePassword(tenant.id, user.id, 'new-hash');

      const raw = await adminPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(raw.passwordHash).toBe('new-hash');
    });
  });

  describe('softDeleteUser', () => {
    it('is idempotent — deleting twice does not throw', async () => {
      const { tenant, role } = await makeTenantWithRole();
      const user = await repo.createUser(tenant.id, {
        email: 'sd@b.test',
        name: 'S',
        roleId: role.id,
        passwordHash: 'hash',
      });

      await repo.softDeleteUser(tenant.id, user.id);
      await expect(repo.softDeleteUser(tenant.id, user.id)).resolves.toBeUndefined();
    });
  });
});
