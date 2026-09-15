# PLAN.md — SaaS Starter Kit: Auth + RBAC + Users (Prisma edition)

> **This file is the single source of truth for what we are building and why.**
> `IMPLEMENTATION.md` is the companion file that tracks what has actually been
> done, in what order, and any deviations from this plan. Read both before
> touching code. Update this file whenever a decision changes; update
> `IMPLEMENTATION.md` after every completed step.

## 0. Origin & goal

`multi-tenant-express-api` is a multi-tenant SaaS API **starter kit** — Postgres
RLS for tenant isolation, Express 5, TypeScript. It ships as a scaffold with
no feature modules yet. We are fast-tracking it by reusing the **design and
business logic** (not the code — different DB layer) already proven in
`RIS-app-api`: login/refresh/logout flow, refresh-token rotation, timing-safe
auth, and a resource:action permission registry with role-based access
control.

Nothing is changed in `RIS-app-api`. This plan only touches
`express-next-saas/multi-tenant-express-api`.

**Scope of this pass:** Auth module (register/login/refresh/logout/me),
full granular RBAC (permissions/roles/role_permissions), Users module (CRUD).
Email, S3 storage/attachments, background queue, notifications, and profile
modules are explicitly deferred to a later pass.

## 1. Decisions made (do not re-litigate without a reason)

| Decision | Choice | Why |
|---|---|---|
| ORM | **Prisma** (swap out Drizzle) | Explicit user instruction. Supersedes the "don't switch ORM" rule in the old CLAUDE.md — that rule is being rewritten as part of this change. |
| Auth transport | httpOnly cookies, access (15m) + refresh (30d) with rotation | Matches RIS's proven pattern; most complete option for a starter kit. Bearer header kept as a fallback for non-browser clients. |
| RBAC depth | Full granular `permissions` / `roles` / `role_permissions`, tenant-scoped roles | "Great starter kit" bar — richer than the enum this scaffold shipped with. |
| First-pass module scope | Auth + RBAC + Users only | Deliberately tight; email/storage/queue/notifications/profile are a documented follow-up, not forgotten. |
| Process | TDD, two living markdown files (this one + `IMPLEMENTATION.md`), implement in one continuous pass | Explicit user instruction. |

## 2. Tech stack (updated)

- **Runtime:** Node.js 22+, TypeScript 5, ESM (`NodeNext`)
- **HTTP:** Express 5
- **ORM:** **Prisma** (`@prisma/client` + `prisma` CLI) — replaces Drizzle entirely
- **DB:** PostgreSQL, Row Level Security for tenant isolation (unchanged model)
- **Auth:** `jose` (JWT), `bcrypt` (hashing) — unchanged, these were already right
- **Validation:** Zod — unchanged
- **Testing:** Vitest + **Supertest** (new dependency — needed for HTTP-level TDD against Express routers) + a real Postgres instance for integration/repo tests
- **Logging:** Pino — unchanged

## 3. Why Prisma changes the tenant-isolation mechanism (and how we preserve it)

The old `withTenantContext()` worked because Drizzle can run directly against
a `pg.PoolClient` inside a hand-managed `BEGIN` / `set_config()` / `COMMIT`.
Prisma manages its own connection pool internally, but it exposes the same
capability via **interactive transactions**:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
  return tx.user.findMany(); // RLS-filtered, same as before
});
```

`tx` inside the callback is bound to a single reserved connection for the
duration of the transaction — exactly the property `SET LOCAL` /
`set_config(..., true)` depends on. This is a drop-in replacement for the
Drizzle version; the public API (`withTenantContext`, `withTenantContextReadOnly`)
keeps the same signature so every module written against it looks the same
as it would have under Drizzle.

**Two-role, two-client pattern (unchanged in spirit):**

- `prisma` (from `src/db/client.ts`) — connects as `app_user`. RLS enforced.
  All request-scoped queries, always via `withTenantContext()`.
- `adminPrisma` — connects as the Postgres superuser / `app_admin`. RLS
  bypassed. Migrations, tenant provisioning, seeding, permission-registry
  sync. **Never used inside a request handler.**

Implemented as two `PrismaClient` instances, each constructed with its own
`datasourceUrl` (Prisma 5+ supports this without needing two separate
`schema.prisma` files).

**Read-only variant:** Prisma's interactive transactions don't have a native
`BEGIN READ ONLY` flag, so `withTenantContextReadOnly()` issues
`SET TRANSACTION READ ONLY` as the first statement inside the callback,
before `set_config`. Same guarantee, one extra statement.

## 4. Migration workflow (replaces the Drizzle workflow in the old CLAUDE.md)

Prisma Migrate does not generate RLS policies any more than Drizzle Kit did.
The workflow is the same shape, different commands:

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate the migration WITHOUT applying it
npx prisma migrate dev --create-only --name <name>
# 3. Hand-edit the generated prisma/migrations/<ts>_<name>/migration.sql
#    to append: ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY,
#    CREATE POLICY, GRANT — same template as before.
# 4. Apply
npx prisma migrate dev
# (CI/prod: npx prisma migrate deploy)
```

Step 3 is mandatory for every new tenant-scoped table, same rule as before.

## 5. Data model

All UUID primary keys (`gen_random_uuid()`, from the `pgcrypto` extension —
already enabled by `db/init/01-extensions.sql`).

```prisma
enum TenantStatus {
  active
  suspended
  deleted
}

model Tenant {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug      String   @unique @db.VarChar(64)
  name      String   @db.VarChar(255)
  status    TenantStatus @default(active)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @default(now()) @map("updated_at") @db.Timestamptz

  users         User[]
  roles         Role[]
  refreshTokens RefreshToken[]

  @@map("tenants")
}

model User {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String    @map("tenant_id") @db.Uuid
  tenant       Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  email        String    @db.VarChar(255)
  passwordHash String    @map("password_hash")
  name         String    @db.VarChar(255)
  roleId       String    @map("role_id") @db.Uuid
  role         Role      @relation(fields: [roleId], references: [id])
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime  @default(now()) @map("updated_at") @db.Timestamptz
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz

  refreshTokens RefreshToken[]

  @@unique([tenantId, email], map: "idx_users_tenant_email")
  @@index([tenantId, createdAt], map: "idx_users_tenant_created")
  @@index([tenantId, roleId], map: "idx_users_tenant_role")
  @@map("users")
}

// Global catalog — code-defined, shared across tenants, NOT tenant data.
// Same treatment as `tenants` itself: no tenant_id, no RLS, read-only grant.
model Permission {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        String   @unique @db.VarChar(100) // e.g. "users:read"
  resource    String   @db.VarChar(50)
  action      String   @db.VarChar(50)
  description String
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz

  rolePermissions RolePermission[]

  @@map("permissions")
}

model Role {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name      String   @db.VarChar(100)
  isSystem  Boolean  @default(false) @map("is_system")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @default(now()) @map("updated_at") @db.Timestamptz

  users           User[]
  rolePermissions RolePermission[]

  @@unique([tenantId, name], map: "idx_roles_tenant_name")
  @@index([tenantId, createdAt], map: "idx_roles_tenant_created")
  @@map("roles")
}

// Junction table. tenantId is DENORMALIZED here (not just reachable via
// role_id join) so RLS can enforce it directly without a subquery join,
// per this repo's own indexing/RLS conventions.
model RolePermission {
  tenantId     String @map("tenant_id") @db.Uuid
  tenant       Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  roleId       String @map("role_id") @db.Uuid
  role         Role   @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permissionId String @map("permission_id") @db.Uuid
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  @@index([tenantId, roleId], map: "idx_role_permissions_tenant_role")
  @@map("role_permissions")
}

model RefreshToken {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  userId    String   @map("user_id") @db.Uuid
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique @map("token_hash")
  expiresAt DateTime @map("expires_at") @db.Timestamptz
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([tenantId, userId], map: "idx_refresh_tokens_tenant_user")
  @@map("refresh_tokens")
}
```

Notes / breaking changes vs. the current scaffold:
- `users.role` enum column is **removed**, replaced by `users.roleId` FK →
  `roles.id`. `requireRole('owner'|'admin'|'member')` is replaced by
  `requirePermission('<resource>:<action>')`; a thin `requireAnyPermission`
  helper is ported too. Every seeded tenant still gets Owner/Admin/Member
  roles by default, so "coarse role" behavior is preserved, just modeled as
  data instead of an enum.
- `permissions` has no `tenant_id` — it's a shared, code-defined catalog
  (see `src/config/permissions.ts`), synced into the DB at boot, same
  mechanism as RIS's `PERMISSION_REGISTRY` + `syncPermissions()`.

## 6. RLS policy template (per new tenant-scoped table)

Applied to `users` (already existed, needs no change), `roles`,
`role_permissions`, `refresh_tokens`. **Not** applied to `tenants` (existing
policy) or `permissions` (global catalog, no policy — `GRANT SELECT` only).

```sql
ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;

CREATE POLICY "<table>_tenant_isolation" ON "<table>"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "<table>" TO app_user;
```

## 7. Permission catalog (starter set, `src/config/permissions.ts`)

Small and generic — this is a template, not RIS's fleet-maintenance app:

```
users:read, users:create, users:update, users:delete
roles:read, roles:create, roles:update, roles:delete
```

`Owner` role gets all permissions at tenant-creation time. `Admin` gets
everything except `roles:delete`. `Member` gets `users:read` only. (Mirrors
RIS's "Admin gets everything, others configurable" pattern, scaled down.)

## 8. Module plan

### `modules/auth/` — `/api/v1/auth`

**Design note not present in RIS-app-api (single-tenant, so this never came up):**
`users.email` is unique *per tenant*, not globally (`idx_users_tenant_email`).
That means login can't resolve "which tenant" from email alone — two tenants
can each have an `owner@acme.test`. Login therefore takes a `tenantSlug`
alongside credentials (the same pattern Slack/Notion/etc. use — a workspace
identifier plus credentials). Refresh/logout face the same problem from a
different angle: the refresh cookie alone doesn't carry a tenant context yet.
Resolved by giving `refresh_tokens.token_hash` a **global** unique constraint
(already in the schema) and resolving tenant from it via a narrow, justified
`adminPrisma` lookup-by-opaque-hash (the token is 32 random bytes — not
guessable, and this is the one place besides provisioning where bypassing
RLS is correct, not a shortcut). Every subsequent operation in that request
still goes through `withTenantContext` once the tenant is known.

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/register` | none | `{ tenantName, tenantSlug, email, password, name }` | Creates tenant + seeds Owner/Admin/Member roles (Owner/Admin/Member get permissions per `DEFAULT_ROLE_PERMISSIONS`) + creates Owner user, in one `adminPrisma.$transaction` (provisioning, not request-scoped RLS). Requires the permission catalog to already be synced (see Phase 10 boot sequence). |
| POST | `/login` | none | `{ tenantSlug, email, password }` | Resolve tenant by slug (`adminPrisma`, narrow lookup — slug existence isn't sensitive), then look up the user tenant-scoped. Dummy-bcrypt timing defense (ported from RIS) applies whether the tenant, the user, or the password is what's wrong — the response is identical in all three cases. Sets access+refresh cookies. |
| POST | `/refresh` | refresh cookie | — | Resolve tenant from the token hash (see design note above), rotate (delete-old-insert-new), matches RIS's rotation-on-use pattern. |
| POST | `/logout` | none | — | Best-effort: resolve + delete the refresh token row if present, always clear cookies. |
| GET | `/me` | access cookie/bearer | — | Returns user + permissions. |

### `modules/roles/` — `/api/v1/roles` (all routes: auth + tenant context + permission gate)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/` | `roles:read` | paginated, includes `permissionIds`/`userCount` |
| GET | `/permissions` | `roles:read` | full permission catalog |
| POST | `/` | `roles:create` | `{ name, permissionIds? }` |
| PUT | `/:id` | `roles:update` | `{ name?, permissionIds? }` — invalidates permission cache |
| DELETE | `/:id` | `roles:delete` | 403 if `isSystem`; 409 if users assigned |

### `modules/users/` — `/api/v1/users`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/` | `users:read` | paginated |
| GET | `/:id` | `users:read` | |
| POST | `/` | `users:create` | `{ email, name, password, roleId }` |
| PUT | `/:id` | `users:update` | partial |
| PUT | `/:id/password` | `users:update` | self or admin |
| DELETE | `/:id` | `users:delete` | soft delete; cannot delete self |

## 9. Layering (per existing `src/modules/README.md`, unchanged contract)

```
<feature>.schema.ts    Zod schemas
<feature>.repo.ts      Prisma queries — ALWAYS via withTenantContext()
<feature>.service.ts   business logic, orchestrates repo, throws AppError
<feature>.handlers.ts  thin HTTP layer — parse, call service, respond
<feature>.router.ts    Express Router + middleware wiring
<feature>.*.test.ts    tests — see §10
```

Dependency direction: router → handlers → service → repo → Prisma. Handlers
never import Prisma. Services never import Prisma directly (repo does).
Repos take `tenantId` as their first parameter, no exceptions.
Constructor-injected repos into services (not module-level singletons)
so tests can pass fakes — this is the one deliberate deviation from RIS's
`new XRepository()` — `new XService(repo)` pattern: we keep the shape but
make it so a test can new up a service with a stub repo without touching Prisma.

## 10. Testing strategy — TDD, tests are the priority deliverable

**Order for every unit of work: write a failing test → implement → refactor.**
No production code is written without a test that required it first.

Three layers, all real (no framework-level mocking of Prisma — mock only at
the repo boundary):

1. **Pure logic (Vitest, no DB, no HTTP):** `refresh-token.ts` (hash/generate),
   `pagination.ts`, Zod schemas (valid/invalid input), permission-cache TTL
   behavior (fake timers), service-layer business rules with a **stubbed
   repo** (e.g. "deleting a system role throws ForbiddenError" — repo stub
   returns `isSystem: true`, no DB involved).
2. **Repo/integration (Vitest + real Postgres):** every `.repo.ts` function
   against a real transaction via `withTenantContext`, asserting RLS
   isolation explicitly — the same tenant sees its row, a different
   `tenantId` sees zero rows. This is the layer that actually proves RLS
   works; it must run against Postgres, never mocked.
3. **HTTP/E2E (Vitest + Supertest):** each router mounted on a minimal
   `createApp()` instance, hitting real endpoints, asserting status codes,
   response shapes, and cross-cutting concerns (cookies set/cleared,
   401 on bad token, 403 on missing permission).

**Test database:** a dedicated Postgres database (`multitenant_test`),
migrated the same way as dev. `tests/setup.ts` runs `prisma migrate deploy`
equivalent once (or assumes it's already migrated) and each test file wraps
its assertions so leftover rows don't bleed across tests (either
truncate-in-`afterEach` or unique-per-test tenant slugs — we use unique
per-test tenant slugs, since RLS isolation tests specifically need
*multiple* coexisting tenants).

**Coverage bar:** the scaffold's existing `vitest.config.ts` threshold
(70% lines/functions/branches/statements) stays the floor, not the target —
auth/RBAC is security-critical code and should read closer to 90%+ in
practice, especially every branch of `requirePermission`, token
verification, and the refresh-rotation path.

**New dev dependency:** `supertest` + `@types/supertest` (RIS already
depended on this — same package, reused choice).

## 11. Environment variables (additions to `src/config/env.ts`)

```
COOKIE_ACCESS_NAME=mt_access       (default)
COOKIE_REFRESH_NAME=mt_refresh     (default)
REFRESH_TOKEN_TTL_DAYS=30          (default 30)
```

`DATABASE_URL` / `DATABASE_ADMIN_URL` are reused as-is but now point Prisma
instead of `pg.Pool` — same two-role convention, same variable names, so
`.env.example` barely changes.

## 12. package.json changes

Remove: `drizzle-orm`, `drizzle-kit`.
Add (deps): `@prisma/client`.
Add (devDeps): `prisma`, `supertest`, `@types/supertest`.
Scripts: `db:generate` → `prisma generate`, `db:migrate` → `prisma migrate
deploy` (prod) / the dev loop uses `prisma migrate dev`, `db:studio` →
`prisma studio`. `db:seed` unchanged in intent (idempotent seed script), now
calls Prisma instead of Drizzle.

## 13. Design principles applied

- **Layered architecture / separation of concerns** — router/handler/service/repo,
  each with one reason to change (routing, HTTP shape, business rules, persistence).
- **Dependency inversion at the service boundary** — services receive their
  repo via constructor, so business-rule tests never touch a database.
- **Single source of truth** — permission catalog defined once in code,
  synced to DB, never hand-edited in two places.
- **Fail-fast config** — Zod-validated env at boot (unchanged from scaffold).
- **Defense in depth** — RLS at the DB layer is the safety net; application
  code scoping by `tenantId` is the first line, not the only line.
- **Least privilege** — `app_user` cannot bypass RLS even as table owner
  (`FORCE ROW LEVEL SECURITY`); permission checks are explicit allow-lists,
  not deny-lists.
- **12-factor config** — no secrets in code, everything through validated env.

## 14. Explicitly out of scope this pass

Email service, S3 storage/attachments, pg-boss background queue,
notifications module, user profile module (self-service profile beyond
what `/auth/me` already returns), department/location/vehicle/etc modules
(all RIS-specific business domain, not reused at all).

## 15. Phased build order

See `IMPLEMENTATION.md` for the live checklist. Order:

1. Prisma swap: schema.prisma, two-client setup, `withTenantContext`
   reimplementation, remove Drizzle, update scripts/config.
2. Schema: roles/permissions/role_permissions/refresh_tokens + users.roleId,
   migration with RLS.
3. `src/config/permissions.ts` + sync-on-boot script.
4. Lib utilities: refresh-token, pagination, permission-cache.
5. Middleware: cookie-aware auth, loadPermissions, requirePermission(s).
6. `modules/auth/`.
7. `modules/roles/`.
8. `modules/users/`.
9. Seed script (tenants + default roles + owner user).
10. Wire into `app.ts`, update `CLAUDE.md`/`README.md`/`modules/README.md`.
11. Full suite: `npm run typecheck && npm run lint && npm test`.
