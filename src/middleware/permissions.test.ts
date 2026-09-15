import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { adminPrisma, disconnectAll } from '#/db/client.js';
import { ForbiddenError, UnauthorizedError } from '#/lib/errors.js';
import { permissionCache } from '#/lib/permission-cache.js';
import {
  loadPermissions,
  requireAnyPermission,
  requirePermission,
  requireSelfOrPermission,
} from './permissions.js';

function fakeReqWithAuth(auth: Partial<Express.Request['auth']>): Request {
  return { auth } as unknown as Request;
}

describe('requirePermission', () => {
  it('calls next() when the permission is present', () => {
    const req = fakeReqWithAuth({ permissions: ['users:read'] });
    const next = vi.fn() as NextFunction;

    requirePermission('users:read')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(ForbiddenError) when the permission is missing', () => {
    const req = fakeReqWithAuth({ permissions: ['users:read'] });
    const next = vi.fn() as NextFunction;

    requirePermission('users:delete')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it('calls next(ForbiddenError) when req.auth has no permissions at all', () => {
    const req = { auth: undefined } as unknown as Request;
    const next = vi.fn() as NextFunction;

    requirePermission('users:read')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });
});

describe('requireAnyPermission', () => {
  it('calls next() when at least one permission matches', () => {
    const req = fakeReqWithAuth({ permissions: ['users:read'] });
    const next = vi.fn() as NextFunction;

    requireAnyPermission('users:delete', 'users:read')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(ForbiddenError) when none match', () => {
    const req = fakeReqWithAuth({ permissions: ['users:read'] });
    const next = vi.fn() as NextFunction;

    requireAnyPermission('users:delete', 'roles:delete')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });
});

describe('requireSelfOrPermission', () => {
  it('calls next() when the caller acts on their own id, even without the permission', () => {
    const userId = randomUUID();
    const req = {
      auth: { userId, permissions: [] },
      params: { id: userId },
    } as unknown as Request;
    const next = vi.fn() as NextFunction;

    requireSelfOrPermission('id', 'users:update')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() when the caller acts on someone else but holds the permission', () => {
    const req = {
      auth: { userId: randomUUID(), permissions: ['users:update'] },
      params: { id: randomUUID() },
    } as unknown as Request;
    const next = vi.fn() as NextFunction;

    requireSelfOrPermission('id', 'users:update')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(ForbiddenError) for a different user without the permission', () => {
    const req = {
      auth: { userId: randomUUID(), permissions: [] },
      params: { id: randomUUID() },
    } as unknown as Request;
    const next = vi.fn() as NextFunction;

    requireSelfOrPermission('id', 'users:update')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });
});

describe('loadPermissions (integration)', () => {
  afterAll(async () => {
    await disconnectAll();
  });

  it('loads permissions for the role via the RBAC tables and populates req.auth.permissions', async () => {
    const tenant = await adminPrisma.tenant.create({
      data: { slug: `perm-${randomUUID()}`, name: 'Perm Tenant' },
    });
    const permission = await adminPrisma.permission.upsert({
      where: { name: 'users:read' },
      create: { name: 'users:read', resource: 'users', action: 'read', description: 'x' },
      update: {},
    });
    const role = await adminPrisma.role.create({
      data: { tenantId: tenant.id, name: 'Tester' },
    });
    await adminPrisma.rolePermission.create({
      data: { tenantId: tenant.id, roleId: role.id, permissionId: permission.id },
    });

    const req = {
      auth: { userId: randomUUID(), tenantId: tenant.id, roleId: role.id, email: 'x@test.dev' },
    } as unknown as Request;
    const next = vi.fn() as NextFunction;

    await loadPermissions(req, {} as Response, next);

    expect(req.auth?.permissions).toEqual(['users:read']);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(UnauthorizedError) when req.auth is missing', async () => {
    permissionCache.clear();
    const req = { auth: undefined } as unknown as Request;
    const next = vi.fn() as NextFunction;

    await loadPermissions(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });
});
