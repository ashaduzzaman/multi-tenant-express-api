# CLAUDE.md

> **Read this file in full before writing any code in this repo.**
> It encodes architectural rules that, if violated, cause cross-tenant data leaks, RLS bypasses, or migration corruption. None of these failures are obvious in PR review unless you know what you're looking for.

---

## 1. What this project is

A multi-tenant SaaS API. **Single PostgreSQL database, single schema, `tenant_id` discriminator column on every tenant-scoped table, Postgres Row Level Security (RLS) enforces isolation at the database layer.**

The whole point of this architecture is that tenant isolation does **not** depend on the application remembering to add `WHERE tenant_id = ?` to every query. The database refuses to return rows for any tenant other than the one in the current transaction's GUC, even if the application code is buggy. This is the safety net. Don't bypass it.

## 2. Tech stack (locked)

- **Runtime:** Node.js 22 (see `.nvmrc`)
- **Package manager:** pnpm 9
- **Language:** TypeScript 5.7, strict mode, ESM (`"type": "module"`), NodeNext resolution
- **HTTP:** Express 5
- **DB driver:** `pg` 8 (node-postgres)
- **ORM / migrations:** Drizzle ORM + Drizzle Kit
- **Validation:** Zod (at every boundary — env, request bodies, JWT claims)
- **Auth:** JWT via `jose`, password hashing via `bcrypt`
- **Logging:** Pino (structured JSON in prod, pino-pretty in dev)
- **Testing:** Vitest
- **Lint/format:** ESLint 9 (flat config, type-checked rules) + Prettier

Don't swap any of these without an explicit instruction from the user. In particular: **do not switch to Prisma, TypeORM, Sequelize, or Knex.** Drizzle is the choice because it gives type-safe queries while staying close enough to SQL that RLS policies, materialized views, and `set_config()` calls are first-class.

## 3. The multi-tenant security model — non-negotiable

There are **two database roles** with **two separate connection pools**:

| Role | Pool export | RLS behavior | Allowed uses |
|---|---|---|---|
| `app_user` | `db` / `appPool` | **Enforces RLS** | All request-scoped queries. Always via `withTenantContext()`. |
| superuser (`postgres` / `app_admin`) | `adminDb` / `adminPool` | **Bypasses RLS** | Migrations. Tenant provisioning. System maintenance. **Never request-scoped.** |

If you find yourself reaching for `adminDb` inside a request handler, **stop**. You are about to write a cross-tenant data leak. The only correct answers in a request handler are:

1. Use `withTenantContext(req.tenantId, async (tx) => ...)` for tenant-scoped queries
2. If you genuinely need a cross-tenant operation (rare — e.g., a SaaS admin panel), make it a separate module gated behind a different auth check, and document why in a code comment

### How `withTenantContext()` works

```ts
import { withTenantContext } from '#/db/tenant-context.js';
import { users } from '#/db/schema.js';

const list = await withTenantContext(tenantId, async (tx) => {
  return tx.select().from(users); // RLS filters automatically
});
```

What happens internally:

1. Acquires a dedicated client from `appPool`
2. `BEGIN` transaction
3. `SELECT set_config('app.current_tenant_id', $1, true)` — the `true` means *transaction-local*, so it's cleared on COMMIT/ROLLBACK
4. Runs your callback with a Drizzle instance bound to that client
5. `COMMIT` (or `ROLLBACK` on throw) and release the client back to the pool

Because the GUC is transaction-scoped, **pooled connections are safe** — there is no way for tenant A's context to leak into tenant B's next query, even with PgBouncer in transaction mode.

For read-only requests (GET handlers) prefer `withTenantContextReadOnly()` — same isolation, but the transaction is `READ ONLY` so accidental writes are rejected by the database.

## 4. Database conventions — every new table follows these

When adding a table to `src/db/schema.ts`:

1. **Tenant column.** Every tenant-scoped table MUST have:
   ```ts
   tenantId: uuid('tenant_id')
     .notNull()
     .references(() => tenants.id, { onDelete: 'cascade' }),
   ```
   No nullable `tenant_id`. No `text` instead of `uuid`. No skipping the FK.

2. **Tenant-leading indexes.** Every index on a tenant-scoped table must lead with `tenantId`. Postgres can use a `(tenant_id, created_at)` index for queries scoped by tenant *and* for queries scoped by tenant ordered by created_at, but a `(created_at)` index is useless when you also filter by tenant.
   ```ts
   index('idx_orders_tenant_created').on(t.tenantId, t.createdAt)
   ```
   Same rule for unique constraints — `unique(tenant_id, slug)`, never `unique(slug)`.

3. **RLS policy.** In the SAME migration that creates the table, add the RLS enable + policy. Drizzle Kit generates schema migrations but **does NOT generate RLS policies** — you must edit the generated SQL to append them. Template:

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
   - The `GRANT` is needed because `app_user` is not the table owner. Default privileges (set in `db/init/02-roles.sql`) cover most cases, but stating it explicitly in the migration is clearer.

4. **Soft delete (optional).** If the table needs soft delete, add `deletedAt: timestamp('deleted_at', { withTimezone: true })` and have the repo filter `WHERE deleted_at IS NULL` by default. RLS does not handle soft delete — that's an application concern.

5. **Timestamps.** Always include:
   ```ts
   createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
   updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
   ```

### Migration workflow

```bash
# 1. Edit src/db/schema.ts
# 2. Generate the diff
pnpm db:generate
# 3. EDIT the generated SQL file in db/migrations/ to append RLS policies and grants
# 4. Apply
pnpm db:migrate
```

Step 3 is mandatory and easy to forget. **Never apply a migration that adds a tenant-scoped table without RLS.** Treat the generated `.sql` file as a starting point, not the finished product.

## 5. Adding a new feature module

Layout under `src/modules/<feature>/`:

```
<feature>.router.ts      ← Express router, mounts middleware
<feature>.handlers.ts    ← Thin HTTP handlers
<feature>.service.ts     ← Business logic
<feature>.repo.ts        ← Drizzle queries via withTenantContext
<feature>.schema.ts      ← Zod schemas
<feature>.test.ts        ← Vitest
```

### Layer rules

- **Handler** parses input with Zod, calls service, sends response. No DB access. No business logic.
- **Service** orchestrates. Calls repo. Enforces invariants. No HTTP types.
- **Repo** is the only layer that imports from `#/db/`. Every function takes `tenantId: string` as its first parameter and wraps Drizzle in `withTenantContext()`.
- **Schema** lives in its own file so it can be reused by tests and OpenAPI generators.

### Copy-paste template — projects module

`src/modules/projects/projects.schema.ts`:
```ts
import { z } from 'zod';

export const createProjectInput = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInput>;
```

`src/modules/projects/projects.repo.ts`:
```ts
import { eq } from 'drizzle-orm';
import { withTenantContext, withTenantContextReadOnly } from '#/db/tenant-context.js';
import { projects } from '#/db/schema.js';
import type { CreateProjectInput } from './projects.schema.js';

export async function listProjects(tenantId: string) {
  return withTenantContextReadOnly(tenantId, (tx) =>
    tx.select().from(projects).orderBy(projects.createdAt),
  );
}

export async function createProject(
  tenantId: string,
  userId: string,
  input: CreateProjectInput,
) {
  return withTenantContext(tenantId, async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({ tenantId, createdBy: userId, ...input })
      .returning();
    return row;
  });
}
```

`src/modules/projects/projects.service.ts`:
```ts
import { NotFoundError } from '#/lib/errors.js';
import * as repo from './projects.repo.js';
import type { CreateProjectInput } from './projects.schema.js';

export async function listProjects(tenantId: string) {
  return repo.listProjects(tenantId);
}

export async function createProject(
  tenantId: string,
  userId: string,
  input: CreateProjectInput,
) {
  const created = await repo.createProject(tenantId, userId, input);
  if (!created) throw new NotFoundError('Project creation returned no row');
  return created;
}
```

`src/modules/projects/projects.handlers.ts`:
```ts
import type { Request, Response } from 'express';
import { asyncHandler } from '#/lib/async-handler.js';
import { requireTenantId } from '#/middleware/tenant-context.js';
import { UnauthorizedError } from '#/lib/errors.js';
import { createProjectInput } from './projects.schema.js';
import * as service from './projects.service.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireTenantId(req);
  res.json({ data: await service.listProjects(tenantId) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireTenantId(req);
  const userId = req.auth?.userId;
  if (!userId) throw new UnauthorizedError();
  const input = createProjectInput.parse(req.body);
  const project = await service.createProject(tenantId, userId, input);
  res.status(201).json({ data: project });
});
```

`src/modules/projects/projects.router.ts`:
```ts
import { Router } from 'express';
import { authMiddleware, requireRole } from '#/middleware/auth.js';
import { tenantContextMiddleware } from '#/middleware/tenant-context.js';
import * as h from './projects.handlers.js';

const router = Router();
router.use(authMiddleware, tenantContextMiddleware);

router.get('/', h.list);
router.post('/', requireRole('owner', 'admin'), h.create);

export { router as projectsRouter };
```

Then mount in `src/app.ts`:
```ts
import { projectsRouter } from '#/modules/projects/projects.router.js';
app.use('/api/v1/projects', projectsRouter);
```

## 6. Validation rules

- **At every boundary, Zod-validate.** Env vars at boot. Request bodies in handlers. JWT claims after `jwtVerify`. Never trust `req.body` directly.
- Use `.parse()` (throws ZodError → 422 via the global error handler) rather than `.safeParse()` unless you specifically need to handle invalid input non-fatally.
- Define schemas once in `<feature>.schema.ts` and infer TS types via `z.infer<typeof schema>`. Don't duplicate types.

## 7. Errors

Throw a typed `AppError` subclass (`BadRequestError`, `NotFoundError`, `ConflictError`, `UnauthorizedError`, `ForbiddenError`, `ValidationError`) for anything the user did wrong or any known business condition. The global error handler turns these into clean JSON with the right status code.

For unexpected errors, throw a plain `Error` (or let it bubble). The handler logs it as `error` level and returns a 500 with no internals exposed.

**Never** put user input or row data into the `message` field — it ends up in logs and gets emailed to whoever's on call. Put it in `details` instead, where the Pino redaction config can scrub it.

## 8. Logging

- Always use the exported `logger` from `#/lib/logger.js`. Never `console.log`. (ESLint will fail your build.)
- Log structured: `logger.info({ tenantId, userId }, 'created project')`, not `logger.info(\`created project for ${tenantId}\`)`.
- Sensitive fields (`password`, `passwordHash`, `token`, `secret`, `authorization`, `cookie`) are auto-redacted by the Pino config. If you add a new sensitive field name, update the redact paths.

## 9. Tests

- Vitest. Files end in `.test.ts`, can live next to source or under `tests/`.
- Mock the repo, not the pool. Service tests should not touch the DB.
- Repo tests can hit a real DB — run them with `withTenantContext()` against a known seeded tenant id and assert isolation by also querying with a different tenant id.
- Don't `import { jest }` — Vitest has its own (`import { vi } from 'vitest'`).

## 10. Common commands

```bash
pnpm dev              # tsx watch, hot reload
pnpm test             # vitest run
pnpm test:watch       # vitest in watch mode
pnpm typecheck        # tsc --noEmit (run before claiming "done")
pnpm lint             # eslint, no warnings allowed
pnpm format           # prettier --write
pnpm build            # compile to dist/
pnpm start            # run the built output

pnpm db:up            # start postgres in docker
pnpm db:down          # stop
pnpm db:logs          # tail postgres logs
pnpm db:reset         # WIPE and re-init (dev only)
pnpm db:generate      # generate migration from schema diff
pnpm db:migrate       # apply pending migrations
pnpm db:seed          # idempotent seed
pnpm db:studio        # browse data via drizzle studio
```

After any non-trivial change, run `pnpm typecheck && pnpm lint && pnpm test` before declaring success.

## 11. Footguns — DO NOT do any of these

1. **Do not use `adminDb` / `adminPool` inside a request handler.** Ever. If you think you need to, you don't.
2. **Do not query the app pool outside of `withTenantContext()`.** It works (no error) but RLS will return zero rows because the GUC isn't set, and a future maintainer will think the data is missing.
3. **Do not use `SET app.current_tenant_id` (without `LOCAL`).** That sets it for the *session*, which leaks across pooled connections. We use `set_config(name, value, true)` precisely to avoid this.
4. **Do not interpolate the tenant id into SQL strings.** Use the parameterized `set_config()` call (already done in `withTenantContext`). The tenant id is from a verified JWT, but defense in depth.
5. **Do not add a tenant-scoped table without an RLS policy in the migration.** A table without RLS is a table with no isolation. The two-role pattern alone doesn't help — `app_user` has table-level grants.
6. **Do not create indexes that don't lead with `tenant_id`** on tenant-scoped tables. They won't be used by the planner once data grows.
7. **Do not use `unique(email)` on a per-tenant table.** Use `unique(tenant_id, email)`. Two tenants must be able to have a `bob@example.com`.
8. **Do not put the JWT secret or DB URL in code.** They come from `env`. The validator in `src/config/env.ts` will refuse to boot without them.
9. **Do not catch errors silently.** If you catch, either re-throw, throw a typed `AppError`, or log at the appropriate level. Swallowed errors are how cross-tenant bugs hide.
10. **Do not use `any`.** ESLint will fail. If you genuinely need an escape hatch, use `unknown` and narrow.
11. **Do not edit migrations after they've been applied** to any environment. Add a new migration instead. Drizzle tracks applied migrations in `__drizzle_migrations`.
12. **Do not use `console.log`.** Use `logger`. ESLint enforces this.

## 12. When in doubt

- If a behavior would surprise a security-conscious code reviewer, write a comment explaining why it's safe — or change the approach.
- If you can't tell whether a query needs `withTenantContext()`, the answer is yes.
- If you're about to add a config option, ask whether it should be in `.env.example` and `src/config/env.ts`. The answer is almost always yes.
- If a test would require disabling RLS to pass, the test is wrong, not RLS.

---

**TL;DR for any change:**
1. Read the schema rules in section 4 before touching `src/db/schema.ts`.
2. Use `withTenantContext()` in every repo function. No exceptions.
3. Edit the generated migration SQL to add `ENABLE RLS` + `FORCE RLS` + policy + grants for any new tenant-scoped table.
4. Run `pnpm typecheck && pnpm lint && pnpm test` before saying you're done.
