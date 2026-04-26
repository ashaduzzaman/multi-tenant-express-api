import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { appPool } from './index.js';
import * as schema from './schema.js';
import { TenantContextError } from '#/lib/errors.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * withTenantContext — THE function every request handler uses for DB access
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Acquires a dedicated client, opens a transaction, sets the per-transaction
 * GUC `app.current_tenant_id`, and runs your callback with a Drizzle instance
 * scoped to that transaction. RLS policies on every tenant-scoped table read
 * this GUC and refuse to return rows for any other tenant.
 *
 * Why a transaction?
 *   - `SET LOCAL` is scoped to the current transaction. After COMMIT/ROLLBACK
 *     the GUC is cleared. This is what makes pooled connections safe — there
 *     is no way for tenant A's context to leak into tenant B's next query.
 *   - PgBouncer in transaction mode is also compatible with this pattern for
 *     the same reason.
 *
 * Why parameterize via set_config(name, value, true)?
 *   - `SET LOCAL app.current_tenant_id = $1` doesn't accept parameter binding
 *     in PostgreSQL. `set_config()` does, which keeps us safe from SQL
 *     injection even though tenantId comes from a verified JWT and "should"
 *     be safe.
 *
 * Usage:
 *   const users = await withTenantContext(req.tenantId!, (tx) =>
 *     tx.select().from(usersTable),
 *   );
 * ════════════════════════════════════════════════════════════════════════════
 */
export async function withTenantContext<T>(
  tenantId: string,
  callback: (tx: NodePgDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new TenantContextError('withTenantContext called without a valid tenantId');
  }

  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    // The third arg `true` means "local to this transaction"
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

    const tx = drizzle(client, { schema });
    const result = await callback(tx);

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* swallow rollback errors so the original error reaches the caller */
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Read-only variant — same isolation, but uses a READ ONLY transaction so the
 * database refuses any accidental writes. Use for GET handlers.
 */
export async function withTenantContextReadOnly<T>(
  tenantId: string,
  callback: (tx: NodePgDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new TenantContextError('withTenantContextReadOnly called without a valid tenantId');
  }

  const client = await appPool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

    const tx = drizzle(client, { schema });
    const result = await callback(tx);

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Health-check helper — confirms the app role can reach the DB and that the
 * tenant GUC mechanism works. Does NOT use a real tenant id.
 */
export async function pingTenantContext(): Promise<boolean> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      '00000000-0000-0000-0000-000000000000',
    ]);
    const r = await client.query<{ tenant: string | null }>(
      "SELECT current_setting('app.current_tenant_id', true) as tenant",
    );
    await client.query('COMMIT');
    return r.rows[0]?.tenant === '00000000-0000-0000-0000-000000000000';
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return false;
  } finally {
    client.release();
  }
}

// Re-export sql for migration files that need raw policies
export { sql };
