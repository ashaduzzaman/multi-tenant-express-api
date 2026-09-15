import { adminPrisma, disconnectAll } from '#/db/client.js';
import { registerTenantWithOwner } from '#/modules/auth/auth.repo.js';
import { syncPermissions } from '#/lib/sync-permissions.js';
import { logger } from '#/lib/logger.js';
import { env } from '#/config/env.js';
import bcrypt from 'bcrypt';

/**
 * Idempotent seed. Run repeatedly without producing duplicates or errors.
 *
 * Creates two tenants ("acme" and "globex"), each fully provisioned with
 * Owner/Admin/Member roles (via the same `registerTenantWithOwner` the real
 * /auth/register endpoint uses — no separate seed-only code path to drift
 * out of sync) and one Owner user, so you can verify RLS isolation manually:
 *
 *   psql $DATABASE_ADMIN_URL -c "BEGIN; \
 *     SELECT set_config('app.current_tenant_id', '<acme tenant id>', true); \
 *     SELECT count(*) FROM users; COMMIT;"
 *   → returns only acme's user count
 */
async function main(): Promise<void> {
  await syncPermissions(adminPrisma);

  const passwordHash = await bcrypt.hash('Password123!', env.BCRYPT_ROUNDS);
  const seedData = [
    { slug: 'acme', name: 'Acme Inc.', ownerEmail: 'owner@acme.test', ownerName: 'Acme Owner' },
    {
      slug: 'globex',
      name: 'Globex Corp.',
      ownerEmail: 'owner@globex.test',
      ownerName: 'Globex Owner',
    },
  ];

  for (const t of seedData) {
    const existing = await adminPrisma.tenant.findUnique({ where: { slug: t.slug } });
    if (existing) {
      logger.info({ tenant: t.slug, id: existing.id }, '↩️  tenant already seeded, skipping');
      continue;
    }

    const result = await registerTenantWithOwner(
      { tenantName: t.name, tenantSlug: t.slug, email: t.ownerEmail, name: t.ownerName },
      passwordHash,
    );
    logger.info({ tenant: t.slug, id: result.tenantId }, '✅ seeded tenant');
  }

  await disconnectAll();
  logger.info('seed complete. login with Password123!');
}

main().catch((err: unknown) => {
  logger.error({ err }, '❌ seed failed');
  process.exit(1);
});
