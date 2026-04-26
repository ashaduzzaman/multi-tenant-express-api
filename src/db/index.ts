import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '#/config/env.js';
import { logger } from '#/lib/logger.js';
import * as schema from './schema.js';

const { Pool } = pg;

/**
 * ════════════════════════════════════════════════════════════════════════════
 * TWO POOLS, TWO ROLES — the safety boundary that makes RLS work
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `appPool` connects as `app_user`. RLS APPLIES.
 *   → Use for ALL request-scoped queries via withTenantContext().
 *   → If you forget to set the tenant GUC, queries return zero rows. Good.
 *
 * `adminPool` connects as the superuser. RLS IS BYPASSED.
 *   → Use ONLY for: migrations, tenant provisioning, system maintenance.
 *   → If you use this for a request-scoped query, you have a cross-tenant data
 *     leak. Don't.
 *
 * Module exports:
 *   - `db`      — Drizzle on appPool. Default for everything except provisioning.
 *   - `adminDb` — Drizzle on adminPool. Import explicitly when you need it; the
 *                 name is meant to make code review obvious.
 * ════════════════════════════════════════════════════════════════════════════
 */

export const appPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS,
  application_name: 'multitenant-api:app',
});

export const adminPool = new Pool({
  connectionString: env.DATABASE_ADMIN_URL,
  max: 2, // small — admin operations are rare
  idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS,
  application_name: 'multitenant-api:admin',
});

appPool.on('error', (err) => logger.error({ err }, 'app pool error'));
adminPool.on('error', (err) => logger.error({ err }, 'admin pool error'));

export const db: NodePgDatabase<typeof schema> = drizzle(appPool, { schema });
export const adminDb: NodePgDatabase<typeof schema> = drizzle(adminPool, { schema });

export async function closePools(): Promise<void> {
  await Promise.all([appPool.end(), adminPool.end()]);
}
