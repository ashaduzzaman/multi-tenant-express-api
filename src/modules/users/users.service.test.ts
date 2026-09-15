import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { describe, expect, it, vi } from "vitest";
import { BadRequestError, NotFoundError } from "#/lib/errors.js";
import { UsersService, type UsersRepo } from "./users.service.js";
import type { PublicUser } from "./users.repo.js";

function makeUser(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: randomUUID(),
    email: "a@b.test",
    name: "A",
    roleId: randomUUID(),
    roleName: "Member",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<UsersRepo> = {}): UsersRepo {
  return {
    listUsers: vi.fn(),
    findUserById: vi.fn().mockResolvedValue(null),
    createUser: vi.fn(),
    updateUser: vi.fn().mockResolvedValue(null),
    updatePassword: vi.fn().mockResolvedValue(false),
    softDeleteUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("UsersService.create", () => {
  it("hashes the password before persisting", async () => {
    const roleId = randomUUID();
    const repo = makeRepo({
      createUser: vi.fn().mockResolvedValue(makeUser({ roleId })),
    });
    const service = new UsersService(repo);

    await service.create("tenant-1", {
      email: "a@b.test",
      name: "A",
      roleId,
      password: "plaintext123",
    });

    const [, dataArg] = vi.mocked(repo.createUser).mock.calls[0]!;
    expect(dataArg.passwordHash).not.toBe("plaintext123");
    expect(await bcrypt.compare("plaintext123", dataArg.passwordHash)).toBe(
      true,
    );
  });
});

describe("UsersService.get", () => {
  it("throws NotFoundError when the user does not exist", async () => {
    const service = new UsersService(makeRepo());
    await expect(service.get("tenant-1", randomUUID())).rejects.toThrow(
      NotFoundError,
    );
  });

  it("returns the user when found", async () => {
    const user = makeUser();
    const service = new UsersService(
      makeRepo({ findUserById: vi.fn().mockResolvedValue(user) }),
    );
    await expect(service.get("tenant-1", user.id)).resolves.toEqual(user);
  });
});

describe("UsersService.update", () => {
  it("throws NotFoundError when the repo reports no row updated", async () => {
    const service = new UsersService(makeRepo());
    await expect(
      service.update("tenant-1", randomUUID(), { name: "X" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("returns the updated user on success", async () => {
    const user = makeUser({ name: "Updated" });
    const repo = makeRepo({ updateUser: vi.fn().mockResolvedValue(user) });
    const service = new UsersService(repo);

    await expect(
      service.update("tenant-1", user.id, { name: "Updated" }),
    ).resolves.toEqual(user);
  });
});

describe("UsersService.changePassword", () => {
  it("hashes the new password", async () => {
    const repo = makeRepo({ updatePassword: vi.fn().mockResolvedValue(true) });
    const service = new UsersService(repo);

    await service.changePassword("tenant-1", "user-1", "new-plaintext-pass");

    const [, , hashArg] = vi.mocked(repo.updatePassword).mock.calls[0]!;
    expect(await bcrypt.compare("new-plaintext-pass", hashArg)).toBe(true);
  });

  it("throws NotFoundError when the repo reports no row updated", async () => {
    const service = new UsersService(makeRepo());
    await expect(
      service.changePassword("tenant-1", "user-1", "x".repeat(10)),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("UsersService.remove", () => {
  it("throws BadRequestError when a user tries to delete themself", async () => {
    const service = new UsersService(makeRepo());
    const userId = randomUUID();
    await expect(service.remove("tenant-1", userId, userId)).rejects.toThrow(
      BadRequestError,
    );
  });

  it("throws NotFoundError when the target user does not exist", async () => {
    const service = new UsersService(makeRepo());
    await expect(
      service.remove("tenant-1", randomUUID(), randomUUID()),
    ).rejects.toThrow(NotFoundError);
  });

  it("soft-deletes an existing, different user", async () => {
    const target = makeUser();
    const repo = makeRepo({ findUserById: vi.fn().mockResolvedValue(target) });
    const service = new UsersService(repo);

    await service.remove("tenant-1", randomUUID(), target.id);

    expect(repo.softDeleteUser).toHaveBeenCalledWith("tenant-1", target.id);
  });
});
