# CLAUDE.md

> **Read this file in full before writing any code in this repo.**
> It encodes architectural rules that, if violated, cause cross-tenant data leaks, RLS bypasses, or migration corruption. None of these failures are obvious in PR review unless you know what you're looking for.
>
> **Also read `PLAN.md`, `IMPLEMENTATION.md`, and `MODULES.md`** before starting new work. `PLAN.md` is the architecture/design record (why things are shaped the way they are — e.g. why login takes a `tenantSlug`, why two admin-bypass reads are sanctioned). `IMPLEMENTATION.md` is the phase-by-phase build log, including bugs found and fixed along the way. `MODULES.md` tracks, across the full set of modules a multi-tenant SaaS needs (tenancy, identity, billing, platform services, observability, admin, product surface), which ones exist here and which don't yet — check it before assuming a module is or isn't built. Keep all three up to date as you go — they are the project's memory across sessions, not one-off planning artifacts to discard once "done."

---

## 1. What this project is

A multi-tenant SaaS API **starter kit**. **Single PostgreSQL database, single schema, `tenant_id` discriminator column on every tenant-scoped table, Postgres Row Level Security (RLS) enforces isolation at the database layer.**

The whole point of this architecture is that tenant isolation does **not** depend on the application remembering to add `WHERE tenant_id = ?` to every query. The database refuses to return rows for any tenant other than the one in the current transaction's GUC, even if the application code is buggy. This is the safety net. Don't bypass it.

It ships with three feature modules out of the box — **auth** (register/login/refresh/logout/me, cookie-based with refresh rotation), **roles** (tenant-scoped custom roles + a granular permission catalog), and **users** (CRUD, soft delete) — so a new project starts from a working, tested foundation instead of an empty scaffold. Email, file storage, background jobs, and notifications are deliberately not included yet; see `PLAN.md` §14 for what's out of scope and why.

## 2. Tech stack (locked)

- **Runtime:** Node.js 22 (see `.nvmrc`)
- **Package manager:** pnpm 9
- **Language:** TypeScript 5.7, strict mode, ESM (`"type": "module"`), NodeNext resolution
- **HTTP:** Express 5
- **ORM / migrations:** **Prisma** (`@prisma/client` + `prisma` CLI)
- **Validation:** Zod (at every boundary — env, request bodies, JWT claims)
- **Auth:** JWT via `jose`, password hashing via `bcrypt`, httpOnly cookies (access + rotating refresh)
- **Logging:** Pino (structured JSON in prod, pino-pretty in dev)
- **Testing:** Vitest + Supertest, TDD (test before implementation — see §9)
- **Lint/format:** ESLint 9 (flat config, type-checked rules) + Prettier

Don't swap any of these without an explicit instruction from the user. (This project *did* swap ORMs once already — Drizzle → Prisma — on explicit user instruction; see `PLAN.md` §1–2 for that decision record. That's the bar: an explicit instruction, not a preference.)

## 3. The multi-tenant security model — non-negotiable

There are **two database roles** with **two separate Prisma clients**, both defined in `src/db/client.ts`:

| Role | Client export | RLS behavior | Allowed uses |
|---|---|---|---|
| `app_user` | `prisma` | **Enforces RLS** | All request-scoped queries. Always via `withTenantContext()`. |
| superuser (`postgres` / `app_admin`) | `adminPrisma` | **Bypasses RLS** | Migrations. Tenant provisioning. Permission-catalog sync. System maintenance. **Never request-scoped**, with exactly two documented, narrow exceptions — see below. |

If you find yourself reaching for `adminPrisma` inside a request handler, **stop**. You are about to write a cross-tenant data leak, unless what you're doing is one of these two sanctioned exceptions (both in `src/modules/auth/auth.repo.ts`, both explained in `PLAN.md`'s auth module design note):

1. **Tenant provisioning at registration** (`registerTenantWithOwner`) — `app_user` has no INSERT grant on `tenants` at all, by design.
2. **Resolving a tenant from an opaque, globally-unique token hash** (`findTenantBySlug`, `findRefreshTokenByHash`) — login and refresh don't have a tenant context yet, and the value being looked up (a slug, or a 32-random-byte hash) isn't sensitive tenant data in the way a user row is.

Anything else needing cross-tenant access (rare — e.g. a SaaS admin panel) should be a separate module, gated behind a different auth check, with the reasoning documented in a code comment same as the two exceptions above.

### How `withTenantContext()` works

```ts
import { withTenantContext } from '#/db/tenant-context.js';

const users = await withTenantContext(tenantId, (tx) => tx.user.findMany());
```

What happens internally (`src/db/tenant-context.ts`):

1. Opens a Prisma **interactive transaction** (`prisma.$transaction(async (tx) => …)`) — this reserves a single connection for the callback's lifetime, which is what makes the next step safe.
2. `tx.$executeRaw\`SELECT set_config('app.current_tenant_id', ${tenantId}, true)\`` — the tagged-template interpolation is parameterized by Prisma, not string-concatenated. The `true` third argument means *transaction-local*, cleared on commit/rollback.
3. Runs your callback with `tx` (a `Prisma.TransactionClient`) — RLS policies filter automatically.
4. Prisma commits on return, rolls back on throw, and releases the connection.

Because the GUC is transaction-scoped, **pooled connections are safe** — there is no way for tenant A's context to leak into tenant B's next query, even with PgBouncer in transaction mode.

For read-only requests (GET handlers) use `withTenantContextReadOnly()` — same isolation, plus a `SET TRANSACTION READ ONLY` issued before `set_config` so accidental writes are rejected by the database itself, not just by convention.

## 4. Database conventions — every new model follows these

When adding a model to `prisma/schema.prisma`:

1. **Tenant column.** Every tenant-scoped model MUST have:
   ```prisma
   tenantId String @map("tenant_id") @db.Uuid
   tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
   ```
   No nullable `tenantId`. No non-UUID type. No skipping the relation.

2. **Tenant-leading indexes.** Every index on a tenant-scoped model must lead with `tenantId`:
   ```prisma
   @@index([tenantId, createdAt], map: "idx_orders_tenant_created")
   ```
   Same rule for unique constraints — `@@unique([tenantId, slug])`, never `@@unique([slug])`. Even a **junction table** (e.g. `RolePermission`) carries a denormalized `tenantId` for this reason — don't rely on reaching tenant scoping through a join.

3. **RLS policy.** In the SAME migration that creates the table, add the RLS enable + policy. `prisma migrate dev --create-only` generates the schema SQL but **does NOT generate RLS policies** — hand-edit the generated `migration.sql` to append them. Template:

   ```sql
   ALTER TABLE "<table_name>" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "<table_name>" FORCE ROW LEVEL SECURITY;

   CREATE POLICY "<table_name>_tenant_isolation" ON "<table_name>"
     USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
     WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

   GRANT SELECT, INSERT, UPDATE, DELETE ON "<table_name>" TO app_user;
   ```

   - `FORCE ROW LEVEL SECURITY` makes RLS apply even to the table owner. Without it, whoever owns the table bypasses the policy.
   - `WITH CHECK` prevents writes that would put a row into a different tenant's bucket — a defense against `UPDATE … SET tenant_id = ...` attacks.
   - The cast `::uuid` makes Postgres reject a malformed GUC value loudly instead of silently returning everything.
   - The `GRANT` is needed because `app_user` is not the table owner.
   - **Exception:** a truly global, code-defined catalog table with no tenant meaning at all (there's exactly one: `permissions`, see `src/config/permissions.ts`) gets `GRANT SELECT` only, no RLS policy, same treatment as `tenants` gets for `INSERT` (i.e., none — provisioning-only, via `adminPrisma`).

4. **Soft delete (optional).** If the model needs soft delete, add `deletedAt DateTime? @map("deleted_at") @db.Timestamptz` and have the repo filter `WHERE deletedAt: null` by default (see `users.repo.ts`). RLS does not handle soft delete — that's an application concern.

5. **Timestamps.** Always include:
   ```prisma
   createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
   updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz
   ```

### Migration workflow

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate the migration WITHOUT applying it
npx prisma migrate dev --create-only --name <name>
# 3. EDIT the generated prisma/migrations/<ts>_<name>/migration.sql to append
#    RLS policies and grants (see template above)
# 4. Apply
npx prisma migrate dev
# (CI/prod: npx prisma migrate deploy — this is what `pnpm db:migrate` runs)
# 5. Regenerate the client (also happens automatically on `migrate dev`)
npx prisma generate
```

Step 3 is mandatory and easy to forget. **Never apply a migration that adds a tenant-scoped table without RLS.**

## 5. Adding a new feature module

Layout under `src/modules/<feature>/` (see `modules/auth`, `modules/roles`, `modules/users` for real examples, all built this way):

```
<feature>.schema.ts      ← Zod schemas
<feature>.repo.ts        ← Prisma queries via withTenantContext
<feature>.service.ts     ← Business logic (constructor-injected repo — see below)
<feature>.handlers.ts    ← Thin HTTP handlers
<feature>.router.ts      ← Express router, mounts middleware
<feature>.schema.test.ts
<feature>.repo.test.ts
<feature>.service.test.ts
<feature>.router.test.ts ← Supertest, real DB, real routes
```

### Layer rules

- **Handler** parses input with Zod, calls service, sends response. No DB access. No business logic.
- **Service** orchestrates. Calls repo. Enforces invariants. No HTTP types, no Prisma import.
- **Repo** is the only layer that imports from `#/db/`. Every function takes `tenantId: string` as its first parameter and wraps Prisma in `withTenantContext()` / `withTenantContextReadOnly()`.
- **Schema** lives in its own file so it can be reused by tests and OpenAPI generators.

### Dependency inversion: services take an injected repo

Every service exports both a class taking a repo-shaped interface in its constructor, **and** a ready-to-use singleton wired to the real repo module:

```ts
// roles.service.ts
export interface RolesRepo { listRoles: (...) => Promise<...>; /* … */ }

export class RolesService {
  constructor(private readonly repo: RolesRepo) {}
  async remove(tenantId: string, roleId: string): Promise<void> { /* business rules */ }
}

export const rolesService = new RolesService(repo); // handlers import THIS
```

This is the one deliberate difference from a naive "just call the repo module's functions directly" approach: it means `roles.service.test.ts` can construct `new RolesService(fakeRepo)` with `vi.fn()` stubs and test business rules (e.g. "a system role can't be deleted") **without touching the database at all**. Handlers and the router always import the singleton, never the class directly.

### Copy-paste starting point

Look at `src/modules/roles/` — it's the smallest complete example of this pattern (schema, repo with a Prisma error-code mapping, service with injected-repo unit tests, handlers, router with per-route `requirePermission`, and an end-to-end Supertest suite). Copy its shape for a new module.

Then mount in `src/app.ts`:
```ts
import { projectsRouter } from '#/modules/projects/projects.router.js';
app.use('/api/v1/projects', projectsRouter);
```
(Each router wires its own `authMiddleware` / `tenantContextMiddleware` / `loadPermissions` / `requirePermission` internally — see `roles.router.ts` — so `app.ts` stays a plain index of what's mounted where, not a place where auth wiring gets repeated.)

## 6. RBAC — permissions, roles, and the two auth-context stages

- **Permissions are a global, code-defined catalog** (`src/config/permissions.ts` → `PERMISSION_REGISTRY`). Add an entry there, restart the API (or run `pnpm db:sync-permissions`), and it's in the DB — no migration needed. This table has no `tenant_id` and no RLS (see §4's exception).
- **Roles are tenant-scoped data** (`roles` + `role_permissions`). Every new tenant gets three default roles (Owner/Admin/Member) seeded by `registerTenantWithOwner`, mapped from `DEFAULT_ROLE_PERMISSIONS`. Tenants can create their own custom roles via `POST /api/v1/roles`.
- **`req.auth` is populated in two stages**, deliberately not one:
  1. `authMiddleware` → `userId`, `tenantId`, `email`, `roleId` (from the verified JWT).
  2. `loadPermissions` → `permissions: string[]` (via `permissionCache`, a 5-minute TTL cache keyed by `tenantId:roleId`, falling back to a real `role_permissions` join on a miss).

  A route that only needs identity (`GET /auth/me` before permissions are attached) shouldn't pay for a permission-cache lookup it never uses — that's why these are two separate middlewares, not one.
- **Route gating:** `requirePermission('resource:action')` for a single required permission, `requireAnyPermission(...)` when several permissions could each legitimately allow the route, `requireSelfOrPermission('id', 'permission')` for "you can always act on your own resource, otherwise you need the permission" (see `users.router.ts`'s password-change route).
- **Cache invalidation:** call `permissionCache.invalidate(tenantId, roleId)` any time a role's `role_permissions` change (see `roles.service.ts`'s `update`/`remove`) — but only when they actually changed; a bare rename shouldn't force a cache miss for every user on that role.

## 7. Validation rules

- **At every boundary, Zod-validate.** Env vars at boot. Request bodies in handlers. JWT claims after `jwtVerify`. Never trust `req.body` directly.
- Use `.parse()` (throws ZodError → 422 via the global error handler) rather than `.safeParse()` unless you specifically need to handle invalid input non-fatally.
- Define schemas once in `<feature>.schema.ts` and infer TS types via `z.infer<typeof schema>`. Don't duplicate types.

## 8. Errors

Throw a typed `AppError` subclass (`BadRequestError`, `NotFoundError`, `ConflictError`, `UnauthorizedError`, `ForbiddenError`, `ValidationError`) for anything the user did wrong or any known business condition. The global error handler (`src/middleware/error-handler.ts`) turns these into clean JSON with the right status code.

For unexpected errors, throw a plain `Error` (or let it bubble). The handler logs it as `error` level and returns a 500 with no internals exposed.

**Never** put user input or row data into the `message` field — it ends up in logs and gets emailed to whoever's on call. Put it in `details` instead, where the Pino redaction config can scrub it.

Map Prisma's known error codes at the repo boundary, not upstream: `P2002` (unique constraint) → `ConflictError`, `P2003` (FK violation) → `BadRequestError`. See `roles.repo.ts`'s `mapWriteError` / `users.repo.ts`'s `mapWriteError` for the pattern.

**`notFoundHandler` must be a plain `RequestHandler` (3 args), never `ErrorRequestHandler` (4 args).** Express decides whether a middleware is an error handler purely by counting its declared parameters. A 4-arg "404 handler" only ever runs when something upstream calls `next(err)` — at which point it silently intercepts every real error before `errorHandler` sees it and reports a misleading generic 404 instead. This exact bug existed in this scaffold and was only caught by an E2E test noticing a 404 where a 401 was expected; see `IMPLEMENTATION.md` Phase 6 for the full story. If a 404-shaped bug reappears somewhere, check this first.

## 9. Tests — TDD, not an afterthought

**Write the failing test before the implementation. Every module in this repo was built this way — verify it in the git history / `IMPLEMENTATION.md` if in doubt, and keep doing it for new code.**

Three layers, all real (mock only at the repo boundary, never mock Prisma itself):

1. **Pure logic** (no DB, no HTTP) — `refresh-token.ts`, `pagination.ts`, `permission-cache.ts` (fake timers via `vi.useFakeTimers()`), `jwt.ts` (real `jose` calls, no network), and every `*.service.test.ts` (stub the repo interface with `vi.fn()`).
2. **Repo/integration** (real Postgres) — every `*.repo.test.ts` goes through `withTenantContext`/`withTenantContextReadOnly` against the real test database and explicitly asserts RLS isolation (create data under tenant A, assert tenant B's query sees none of it). This is the layer that actually proves RLS works — never mock it away.
3. **HTTP/E2E** (Supertest, real DB) — `*.router.test.ts` builds a minimal Express app mounting just the router under test (plus `express.json()`, `cookie-parser()`, `errorHandler`), and asserts on real HTTP responses: status codes, cookie behavior, permission-denied paths. See `tests/helpers/e2e-auth.ts` for the shared `registerOwner()` / `loginAsSeededRole()` helpers — use them instead of re-deriving tenant/role/login setup in every new E2E suite.

**Test database:** `.env.test` points at a dedicated `multitenant_test` database (never dev or prod). `tests/setup.ts` loads it before anything imports `src/config/env.ts`. Tests that need multiple tenants create them with unique slugs per test (`` `acme-${randomUUID()}` ``) rather than truncating tables between tests — this is what lets RLS-isolation assertions coexist cleanly with parallel/sequential test runs.

**Coverage bar:** `vitest.config.ts`'s 70% thresholds are the floor. Auth/RBAC code should read closer to 90%+ in practice — it's the code where a missed branch is a security bug, not a UX bug.

- Don't `import { jest }` — Vitest has its own (`import { vi } from 'vitest'`).

## 10. Common commands

```bash
pnpm dev                  # tsx watch, hot reload
pnpm test                 # vitest run
pnpm test:watch           # vitest in watch mode
pnpm typecheck            # tsc --noEmit (run before claiming "done")
pnpm lint                 # eslint, no warnings allowed
pnpm format               # prettier --write
pnpm build                # compile to dist/
pnpm start                # run the built output

pnpm db:up                # start postgres in docker
pnpm db:down              # stop
pnpm db:logs              # tail postgres logs
pnpm db:reset             # WIPE and re-init (dev only)
pnpm db:generate          # prisma generate
pnpm db:migrate           # prisma migrate deploy (CI/prod)
pnpm db:migrate:dev       # prisma migrate dev (local — creates + applies)
pnpm db:seed              # idempotent seed (2 demo tenants, Password123!)
pnpm db:sync-permissions  # upsert PERMISSION_REGISTRY into the DB standalone
pnpm db:studio            # prisma studio
```

After any non-trivial change, run `pnpm typecheck && pnpm lint && pnpm test` before declaring success.

## 11. Footguns — DO NOT do any of these

1. **Do not use `adminPrisma` inside a request handler**, except the two documented exceptions in §3. If you think you need a third, you probably don't — ask first.
2. **Do not query `prisma` outside of `withTenantContext()`.** It works (no error) but RLS will return zero rows because the GUC isn't set, and a future maintainer will think the data is missing.
3. **Do not use `SET app.current_tenant_id` (without `LOCAL`/transaction-scoping).** That sets it for the *session*, which leaks across pooled connections. `set_config(name, value, true)` is what makes this safe — don't "simplify" it away.
4. **Do not interpolate the tenant id into a raw SQL string.** Use Prisma's tagged-template `$executeRaw`/`$queryRaw` (already done in `withTenantContext`) — the interpolation IS the parameterization, not string concatenation, even though it reads like one.
5. **Do not add a tenant-scoped table without an RLS policy in the migration.** A table without RLS is a table with no isolation. The two-role pattern alone doesn't help — `app_user` has table-level grants.
6. **Do not create indexes that don't lead with `tenant_id`** on tenant-scoped tables.
7. **Do not use a bare-column unique constraint (e.g. `email`) on a per-tenant table.** Use `@@unique([tenantId, email])`. Two tenants must be able to have a `bob@example.com` — this is exactly why login needs a `tenantSlug` (see `PLAN.md`'s auth module design note).
8. **Do not put the JWT secret or DB URL in code.** They come from `env`. The validator in `src/config/env.ts` refuses to boot without them.
9. **Do not catch errors silently.** If you catch, either re-throw, throw a typed `AppError`, or log at the appropriate level.
10. **Do not use `any`.** ESLint will fail. If you genuinely need an escape hatch, use `unknown` and narrow.
11. **Do not edit migrations after they've been applied** to any environment. Add a new migration instead. Prisma tracks applied migrations in `_prisma_migrations`.
12. **Do not use `console.log`.** Use `logger`. ESLint enforces this.
13. **Do not give a 404 handler 4 declared parameters.** See §8 — this makes Express treat it as an error handler, and it will swallow real errors.

## 12. When in doubt

- If a behavior would surprise a security-conscious code reviewer, write a comment explaining why it's safe — or change the approach.
- If you can't tell whether a query needs `withTenantContext()`, the answer is yes.
- If you're about to add a config option, ask whether it should be in `.env.example` and `src/config/env.ts`. The answer is almost always yes.
- If a test would require disabling RLS to pass, the test is wrong, not RLS.
- If you're adding a module, update `PLAN.md`'s module table and `IMPLEMENTATION.md`'s phase log — future sessions (yours or someone else's) rely on both being current, not just the code.

---

**TL;DR for any change:**
1. Read the schema rules in §4 before touching `prisma/schema.prisma`.
2. Use `withTenantContext()` in every repo function. No exceptions besides the two in §3.
3. Hand-edit the generated migration SQL to add `ENABLE RLS` + `FORCE RLS` + policy + grants for any new tenant-scoped table.
4. Write the failing test first (§9).
5. Run `pnpm typecheck && pnpm lint && pnpm test` before saying you're done.
