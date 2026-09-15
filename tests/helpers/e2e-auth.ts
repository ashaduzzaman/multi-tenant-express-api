import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { Application } from 'express';
import request from 'supertest';
import { adminPrisma } from '#/db/client.js';
import { env } from '#/config/env.js';

export interface RegisteredOwner {
  cookies: string[];
  tenantSlug: string;
  tenantId: string;
  userId: string;
  email: string;
  password: string;
}

function extractCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.map((c) => c.split(';')[0]!);
}

/** Registers a fresh tenant + Owner via the real /auth/register endpoint. */
export async function registerOwner(
  app: Application,
  authBasePath = '/api/v1/auth',
): Promise<RegisteredOwner> {
  const unique = randomUUID();
  const payload = {
    tenantName: 'Acme',
    tenantSlug: `acme-${unique}`,
    email: `owner-${unique}@acme.test`,
    password: 'correct-horse-battery',
    name: 'Owner',
  };
  const res = await request(app).post(`${authBasePath}/register`).send(payload);
  const tenant = await adminPrisma.tenant.findUniqueOrThrow({ where: { slug: payload.tenantSlug } });

  return {
    cookies: extractCookies(res),
    tenantSlug: payload.tenantSlug,
    tenantId: tenant.id,
    userId: res.body.data.user.id as string,
    email: payload.email,
    password: payload.password,
  };
}

/**
 * Creates a user directly (bypassing the users module — this is test setup,
 * not something to route through the API under test) on one of the tenant's
 * seeded default roles, then logs in as them via the real endpoint.
 */
export async function loginAsSeededRole(
  app: Application,
  tenantSlug: string,
  roleName: 'Owner' | 'Admin' | 'Member',
  authBasePath = '/api/v1/auth',
): Promise<{ cookies: string[]; userId: string; email: string }> {
  const tenant = await adminPrisma.tenant.findUniqueOrThrow({ where: { slug: tenantSlug } });
  const role = await adminPrisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, name: roleName } });
  const email = `${roleName.toLowerCase()}-${randomUUID()}@acme.test`;
  const password = `${roleName.toLowerCase()}-password-123`;

  const user = await adminPrisma.user.create({
    data: {
      tenantId: tenant.id,
      email,
      name: roleName,
      passwordHash: await bcrypt.hash(password, env.BCRYPT_ROUNDS),
      roleId: role.id,
    },
  });

  const res = await request(app).post(`${authBasePath}/login`).send({ tenantSlug, email, password });
  return { cookies: extractCookies(res), userId: user.id, email };
}
