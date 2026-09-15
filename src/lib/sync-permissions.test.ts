import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { adminPrisma, disconnectAll } from '#/db/client.js';
import { PERMISSION_REGISTRY } from '#/config/permissions.js';
import { syncPermissions } from './sync-permissions.js';

describe('syncPermissions', () => {
  afterAll(async () => {
    await disconnectAll();
  });

  it('upserts every entry in the registry', async () => {
    await syncPermissions(adminPrisma);

    for (const def of PERMISSION_REGISTRY) {
      const row = await adminPrisma.permission.findUnique({ where: { name: def.name } });
      expect(row).not.toBeNull();
      expect(row?.resource).toBe(def.resource);
      expect(row?.action).toBe(def.action);
    }
  });

  it('is idempotent — running twice does not duplicate or error', async () => {
    await syncPermissions(adminPrisma);
    await syncPermissions(adminPrisma);

    const count = await adminPrisma.permission.count({
      where: { name: { in: PERMISSION_REGISTRY.map((p) => p.name) } },
    });
    expect(count).toBe(PERMISSION_REGISTRY.length);
  });

  it('updates description/resource/action in place when the registry entry changes', async () => {
    const marker = `test:marker-${randomUUID()}`;
    await adminPrisma.permission.create({
      data: {
        name: marker,
        resource: 'test',
        action: 'marker',
        description: 'old description',
      },
    });

    await syncPermissions(adminPrisma, [
      { name: marker, resource: 'test', action: 'marker', description: 'new description' },
    ]);

    const row = await adminPrisma.permission.findUniqueOrThrow({ where: { name: marker } });
    expect(row.description).toBe('new description');

    await adminPrisma.permission.delete({ where: { name: marker } });
  });
});
