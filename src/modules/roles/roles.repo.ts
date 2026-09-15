import { Prisma } from '@prisma/client';
import { withTenantContext, withTenantContextReadOnly } from '#/db/tenant-context.js';
import { ConflictError } from '#/lib/errors.js';
import type { PaginatedResult, PaginationParams } from '#/lib/pagination.js';
import type { CreateRoleInput, UpdateRoleInput } from './roles.schema.js';

export interface RoleWithStats {
  id: string;
  name: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissionIds: string[];
  userCount: number;
}

export interface PermissionDto {
  id: string;
  name: string;
  resource: string;
  action: string;
  description: string;
}

const SORT_COLUMN: Record<string, 'name' | 'createdAt'> = { name: 'name', createdAt: 'createdAt' };

export async function listRoles(
  tenantId: string,
  params: PaginationParams,
): Promise<PaginatedResult<RoleWithStats>> {
  return withTenantContextReadOnly(tenantId, async (tx) => {
    const orderBy = { [SORT_COLUMN[params.sort] ?? 'name']: params.order };
    const [total, roles] = await Promise.all([
      tx.role.count({ where: { tenantId } }),
      tx.role.findMany({
        where: { tenantId },
        orderBy,
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: { rolePermissions: true, _count: { select: { users: true } } },
      }),
    ]);

    return {
      data: roles.map(toRoleWithStats),
      page: params.page,
      pageSize: params.pageSize,
      total,
    };
  });
}

export async function listPermissionCatalog(tenantId: string): Promise<PermissionDto[]> {
  return withTenantContextReadOnly(tenantId, (tx) =>
    tx.permission.findMany({ orderBy: { name: 'asc' } }),
  );
}

export async function findRoleById(tenantId: string, roleId: string): Promise<RoleWithStats | null> {
  return withTenantContextReadOnly(tenantId, async (tx) => {
    const role = await tx.role.findUnique({
      where: { id: roleId },
      include: { rolePermissions: true, _count: { select: { users: true } } },
    });
    return role ? toRoleWithStats(role) : null;
  });
}

export async function createRole(
  tenantId: string,
  input: CreateRoleInput,
): Promise<RoleWithStats> {
  try {
    return await withTenantContext(tenantId, async (tx) => {
      const role = await tx.role.create({ data: { tenantId, name: input.name } });

      if (input.permissionIds && input.permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: input.permissionIds.map((permissionId) => ({
            tenantId,
            roleId: role.id,
            permissionId,
          })),
        });
      }

      return {
        id: role.id,
        name: role.name,
        isSystem: role.isSystem,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
        permissionIds: input.permissionIds ?? [],
        userCount: 0,
      };
    });
  } catch (err) {
    throw mapWriteError(err, input.name);
  }
}

export async function updateRole(
  tenantId: string,
  roleId: string,
  input: UpdateRoleInput,
): Promise<RoleWithStats> {
  try {
    return await withTenantContext(tenantId, async (tx) => {
      if (input.name !== undefined) {
        await tx.role.update({ where: { id: roleId }, data: { name: input.name } });
      }

      if (input.permissionIds !== undefined) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (input.permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: input.permissionIds.map((permissionId) => ({
              tenantId,
              roleId,
              permissionId,
            })),
          });
        }
      }

      const role = await tx.role.findUniqueOrThrow({
        where: { id: roleId },
        include: { rolePermissions: true, _count: { select: { users: true } } },
      });
      return toRoleWithStats(role);
    });
  } catch (err) {
    throw mapWriteError(err, input.name);
  }
}

export async function deleteRole(tenantId: string, roleId: string): Promise<void> {
  await withTenantContext(tenantId, async (tx) => {
    await tx.role.delete({ where: { id: roleId } });
  });
}

export async function countUsersForRole(tenantId: string, roleId: string): Promise<number> {
  return withTenantContextReadOnly(tenantId, (tx) => tx.user.count({ where: { roleId } }));
}

function toRoleWithStats(role: {
  id: string;
  name: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  rolePermissions: { permissionId: string }[];
  _count: { users: number };
}): RoleWithStats {
  return {
    id: role.id,
    name: role.name,
    isSystem: role.isSystem,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    permissionIds: role.rolePermissions.map((rp) => rp.permissionId),
    userCount: role._count.users,
  };
}

function mapWriteError(err: unknown, name: string | undefined): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return new ConflictError('A role with this name already exists', { name });
  }
  return err;
}
