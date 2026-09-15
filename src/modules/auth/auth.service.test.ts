import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, UnauthorizedError } from "#/lib/errors.js";
import { env } from "#/config/env.js";
import { hashRefreshToken } from "#/lib/refresh-token.js";
import { AuthService, type AuthRepo } from "./auth.service.js";
import type { UserRecord } from "./auth.repo.js";

function makeRepo(overrides: Partial<AuthRepo> = {}): AuthRepo {
  return {
    registerTenantWithOwner: vi.fn(),
    findTenantBySlug: vi.fn().mockResolvedValue(null),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    findUserById: vi.fn().mockResolvedValue(null),
    createRefreshToken: vi.fn().mockResolvedValue(undefined),
    findRefreshTokenByHash: vi.fn().mockResolvedValue(null),
    deleteRefreshTokenByHash: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function makeUser(
  overrides: Partial<UserRecord> = {},
): Promise<UserRecord> {
  return {
    id: randomUUID(),
    tenantId: randomUUID(),
    email: "user@test.dev",
    name: "Test User",
    passwordHash: await bcrypt.hash("correct-password", env.BCRYPT_ROUNDS),
    roleId: randomUUID(),
    ...overrides,
  };
}

describe("AuthService.register", () => {
  it("hashes the password before persisting and never returns it", async () => {
    const tenantId = randomUUID();
    const ownerUserId = randomUUID();
    const ownerRoleId = randomUUID();
    const repo = makeRepo({
      registerTenantWithOwner: vi.fn().mockResolvedValue({
        tenantId,
        tenantSlug: "acme",
        ownerUserId,
        ownerRoleId,
      }),
    });
    const service = new AuthService(repo);

    const result = await service.register({
      tenantName: "Acme",
      tenantSlug: "acme",
      email: "owner@acme.test",
      password: "super-secret-password",
      name: "Owner",
    });

    const [, passwordHashArg] = vi.mocked(repo.registerTenantWithOwner).mock
      .calls[0]!;
    expect(passwordHashArg).not.toBe("super-secret-password");
    expect(await bcrypt.compare("super-secret-password", passwordHashArg)).toBe(
      true,
    );

    expect(result.user).not.toHaveProperty("passwordHash");
    expect(result.user.id).toBe(ownerUserId);
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(repo.createRefreshToken).toHaveBeenCalledWith(
      tenantId,
      ownerUserId,
      expect.any(String),
      expect.any(Date),
    );
  });
});

describe("AuthService.login", () => {
  let repo: AuthRepo;
  let service: AuthService;

  beforeEach(() => {
    repo = makeRepo();
    service = new AuthService(repo);
  });

  it("throws the same UnauthorizedError when the tenant does not exist", async () => {
    await expect(
      service.login({
        tenantSlug: "missing",
        email: "x@test.dev",
        password: "anything",
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("throws the same UnauthorizedError when the user does not exist", async () => {
    repo = makeRepo({
      findTenantBySlug: vi.fn().mockResolvedValue({ id: randomUUID() }),
    });
    service = new AuthService(repo);

    await expect(
      service.login({
        tenantSlug: "acme",
        email: "missing@test.dev",
        password: "anything",
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("throws the same UnauthorizedError when the password is wrong", async () => {
    const user = await makeUser();
    repo = makeRepo({
      findTenantBySlug: vi.fn().mockResolvedValue({ id: user.tenantId }),
      findUserByEmail: vi.fn().mockResolvedValue(user),
    });
    service = new AuthService(repo);

    await expect(
      service.login({
        tenantSlug: "acme",
        email: user.email,
        password: "wrong-password",
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("succeeds and issues tokens for correct tenant + email + password", async () => {
    const user = await makeUser();
    repo = makeRepo({
      findTenantBySlug: vi.fn().mockResolvedValue({ id: user.tenantId }),
      findUserByEmail: vi.fn().mockResolvedValue(user),
    });
    service = new AuthService(repo);

    const result = await service.login({
      tenantSlug: "acme",
      email: user.email,
      password: "correct-password",
    });

    expect(result.user.id).toBe(user.id);
    expect(repo.createRefreshToken).toHaveBeenCalledWith(
      user.tenantId,
      user.id,
      expect.any(String),
      expect.any(Date),
    );
  });
});

describe("AuthService.refresh", () => {
  it("throws UnauthorizedError for an unknown token", async () => {
    const repo = makeRepo();
    const service = new AuthService(repo);

    await expect(service.refresh("unknown-token")).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("throws UnauthorizedError for an expired token and does not rotate it", async () => {
    const repo = makeRepo({
      findRefreshTokenByHash: vi.fn().mockResolvedValue({
        tenantId: randomUUID(),
        userId: randomUUID(),
        expiresAt: new Date(Date.now() - 1000),
      }),
    });
    const service = new AuthService(repo);

    await expect(service.refresh("expired-token")).rejects.toThrow(
      UnauthorizedError,
    );
    expect(repo.deleteRefreshTokenByHash).not.toHaveBeenCalled();
  });

  it("rotates the token and issues new ones on success", async () => {
    const user = await makeUser();
    const rawToken = "a-raw-refresh-token";
    const repo = makeRepo({
      findRefreshTokenByHash: vi.fn().mockResolvedValue({
        tenantId: user.tenantId,
        userId: user.id,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      }),
      findUserById: vi.fn().mockResolvedValue(user),
    });
    const service = new AuthService(repo);

    const result = await service.refresh(rawToken);

    expect(repo.deleteRefreshTokenByHash).toHaveBeenCalledWith(
      user.tenantId,
      hashRefreshToken(rawToken),
    );
    expect(repo.createRefreshToken).toHaveBeenCalledWith(
      user.tenantId,
      user.id,
      expect.any(String),
      expect.any(Date),
    );
    expect(result.user.id).toBe(user.id);
  });

  it("throws UnauthorizedError when the user behind a valid token no longer exists", async () => {
    const repo = makeRepo({
      findRefreshTokenByHash: vi.fn().mockResolvedValue({
        tenantId: randomUUID(),
        userId: randomUUID(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      }),
      findUserById: vi.fn().mockResolvedValue(null),
    });
    const service = new AuthService(repo);

    await expect(service.refresh("some-token")).rejects.toThrow(
      UnauthorizedError,
    );
  });
});

describe("AuthService.logout", () => {
  it("is a no-op when no token is given", async () => {
    const repo = makeRepo();
    const service = new AuthService(repo);

    await expect(service.logout(undefined)).resolves.toBeUndefined();
    expect(repo.deleteRefreshTokenByHash).not.toHaveBeenCalled();
  });

  it("is a no-op when the token is unknown", async () => {
    const repo = makeRepo();
    const service = new AuthService(repo);

    await service.logout("unknown-token");
    expect(repo.deleteRefreshTokenByHash).not.toHaveBeenCalled();
  });

  it("deletes the resolved refresh token", async () => {
    const tenantId = randomUUID();
    const repo = makeRepo({
      findRefreshTokenByHash: vi.fn().mockResolvedValue({
        tenantId,
        userId: randomUUID(),
        expiresAt: new Date(),
      }),
    });
    const service = new AuthService(repo);

    await service.logout("a-token");

    expect(repo.deleteRefreshTokenByHash).toHaveBeenCalledWith(
      tenantId,
      hashRefreshToken("a-token"),
    );
  });
});

describe("AuthService.me", () => {
  it("returns the public user shape without passwordHash", async () => {
    const user = await makeUser();
    const repo = makeRepo({ findUserById: vi.fn().mockResolvedValue(user) });
    const service = new AuthService(repo);

    const result = await service.me(user.tenantId, user.id);

    expect(result).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
    });
  });

  it("throws NotFoundError when the user does not exist", async () => {
    const repo = makeRepo();
    const service = new AuthService(repo);

    await expect(service.me(randomUUID(), randomUUID())).rejects.toThrow(
      NotFoundError,
    );
  });
});
