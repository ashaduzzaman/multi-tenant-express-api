import { Prisma } from '@prisma/client';
import { adminPrisma } from '#/db/client.js';
import { withTenantContext, withTenantContextReadOnly } from '#/db/tenant-context.js';
import { DEFAULT_ROLE_PERMISSIONS } from '#/config/permissions.js';
import { ConflictError } from '#/lib/errors.js';

export interface TenantProvisioningInput {
  tenantName: string;
  tenantSlug: string;
  email: string;
  name: string;
}

export interface RegisteredTenant {
  tenantId: string;
  tenantSlug: string;
  ownerUserId: string;
  ownerRoleId: string;
}

export interface UserRecord {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
  roleId: string;
}

export interface RefreshTokenRecord {
  tenantId: string;
  userId: string;
  expiresAt: Date;
}

const DEFAULT_ROLES = ['Owner', 'Admin', 'Member'] as const;

/**
 * Tenant provisioning: creates the tenant, seeds its three default roles
 * with permissions per DEFAULT_ROLE_PERMISSIONS, and creates the owner user
 * — all in one transaction on adminPrisma. This is THE sanctioned use of the
 * admin client outside migrations: app_user has no INSERT grant on `tenants`
 * at all, by design (see the init migration's RLS section).
 */
export async function registerTenantWithOwner(
  input: TenantProvisioningInput,
  passwordHash: string,
): Promise<RegisteredTenant> {
  try {
    return await adminPrisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug: input.tenantSlug, name: input.tenantName },
      });

      const allPermissionNames = [...new Set(Object.values(DEFAULT_ROLE_PERMISSIONS).flat())];
      const permissions = await tx.permission.findMany({
        where: { name: { in: allPermissionNames } },
      });
      const permissionIdByName = new Map(permissions.map((p) => [p.name, p.id]));

      const roleIdByName = new Map<string, string>();
      for (const roleName of DEFAULT_ROLES) {
        const role = await tx.role.create({
          data: { tenantId: tenant.id, name: roleName, isSystem: true },
        });
        roleIdByName.set(roleName, role.id);

        const permissionNames = DEFAULT_ROLE_PERMISSIONS[roleName];
        await tx.rolePermission.createMany({
          data: permissionNames
            .map((name) => permissionIdByName.get(name))
            .filter((id): id is string => id !== undefined)
            .map((permissionId) => ({ tenantId: tenant.id, roleId: role.id, permissionId })),
        });
      }

      const ownerRoleId = roleIdByName.get('Owner')!;
      const ownerUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.email,
          name: input.name,
          passwordHash,
          roleId: ownerRoleId,
        },
      });

      return {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        ownerUserId: ownerUser.id,
        ownerRoleId,
      };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('Tenant slug is already taken', { tenantSlug: input.tenantSlug });
    }
    throw err;
  }
}

/**
 * Narrow, justified admin-bypass lookup: at login time we don't have a
 * tenant context yet, and tenant existence-by-slug isn't sensitive tenant
 * data (it's the equivalent of a workspace picker). Returns only what's
 * needed to move to a tenant-scoped query next.
 */
export async function findTenantBySlug(slug: string): Promise<{ id: string } | null> {
  const tenant = await adminPrisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  return tenant;
}

export async function findUserByEmail(tenantId: string, email: string): Promise<UserRecord | null> {
  return withTenantContextReadOnly(tenantId, (tx) =>
    tx.user.findUnique({ where: { tenantId_email: { tenantId, email } } }),
  );
}

export async function findUserById(tenantId: string, userId: string): Promise<UserRecord | null> {
  return withTenantContextReadOnly(tenantId, (tx) => tx.user.findUnique({ where: { id: userId } }));
}

export async function createRefreshToken(
  tenantId: string,
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await withTenantContext(tenantId, (tx) =>
    tx.refreshToken.create({ data: { tenantId, userId, tokenHash, expiresAt } }),
  );
}

/**
 * Global lookup by opaque hash — see PLAN.md's auth module design note for
 * why this is the one other justified admin-bypass read: the refresh cookie
 * doesn't carry a tenant context, and the hash (32 random bytes) is the only
 * thing we have to resolve one. Every subsequent operation switches to
 * withTenantContext once tenantId is known.
 */
export async function findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
  const record = await adminPrisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { tenantId: true, userId: true, expiresAt: true },
  });
  return record;
}

export async function deleteRefreshTokenByHash(tenantId: string, tokenHash: string): Promise<void> {
  await withTenantContext(tenantId, async (tx) => {
    await tx.refreshToken.deleteMany({ where: { tokenHash } });
  });
}
