import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminPrisma, disconnectAll } from '#/db/client.js';
import { ConflictError } from '#/lib/errors.js';
import { syncPermissions } from '#/lib/sync-permissions.js';
import { DEFAULT_ROLE_PERMISSIONS } from '#/config/permissions.js';
import * as repo from './auth.repo.js';

describe('auth.repo', () => {
  beforeAll(async () => {
    await syncPermissions(adminPrisma);
  });

  afterAll(async () => {
    await disconnectAll();
  });

  describe('registerTenantWithOwner', () => {
    it('creates a tenant, seeds Owner/Admin/Member roles with permissions, and creates the owner user', async () => {
      const slug = `acme-${randomUUID()}`;
      const result = await repo.registerTenantWithOwner(
        { tenantName: 'Acme', tenantSlug: slug, email: 'owner@acme.test', name: 'Ada' },
        'hashed-password',
      );

      expect(result.tenantSlug).toBe(slug);

      const roles = await adminPrisma.role.findMany({ where: { tenantId: result.tenantId } });
      expect(roles.map((r) => r.name).sort()).toEqual(['Admin', 'Member', 'Owner']);
      expect(roles.every((r) => r.isSystem)).toBe(true);

      const ownerRole = roles.find((r) => r.name === 'Owner')!;
      expect(result.ownerRoleId).toBe(ownerRole.id);

      const ownerPermCount = await adminPrisma.rolePermission.count({
        where: { roleId: ownerRole.id },
      });
      expect(ownerPermCount).toBe(DEFAULT_ROLE_PERMISSIONS.Owner.length);

      const ownerUser = await adminPrisma.user.findUniqueOrThrow({
        where: { id: result.ownerUserId },
      });
      expect(ownerUser.email).toBe('owner@acme.test');
      expect(ownerUser.roleId).toBe(ownerRole.id);
      expect(ownerUser.passwordHash).toBe('hashed-password');
    });

    it('throws ConflictError when the slug is already taken', async () => {
      const slug = `dup-${randomUUID()}`;
      await repo.registerTenantWithOwner(
        { tenantName: 'Dup', tenantSlug: slug, email: 'a@dup.test', name: 'A' },
        'hash',
      );

      await expect(
        repo.registerTenantWithOwner(
          { tenantName: 'Dup Again', tenantSlug: slug, email: 'b@dup.test', name: 'B' },
          'hash',
        ),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('findTenantBySlug', () => {
    it('finds a tenant by slug', async () => {
      const tenant = await adminPrisma.tenant.create({
        data: { slug: `find-${randomUUID()}`, name: 'Findable' },
      });
      const found = await repo.findTenantBySlug(tenant.slug);
      expect(found?.id).toBe(tenant.id);
    });

    it('returns null for an unknown slug', async () => {
      expect(await repo.findTenantBySlug(`missing-${randomUUID()}`)).toBeNull();
    });
  });

  describe('findUserByEmail (RLS-scoped)', () => {
    it('finds the user within their own tenant', async () => {
      const slug = `find-user-${randomUUID()}`;
      const { tenantId, ownerUserId } = await repo.registerTenantWithOwner(
        { tenantName: 'X', tenantSlug: slug, email: 'find@me.test', name: 'X' },
        'hash',
      );

      const found = await repo.findUserByEmail(tenantId, 'find@me.test');
      expect(found?.id).toBe(ownerUserId);
    });

    it('does NOT find a same-email user belonging to a different tenant', async () => {
      const email = `shared-${randomUUID()}@test.dev`;
      const t1 = await repo.registerTenantWithOwner(
        { tenantName: 'T1', tenantSlug: `t1-${randomUUID()}`, email, name: 'X' },
        'hash',
      );
      const t2 = await repo.registerTenantWithOwner(
        { tenantName: 'T2', tenantSlug: `t2-${randomUUID()}`, email, name: 'X' },
        'hash',
      );

      const foundInT1 = await repo.findUserByEmail(t1.tenantId, email);
      const foundInT2 = await repo.findUserByEmail(t2.tenantId, email);

      expect(foundInT1?.id).toBe(t1.ownerUserId);
      expect(foundInT2?.id).toBe(t2.ownerUserId);
      expect(foundInT1?.id).not.toBe(foundInT2?.id);
    });
  });

  describe('refresh token lifecycle', () => {
    it('creates, finds by hash (global), and deletes a refresh token', async () => {
      const { tenantId, ownerUserId } = await repo.registerTenantWithOwner(
        {
          tenantName: 'RT',
          tenantSlug: `rt-${randomUUID()}`,
          email: `rt-${randomUUID()}@test.dev`,
          name: 'X',
        },
        'hash',
      );
      const tokenHash = randomUUID();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60);

      await repo.createRefreshToken(tenantId, ownerUserId, tokenHash, expiresAt);

      const found = await repo.findRefreshTokenByHash(tokenHash);
      expect(found).toEqual({ tenantId, userId: ownerUserId, expiresAt });

      await repo.deleteRefreshTokenByHash(tenantId, tokenHash);
      expect(await repo.findRefreshTokenByHash(tokenHash)).toBeNull();
    });

    it('findRefreshTokenByHash returns null for an unknown hash', async () => {
      expect(await repo.findRefreshTokenByHash(randomUUID())).toBeNull();
    });
  });
});
