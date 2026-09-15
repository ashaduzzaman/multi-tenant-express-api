# multitenant-api

Multi-tenant SaaS API **starter kit**. Express 5 + TypeScript + PostgreSQL with **Row Level Security** for tenant isolation, built TDD-first with Prisma.

Ships with three working modules, not just a scaffold: **auth** (register/login/refresh/logout/me, cookie-based with refresh rotation), **roles** (tenant-scoped custom roles + a granular permission catalog), and **users** (CRUD, soft delete).

> **For Claude Code:** read [`CLAUDE.md`](./CLAUDE.md) before writing any feature code — it defines the architectural rules that make multi-tenancy safe. Also read [`PLAN.md`](./PLAN.md) (design decisions), [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) (build log), and [`MODULES.md`](./MODULES.md) (what's shipped vs. not, across the full set of modules a multi-tenant SaaS needs) — they're living documents, not one-time planning artifacts. If your task also touches the admin dashboard frontend, start at [`../INDEX.md`](../INDEX.md) instead.

## Quickstart

```bash
# 1. Install
pnpm install

# 2. Configure
cp .env.example .env
# generate a JWT secret:
node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))"
# paste it into .env as JWT_SECRET

# 3. Start postgres
pnpm db:up

# 4. Migrate + sync the permission catalog + seed demo tenants
pnpm db:migrate
pnpm db:sync-permissions
pnpm db:seed

# 5. Run
pnpm dev
```

App listens on http://localhost:3000.

| Endpoint                            | Purpose                                              |
| ----------------------------------- | ---------------------------------------------------- |
| `GET /healthz`                      | Liveness — process is up                             |
| `GET /readyz`                       | Readiness — DB reachable, RLS context works          |
| `POST /api/v1/auth/register`        | Create a tenant + Owner user                         |
| `POST /api/v1/auth/login`           | `{ tenantSlug, email, password }` → sets cookies     |
| `POST /api/v1/auth/refresh`         | Rotates the refresh cookie                           |
| `POST /api/v1/auth/logout`          | Clears cookies, revokes the refresh token            |
| `GET /api/v1/auth/me`               | Current user + permissions                           |
| `GET/POST/PUT/DELETE /api/v1/roles` | Tenant-scoped custom roles                           |
| `GET /api/v1/roles/permissions`     | The permission catalog                               |
| `GET/POST/PUT/DELETE /api/v1/users` | User CRUD (`PUT /:id/password` for password changes) |

Try it once the server is up:

```bash
curl -c cookies.txt -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"tenantName":"Acme","tenantSlug":"acme","email":"owner@acme.test","password":"correct-horse-battery","name":"Owner"}'
curl -b cookies.txt http://localhost:3000/api/v1/auth/me
```

## Architecture in one paragraph

Single Postgres database. Every tenant-scoped table has a `tenant_id UUID` column and an RLS policy that filters on `current_setting('app.current_tenant_id')`. The app connects as the `app_user` role (which **cannot** bypass RLS — checked at role creation), and each request opens a Prisma interactive transaction that sets the tenant GUC via `set_config()` before any query runs. If a query is missing a `WHERE tenant_id =` clause, Postgres still returns only the current tenant's rows. If the tenant GUC isn't set at all, queries return zero rows. Defense in depth at the database layer.

Migrations and tenant provisioning use a separate `app_admin` connection that bypasses RLS. The two Prisma clients are exported as `prisma` (request-scoped) and `adminPrisma` (system-scoped) from `src/db/client.ts` to make code review obvious. RBAC layers on top: a global, code-defined permission catalog (`src/config/permissions.ts`) plus tenant-scoped `roles` / `role_permissions` tables, with a 5-minute in-memory cache in front of the permission lookup.

## Common commands

```bash
pnpm dev                  # hot-reload server
pnpm test                 # vitest run
pnpm typecheck            # tsc --noEmit
pnpm lint                 # eslint
pnpm format               # prettier --write

pnpm db:up                # start postgres in docker
pnpm db:down              # stop
pnpm db:logs              # tail postgres logs
pnpm db:reset             # WIPE + re-init + migrate + seed (dev only)
pnpm db:generate          # prisma generate
pnpm db:migrate           # prisma migrate deploy
pnpm db:migrate:dev       # prisma migrate dev (local)
pnpm db:seed              # seed Acme + Globex tenants (Password123!)
pnpm db:sync-permissions  # upsert the permission catalog standalone
pnpm db:studio            # open Prisma Studio in browser
```

## Project layout

```
.
├── CLAUDE.md                     ← read this first
├── PLAN.md                       ← design decisions & why
├── IMPLEMENTATION.md             ← phase-by-phase build log
├── docker-compose.yml            ← postgres + optional pgadmin
├── Dockerfile                    ← prod build, multi-stage, non-root
├── db/init/                      ← runs ONCE on fresh postgres volume
│   ├── 01-extensions.sql
│   ├── 02-roles.sql               ← creates app_user (RLS applies)
│   └── 03-tenant-context.sql
├── prisma/
│   ├── schema.prisma              ← Tenant/User/Permission/Role/RolePermission/RefreshToken
│   └── migrations/                ← hand-edited for RLS; commit these
├── src/
│   ├── index.ts                   ← entry: sync permissions → listen → graceful shutdown
│   ├── app.ts                     ← express factory, mounts all module routers
│   ├── config/
│   │   ├── env.ts                 ← Zod-validated env (fails fast)
│   │   └── permissions.ts         ← PERMISSION_REGISTRY, DEFAULT_ROLE_PERMISSIONS
│   ├── db/
│   │   ├── client.ts              ← prisma (app_user) + adminPrisma (admin)
│   │   └── tenant-context.ts      ← withTenantContext() — THE core helper
│   ├── middleware/
│   │   ├── auth.ts                ← cookie/Bearer JWT verification
│   │   ├── permissions.ts         ← loadPermissions, requirePermission(s), requireSelfOrPermission
│   │   ├── tenant-context.ts      ← copies tid from JWT to req
│   │   ├── error-handler.ts       ← AppError → JSON
│   │   └── request-logger.ts      ← Pino HTTP + request ID
│   ├── modules/
│   │   ├── auth/                  ← register/login/refresh/logout/me
│   │   ├── roles/                 ← tenant-scoped custom roles
│   │   └── users/                 ← user CRUD
│   ├── lib/
│   │   ├── logger.ts, errors.ts, async-handler.ts, pagination.ts
│   │   ├── jwt.ts                 ← sign/verify access tokens
│   │   ├── refresh-token.ts       ← generate/hash refresh tokens
│   │   ├── permission-cache.ts    ← TTL cache keyed by tenantId:roleId
│   │   └── sync-permissions.ts    ← idempotent catalog upsert
│   └── types/express.d.ts         ← req.auth + req.tenantId
├── scripts/
│   ├── seed.ts, sync-permissions.ts, db-reset.sh
└── tests/
    └── helpers/e2e-auth.ts        ← shared registerOwner()/loginAsSeededRole() for E2E suites
```

## Production notes

- Never use the postgres superuser from app code. The `app_user` role exists for this — see `CLAUDE.md` §3 for the two narrow, documented exceptions.
- Behind a load balancer, `trust proxy` is enabled in production so rate-limit + IP logging work.
- `Dockerfile` builds a non-root, prod-only image. Pass env vars via the orchestrator (don't bake `.env` in).
- For PgBouncer in transaction mode: this codebase is compatible because tenant context is set inside a transaction, scoped with `set_config(..., true)`.
- Cookies are `secure`/`sameSite: 'none'` only in production; `lax`/insecure in dev so local HTTP testing works.
