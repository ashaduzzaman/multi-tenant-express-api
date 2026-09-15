import { PrismaClient } from '@prisma/client';
import { env } from '#/config/env.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * TWO CLIENTS, TWO ROLES — the safety boundary that makes RLS work
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `prisma` connects as `app_user`. RLS APPLIES.
 *   → Use for ALL request-scoped queries via withTenantContext().
 *   → If you forget to set the tenant GUC, queries return zero rows. Good.
 *
 * `adminPrisma` connects as the superuser. RLS IS BYPASSED.
 *   → Use ONLY for: migrations, tenant provisioning, permission-registry
 *     sync, system maintenance.
 *   → If you use this for a request-scoped query, you have a cross-tenant
 *     data leak. Don't.
 * ════════════════════════════════════════════════════════════════════════════
 */
export const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
export const adminPrisma = new PrismaClient({ datasourceUrl: env.DATABASE_ADMIN_URL });

export async function disconnectAll(): Promise<void> {
  await Promise.all([prisma.$disconnect(), adminPrisma.$disconnect()]);
}
