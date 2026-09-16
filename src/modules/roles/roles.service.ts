import { ConflictError, ForbiddenError, NotFoundError } from "#/lib/errors.js";
import { permissionCache } from "#/lib/permission-cache.js";
import type { PaginatedResult, PaginationParams } from "#/lib/pagination.js";
import * as repo from "./roles.repo.js";
import type { PermissionDto, RoleWithStats } from "./roles.repo.js";
import type { CreateRoleInput, UpdateRoleInput } from "./roles.schema.js";

export interface RolesRepo {
  listRoles: (
    tenantId: string,
    params: PaginationParams,
  ) => Promise<PaginatedResult<RoleWithStats>>;
  listPermissionCatalog: (tenantId: string) => Promise<PermissionDto[]>;
  findRoleById: (
    tenantId: string,
    roleId: string,
  ) => Promise<RoleWithStats | null>;
  createRole: (
    tenantId: string,
    input: CreateRoleInput,
  ) => Promise<RoleWithStats>;
  updateRole: (
    tenantId: string,
    roleId: string,
    input: UpdateRoleInput,
  ) => Promise<RoleWithStats>;
  deleteRole: (tenantId: string, roleId: string) => Promise<void>;
  countUsersForRole: (tenantId: string, roleId: string) => Promise<number>;
}

export class RolesService {
  constructor(private readonly repo: RolesRepo) {}

  async list(
    tenantId: string,
    params: PaginationParams,
  ): Promise<PaginatedResult<RoleWithStats>> {
    return this.repo.listRoles(tenantId, params);
  }

  async listPermissions(tenantId: string): Promise<PermissionDto[]> {
    return this.repo.listPermissionCatalog(tenantId);
  }

  async create(
    tenantId: string,
    input: CreateRoleInput,
  ): Promise<RoleWithStats> {
    return this.repo.createRole(tenantId, input);
  }

  async update(
    tenantId: string,
    roleId: string,
    input: UpdateRoleInput,
  ): Promise<RoleWithStats> {
    const existing = await this.repo.findRoleById(tenantId, roleId);
    if (!existing) {
      throw new NotFoundError("Role not found");
    }

    const updated = await this.repo.updateRole(tenantId, roleId, input);

    // Only a permission-set change can make a cached permission list stale.
    // A rename doesn't, so don't pay for a cache miss on every rename.
    if (input.permissionIds !== undefined) {
      permissionCache.invalidate(tenantId, roleId);
    }

    return updated;
  }

  async remove(tenantId: string, roleId: string): Promise<void> {
    const existing = await this.repo.findRoleById(tenantId, roleId);
    if (!existing) {
      throw new NotFoundError("Role not found");
    }
    if (existing.isSystem) {
      throw new ForbiddenError("System roles cannot be deleted");
    }

    const userCount = await this.repo.countUsersForRole(tenantId, roleId);
    if (userCount > 0) {
      throw new ConflictError(
        `Cannot delete role: ${userCount} user(s) are assigned to it`,
      );
    }

    await this.repo.deleteRole(tenantId, roleId);
    permissionCache.invalidate(tenantId, roleId);
  }
}

export const rolesService = new RolesService(repo);
