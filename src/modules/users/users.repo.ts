import { Prisma } from '@prisma/client';
import { withTenantContext, withTenantContextReadOnly } from '#/db/tenant-context.js';
import { BadRequestError, ConflictError } from '#/lib/errors.js';
import type { PaginatedResult, PaginationParams } from '#/lib/pagination.js';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  email: string;
  name: string;
  roleId: string;
  passwordHash: string;
}

export interface UpdateUserFields {
  email?: string;
  name?: string;
  roleId?: string;
}

const SORT_COLUMN: Record<string, 'name' | 'email' | 'createdAt'> = {
  name: 'name',
  email: 'email',
  createdAt: 'createdAt',
};

const SELECT_PUBLIC = {
  id: true,
  email: true,
  name: true,
  roleId: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { name: true } },
} satisfies Prisma.UserSelect;

function toPublicUser(row: {
  id: string;
  email: string;
  name: string;
  roleId: string;
  createdAt: Date;
  updatedAt: Date;
  role: { name: string };
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    roleId: row.roleId,
    roleName: row.role.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listUsers(
  tenantId: string,
  params: PaginationParams,
): Promise<PaginatedResult<PublicUser>> {
  return withTenantContextReadOnly(tenantId, async (tx) => {
    const where = { tenantId, deletedAt: null };
    const orderBy = { [SORT_COLUMN[params.sort] ?? 'name']: params.order };
    const [total, users] = await Promise.all([
      tx.user.count({ where }),
      tx.user.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: SELECT_PUBLIC,
      }),
    ]);

    return { data: users.map(toPublicUser), page: params.page, pageSize: params.pageSize, total };
  });
}

export async function findUserById(tenantId: string, userId: string): Promise<PublicUser | null> {
  return withTenantContextReadOnly(tenantId, async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: SELECT_PUBLIC,
    });
    return user ? toPublicUser(user) : null;
  });
}

export async function createUser(tenantId: string, data: CreateUserData): Promise<PublicUser> {
  try {
    return await withTenantContext(tenantId, async (tx) => {
      const user = await tx.user.create({
        data: { tenantId, ...data },
        select: SELECT_PUBLIC,
      });
      return toPublicUser(user);
    });
  } catch (err) {
    throw mapWriteError(err);
  }
}

export async function updateUser(
  tenantId: string,
  userId: string,
  fields: UpdateUserFields,
): Promise<PublicUser | null> {
  try {
    return await withTenantContext(tenantId, async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, deletedAt: null },
        data: fields,
      });
      if (count === 0) return null;

      const user = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: SELECT_PUBLIC,
      });
      return user ? toPublicUser(user) : null;
    });
  } catch (err) {
    throw mapWriteError(err);
  }
}

export async function updatePassword(
  tenantId: string,
  userId: string,
  passwordHash: string,
): Promise<boolean> {
  const { count } = await withTenantContext(tenantId, (tx) =>
    tx.user.updateMany({ where: { id: userId, deletedAt: null }, data: { passwordHash } }),
  );
  return count > 0;
}

export async function softDeleteUser(tenantId: string, userId: string): Promise<void> {
  await withTenantContext(tenantId, (tx) =>
    tx.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: { deletedAt: new Date() },
    }),
  );
}

function mapWriteError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return new ConflictError('A user with this email already exists in this tenant');
    }
    if (err.code === 'P2003') {
      return new BadRequestError('roleId does not refer to a role in this tenant');
    }
  }
  return err;
}
