import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '#/lib/errors.js';
import { permissionCache } from '#/lib/permission-cache.js';
import { RolesService, type RolesRepo } from './roles.service.js';
import type { RoleWithStats } from './roles.repo.js';

function makeRole(overrides: Partial<RoleWithStats> = {}): RoleWithStats {
  return {
    id: randomUUID(),
    name: 'Role',
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    permissionIds: [],
    userCount: 0,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<RolesRepo> = {}): RolesRepo {
  return {
    listRoles: vi.fn(),
    listPermissionCatalog: vi.fn(),
    findRoleById: vi.fn().mockResolvedValue(null),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn().mockResolvedValue(undefined),
    countUsersForRole: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe('RolesService.update', () => {
  it('throws NotFoundError when the role does not exist', async () => {
    const service = new RolesService(makeRepo());
    await expect(service.update(randomUUID(), randomUUID(), { name: 'X' })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('invalidates the permission cache when permissionIds change', async () => {
    const tenantId = randomUUID();
    const role = makeRole();
    const repo = makeRepo({
      findRoleById: vi.fn().mockResolvedValue(role),
      updateRole: vi.fn().mockResolvedValue({ ...role, permissionIds: ['p1'] }),
    });
    const service = new RolesService(repo);

    // Warm the cache so we can prove invalidation actually happened.
    await permissionCache.getPermissions(tenantId, role.id, () => Promise.resolve(['stale']));

    await service.update(tenantId, role.id, { permissionIds: ['p1'] });

    const fetcher = vi.fn().mockResolvedValue(['fresh']);
    const result = await permissionCache.getPermissions(tenantId, role.id, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toEqual(['fresh']);
  });

  it('does NOT invalidate the permission cache for a name-only rename', async () => {
    const tenantId = randomUUID();
    const role = makeRole();
    const repo = makeRepo({
      findRoleById: vi.fn().mockResolvedValue(role),
      updateRole: vi.fn().mockResolvedValue({ ...role, name: 'Renamed' }),
    });
    const service = new RolesService(repo);

    await permissionCache.getPermissions(tenantId, role.id, () => Promise.resolve(['cached']));
    await service.update(tenantId, role.id, { name: 'Renamed' });

    const fetcher = vi.fn().mockResolvedValue(['should-not-be-called']);
    const result = await permissionCache.getPermissions(tenantId, role.id, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toEqual(['cached']);
  });
});

describe('RolesService.remove', () => {
  beforeEach(() => {
    permissionCache.clear();
  });

  it('throws NotFoundError when the role does not exist', async () => {
    const service = new RolesService(makeRepo());
    await expect(service.remove(randomUUID(), randomUUID())).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError for a system role', async () => {
    const role = makeRole({ isSystem: true });
    const repo = makeRepo({ findRoleById: vi.fn().mockResolvedValue(role) });
    const service = new RolesService(repo);

    await expect(service.remove(randomUUID(), role.id)).rejects.toThrow(ForbiddenError);
  });

  it('throws ConflictError when users are assigned to the role', async () => {
    const role = makeRole();
    const repo = makeRepo({
      findRoleById: vi.fn().mockResolvedValue(role),
      countUsersForRole: vi.fn().mockResolvedValue(3),
    });
    const service = new RolesService(repo);

    await expect(service.remove(randomUUID(), role.id)).rejects.toThrow(ConflictError);
    expect(repo.deleteRole).not.toHaveBeenCalled();
  });

  it('deletes a non-system role with no users assigned', async () => {
    const role = makeRole();
    const repo = makeRepo({ findRoleById: vi.fn().mockResolvedValue(role) });
    const service = new RolesService(repo);

    await service.remove('tenant-1', role.id);
    expect(repo.deleteRole).toHaveBeenCalledWith('tenant-1', role.id);
  });
});
