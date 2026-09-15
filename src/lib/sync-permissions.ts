import type { PrismaClient } from '@prisma/client';
import { PERMISSION_REGISTRY, type PermissionDef } from '#/config/permissions.js';
import { logger } from './logger.js';

/**
 * Upserts the code-defined permission catalog into the `permissions` table.
 * Idempotent — safe to run on every boot. Uses an admin-level client because
 * `permissions` is a global, non-tenant-scoped table with no INSERT/UPDATE
 * grant for `app_user` (see the init migration's RLS section).
 */
export async function syncPermissions(
  client: PrismaClient,
  registry: PermissionDef[] = PERMISSION_REGISTRY,
): Promise<void> {
  for (const def of registry) {
    await client.permission.upsert({
      where: { name: def.name },
      create: def,
      update: { resource: def.resource, action: def.action, description: def.description },
    });
  }
  logger.info({ count: registry.length }, 'permission catalog synced');
}
