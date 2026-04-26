import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * MULTI-TENANT SCHEMA CONVENTIONS — read CLAUDE.md before adding tables
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Every tenant-scoped table MUST:
 *   1. Include `tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' })`
 *   2. Lead every index with tenantId, e.g. index('idx_x_tenant_created').on(t.tenantId, t.createdAt)
 *   3. Have its RLS policy declared in the same migration that creates it
 *      (see db/migrations/0000_*.sql for the template)
 *
 * The `tenants` table itself is the ONLY table without a tenant_id column.
 * It's accessed via app_admin (RLS-bypassing) for provisioning, and via
 * app_user with an RLS policy that lets a user see only their own tenant row.
 * ════════════════════════════════════════════════════════════════════════════
 */

// ─── Enums ──────────────────────────────────────────────────────────────────
export const userRoleEnum = pgEnum('user_role', ['owner', 'admin', 'member']);
export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'deleted']);

// ─── tenants ────────────────────────────────────────────────────────────────
// The root of the multi-tenancy graph. No tenant_id column on this table.
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    status: tenantStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('idx_tenants_slug').on(t.slug)],
);

// ─── users ──────────────────────────────────────────────────────────────────
// Email is unique within a tenant, NOT globally — the same person can have
// accounts in multiple tenants.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    role: userRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // Unique email PER TENANT — note the composite
    uniqueIndex('idx_users_tenant_email').on(t.tenantId, t.email),
    // Tenant-leading indexes for common query patterns
    index('idx_users_tenant_created').on(t.tenantId, t.createdAt),
    index('idx_users_tenant_role').on(t.tenantId, t.role),
  ],
);

// ─── Type exports for use in modules ────────────────────────────────────────
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
