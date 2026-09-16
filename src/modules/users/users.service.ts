import bcrypt from "bcrypt";
import { env } from "#/config/env.js";
import { BadRequestError, NotFoundError } from "#/lib/errors.js";
import type { PaginatedResult, PaginationParams } from "#/lib/pagination.js";
import * as repo from "./users.repo.js";
import type {
  CreateUserData,
  PublicUser,
  UpdateUserFields,
} from "./users.repo.js";
import type { CreateUserInput, UpdateUserInput } from "./users.schema.js";

export interface UsersRepo {
  listUsers: (
    tenantId: string,
    params: PaginationParams,
  ) => Promise<PaginatedResult<PublicUser>>;
  findUserById: (
    tenantId: string,
    userId: string,
  ) => Promise<PublicUser | null>;
  createUser: (tenantId: string, data: CreateUserData) => Promise<PublicUser>;
  updateUser: (
    tenantId: string,
    userId: string,
    fields: UpdateUserFields,
  ) => Promise<PublicUser | null>;
  updatePassword: (
    tenantId: string,
    userId: string,
    passwordHash: string,
  ) => Promise<boolean>;
  softDeleteUser: (tenantId: string, userId: string) => Promise<void>;
}

export class UsersService {
  constructor(private readonly repo: UsersRepo) {}

  async list(
    tenantId: string,
    params: PaginationParams,
  ): Promise<PaginatedResult<PublicUser>> {
    return this.repo.listUsers(tenantId, params);
  }

  async get(tenantId: string, userId: string): Promise<PublicUser> {
    const user = await this.repo.findUserById(tenantId, userId);
    if (!user) throw new NotFoundError("User not found");
    return user;
  }

  async create(tenantId: string, input: CreateUserInput): Promise<PublicUser> {
    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
    return this.repo.createUser(tenantId, {
      email: input.email,
      name: input.name,
      roleId: input.roleId,
      passwordHash,
    });
  }

  async update(
    tenantId: string,
    userId: string,
    input: UpdateUserInput,
  ): Promise<PublicUser> {
    const updated = await this.repo.updateUser(tenantId, userId, input);
    if (!updated) throw new NotFoundError("User not found");
    return updated;
  }

  async changePassword(
    tenantId: string,
    userId: string,
    newPassword: string,
  ): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
    const updated = await this.repo.updatePassword(
      tenantId,
      userId,
      passwordHash,
    );
    if (!updated) throw new NotFoundError("User not found");
  }

  async remove(
    tenantId: string,
    actingUserId: string,
    targetUserId: string,
  ): Promise<void> {
    if (actingUserId === targetUserId) {
      throw new BadRequestError("You cannot delete your own account");
    }

    const target = await this.repo.findUserById(tenantId, targetUserId);
    if (!target) throw new NotFoundError("User not found");

    await this.repo.softDeleteUser(tenantId, targetUserId);
  }
}

export const usersService = new UsersService(repo);
