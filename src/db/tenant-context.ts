import type { Prisma } from "@prisma/client";
import { prisma } from "./client.js";
import { TenantContextError } from "#/lib/errors.js";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * withTenantContext — THE function every request handler uses for DB access
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Opens a Prisma interactive transaction (a single reserved connection for
 * the lifetime of the callback), sets the per-transaction GUC
 * `app.current_tenant_id`, and runs your callback with a transaction client
 * scoped to it. RLS policies on every tenant-scoped table read this GUC and
 * refuse to return rows for any other tenant.
 *
 * Why a transaction?
 *   - `set_config(name, value, true)` is scoped to the current transaction
 *     (the third argument means "local"). After commit/rollback the GUC is
 *     cleared — this is what makes pooled connections safe, and what makes
 *     PgBouncer in transaction mode compatible.
 *
 * Why parameterize via set_config() instead of string interpolation?
 *   - `SET LOCAL app.current_tenant_id = $1` doesn't accept parameter
 *     binding in PostgreSQL. `set_config()` does. Prisma's tagged-template
 *     `$executeRaw` parameterizes the interpolated value for us — this is
 *     NOT string concatenation, even though it reads like it.
 *
 * Usage:
 *   const rows = await withTenantContext(tenantId, (tx) => tx.user.findMany());
 * ════════════════════════════════════════════════════════════════════════════
 */
export async function withTenantContext<T>(
  tenantId: string,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId, "withTenantContext");

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return callback(tx);
  });
}

/**
 * Read-only variant — same isolation, but the transaction rejects any write
 * the database sees, independent of application logic. Use for GET handlers.
 */
export async function withTenantContextReadOnly<T>(
  tenantId: string,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId, "withTenantContextReadOnly");

  return prisma.$transaction(async (tx) => {
    // Must be the first statement in the transaction — Postgres rejects
    // SET TRANSACTION characteristics once a query has already run.
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return callback(tx);
  });
}

/**
 * Health-check helper — confirms the app role can reach the DB and that the
 * tenant GUC mechanism works. Does NOT use a real tenant id.
 */
export async function pingTenantContext(): Promise<boolean> {
  const fakeTenantId = "00000000-0000-0000-0000-000000000000";
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${fakeTenantId}, true)`;
      const rows = await tx.$queryRaw<
        { tenant: string | null }[]
      >`SELECT current_setting('app.current_tenant_id', true) as tenant`;
      return rows[0]?.tenant === fakeTenantId;
    });
  } catch {
    return false;
  }
}

function assertTenantId(tenantId: string, fnName: string): void {
  if (!tenantId || typeof tenantId !== "string") {
    throw new TenantContextError(`${fnName} called without a valid tenantId`);
  }
}
