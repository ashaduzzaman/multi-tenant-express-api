import cookieParser from 'cookie-parser';
import express, { type Application } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminPrisma, disconnectAll } from '#/db/client.js';
import { errorHandler, notFoundHandler } from '#/middleware/error-handler.js';
import { syncPermissions } from '#/lib/sync-permissions.js';
import { authRouter } from '#/modules/auth/auth.router.js';
import { registerOwner, loginAsSeededRole } from '../../../tests/helpers/e2e-auth.js';
import { rolesRouter } from './roles.router.js';

function buildTestApp(): Application {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/roles', rolesRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('roles router (e2e)', () => {
  const app = buildTestApp();

  beforeAll(async () => {
    await syncPermissions(adminPrisma);
  });

  afterAll(async () => {
    await disconnectAll();
  });

  it('lists the three default roles for a freshly registered tenant', async () => {
    const { cookies } = await registerOwner(app);

    const res = await request(app).get('/api/v1/roles').set('Cookie', cookies.join('; '));

    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { name: string }) => r.name).sort()).toEqual([
      'Admin',
      'Member',
      'Owner',
    ]);
  });

  it('lists the permission catalog', async () => {
    const { cookies } = await registerOwner(app);
    const res = await request(app)
      .get('/api/v1/roles/permissions')
      .set('Cookie', cookies.join('; '));

    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { name: string }) => p.name)).toContain('users:read');
  });

  it('creates, updates, and deletes a custom role as Owner', async () => {
    const { cookies } = await registerOwner(app);

    const createRes = await request(app)
      .post('/api/v1/roles')
      .set('Cookie', cookies.join('; '))
      .send({ name: 'Support' });
    expect(createRes.status).toBe(201);
    const roleId = createRes.body.data.id;

    const updateRes = await request(app)
      .put(`/api/v1/roles/${roleId}`)
      .set('Cookie', cookies.join('; '))
      .send({ name: 'Support Renamed' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.name).toBe('Support Renamed');

    const deleteRes = await request(app)
      .delete(`/api/v1/roles/${roleId}`)
      .set('Cookie', cookies.join('; '));
    expect(deleteRes.status).toBe(204);
  });

  it('refuses to delete a system role (403)', async () => {
    const { cookies } = await registerOwner(app);
    const listRes = await request(app).get('/api/v1/roles').set('Cookie', cookies.join('; '));
    const ownerRole = listRes.body.data.find((r: { name: string }) => r.name === 'Owner');

    const res = await request(app)
      .delete(`/api/v1/roles/${ownerRole.id}`)
      .set('Cookie', cookies.join('; '));
    expect(res.status).toBe(403);
  });

  it('rejects role creation from a Member (403 — lacks roles:create)', async () => {
    const { tenantSlug } = await registerOwner(app);
    const member = await loginAsSeededRole(app, tenantSlug, 'Member');

    const res = await request(app)
      .post('/api/v1/roles')
      .set('Cookie', member.cookies.join('; '))
      .send({ name: 'Should Fail' });

    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated access (401)', async () => {
    const res = await request(app).get('/api/v1/roles');
    expect(res.status).toBe(401);
  });
});
