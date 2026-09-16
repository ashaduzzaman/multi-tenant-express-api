import bcrypt from "bcrypt";
import { env } from "#/config/env.js";
import { NotFoundError, UnauthorizedError } from "#/lib/errors.js";
import { signAccessToken } from "#/lib/jwt.js";
import { generateRefreshToken, hashRefreshToken } from "#/lib/refresh-token.js";
import * as repo from "./auth.repo.js";
import type {
  RegisteredTenant,
  TenantProvisioningInput,
  UserRecord,
} from "./auth.repo.js";
import type { LoginInput, RegisterInput } from "./auth.schema.js";

export interface AuthRepo {
  registerTenantWithOwner: (
    input: TenantProvisioningInput,
    passwordHash: string,
  ) => Promise<RegisteredTenant>;
  findTenantBySlug: (slug: string) => Promise<{ id: string } | null>;
  findUserByEmail: (
    tenantId: string,
    email: string,
  ) => Promise<UserRecord | null>;
  findUserById: (
    tenantId: string,
    userId: string,
  ) => Promise<UserRecord | null>;
  createRefreshToken: (
    tenantId: string,
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ) => Promise<void>;
  findRefreshTokenByHash: (
    tokenHash: string,
  ) => Promise<{ tenantId: string; userId: string; expiresAt: Date } | null>;
  deleteRefreshTokenByHash: (
    tenantId: string,
    tokenHash: string,
  ) => Promise<void>;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

// Syntactically valid bcrypt hash of an unguessable string. bcrypt.compare
// against this runs the same cost-factor work as a real comparison, so
// login takes the same time whether the tenant, the user, or the password
// is what's wrong — never a signal an attacker can use to enumerate either.
const DUMMY_HASH = await bcrypt.hash(
  "dummy-password-for-timing-safety",
  env.BCRYPT_ROUNDS,
);

export class AuthService {
  constructor(private readonly repo: AuthRepo) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
    const { tenantId, ownerUserId, ownerRoleId } =
      await this.repo.registerTenantWithOwner(input, passwordHash);

    const user: UserRecord = {
      id: ownerUserId,
      tenantId,
      email: input.email,
      name: input.name,
      passwordHash,
      roleId: ownerRoleId,
    };
    return this.issueTokens(tenantId, user);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const tenant = await this.repo.findTenantBySlug(input.tenantSlug);
    const user = tenant
      ? await this.repo.findUserByEmail(tenant.id, input.email)
      : null;

    const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
    const passwordMatches = await bcrypt.compare(input.password, hashToCompare);

    if (!tenant || !user || !passwordMatches) {
      throw new UnauthorizedError("Invalid credentials");
    }

    return this.issueTokens(tenant.id, user);
  }

  async refresh(refreshTokenRaw: string): Promise<AuthResult> {
    const tokenHash = hashRefreshToken(refreshTokenRaw);
    const record = await this.repo.findRefreshTokenByHash(tokenHash);

    if (!record || record.expiresAt <= new Date()) {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    // Rotation: the old token is invalidated the moment it's used, whether
    // or not the rest of this call succeeds.
    await this.repo.deleteRefreshTokenByHash(record.tenantId, tokenHash);

    const user = await this.repo.findUserById(record.tenantId, record.userId);
    if (!user) {
      throw new UnauthorizedError("User not found");
    }

    return this.issueTokens(record.tenantId, user);
  }

  async logout(refreshTokenRaw: string | undefined): Promise<void> {
    if (!refreshTokenRaw) return;

    const tokenHash = hashRefreshToken(refreshTokenRaw);
    const record = await this.repo.findRefreshTokenByHash(tokenHash);
    if (!record) return;

    await this.repo.deleteRefreshTokenByHash(record.tenantId, tokenHash);
  }

  async me(tenantId: string, userId: string): Promise<PublicUser> {
    const user = await this.repo.findUserById(tenantId, userId);
    if (!user) throw new NotFoundError("User not found");
    return toPublicUser(user);
  }

  private async issueTokens(
    tenantId: string,
    user: UserRecord,
  ): Promise<AuthResult> {
    const accessToken = await signAccessToken({
      sub: user.id,
      tid: tenantId,
      email: user.email,
      rid: user.roleId,
    });

    const refreshToken = generateRefreshToken();
    const refreshTokenExpiresAt = new Date(
      Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.repo.createRefreshToken(
      tenantId,
      user.id,
      hashRefreshToken(refreshToken),
      refreshTokenExpiresAt,
    );

    return {
      user: toPublicUser(user),
      accessToken,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }
}

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roleId: user.roleId,
  };
}

export const authService = new AuthService(repo);
