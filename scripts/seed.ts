import bcrypt from 'bcrypt';
import { adminDb, closePools } from '#/db/index.js';
import { tenants, users } from '#/db/schema.js';
import { logger } from '#/lib/logger.js';
import { env } from '#/config/env.js';

/**
 * Idempotent seed. Run repeatedly without producing duplicates.
 *
 * Creates two tenants ("acme" and "globex") with one owner each so you can
 * verify RLS isolation manually:
 *
 *   psql $DATABASE_URL -c "BEGIN; \
 *     SELECT set_config('app.current_tenant_id', '<acme uuid>', true); \
 *     SELECT count(*) FROM users; COMMIT;"
 *   → returns only acme's user count
 */
async function main(): Promise<void> {
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
    const [tenant] = await adminDb
      .insert(tenants)
      .values({ slug: t.slug, name: t.name })
      .onConflictDoUpdate({
        target: tenants.slug,
        set: { name: t.name, updatedAt: new Date() },
      })
      .returning();

    if (!tenant) {
      logger.error({ slug: t.slug }, 'failed to upsert tenant');
      continue;
    }

    await adminDb
      .insert(users)
      .values({
        tenantId: tenant.id,
        email: t.ownerEmail,
        name: t.ownerName,
        passwordHash,
        role: 'owner',
      })
      .onConflictDoNothing({ target: [users.tenantId, users.email] });

    logger.info({ tenant: tenant.slug, id: tenant.id }, '✅ seeded tenant');
  }

  await closePools();
  logger.info('seed complete. login with Password123!');
}

main().catch((err: unknown) => {
  logger.error({ err }, '❌ seed failed');
  process.exit(1);
});
