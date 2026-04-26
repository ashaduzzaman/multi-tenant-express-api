# multitenant-api

Multi-tenant SaaS API scaffold. Express 5 + TypeScript + PostgreSQL with **Row Level Security** for tenant isolation.

> **For Claude Code:** read [`CLAUDE.md`](./CLAUDE.md) before writing any feature code. It defines the architectural rules that make multi-tenancy safe.

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

# 4. Migrate + seed
pnpm db:migrate
pnpm db:seed

# 5. Run
pnpm dev
```

App listens on http://localhost:3000.

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | Liveness — process is up |
| `GET /readyz` | Readiness — DB reachable, RLS context works |

## Architecture in one paragraph

Single Postgres database. Every tenant-scoped table has a `tenant_id UUID` column and an RLS policy that filters on `current_setting('app.current_tenant_id')`. The app connects as the `app_user` role (which **cannot** bypass RLS — checked at role creation), and each request opens a transaction that sets the tenant GUC via `set_config()` before any query runs. If a query is missing a `WHERE tenant_id =` clause, Postgres still returns only the current tenant's rows. If the tenant GUC isn't set at all, queries return zero rows. Defense in depth at the database layer.

Migrations and tenant provisioning use a separate `app_admin` connection that bypasses RLS. The two pools are exported as `db` (request-scoped) and `adminDb` (system-scoped) to make code review obvious.

## Common commands

```bash
pnpm dev              # hot-reload server
pnpm test             # vitest run
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
pnpm format           # prettier --write

pnpm db:up            # start postgres in docker
pnpm db:down          # stop
pnpm db:logs          # tail postgres logs
pnpm db:reset         # WIPE + re-init + migrate + seed (dev only)
pnpm db:generate      # generate migration from schema diff
pnpm db:migrate       # apply pending migrations
pnpm db:seed          # seed Acme + Globex tenants
pnpm db:studio        # open Drizzle Studio in browser
```

## Project layout

```
.
├── CLAUDE.md                     ← read this first
├── docker-compose.yml            ← postgres + optional pgadmin
├── Dockerfile                    ← prod build, multi-stage, non-root
├── db/
│   ├── init/                     ← runs ONCE on fresh postgres volume
│   │   ├── 01-extensions.sql
│   │   ├── 02-roles.sql          ← creates app_user (RLS applies)
│   │   └── 03-tenant-context.sql
│   └── migrations/               ← drizzle-kit generated; commit these
├── src/
│   ├── index.ts                  ← entry + graceful shutdown
│   ├── app.ts                    ← express factory
│   ├── config/env.ts             ← Zod-validated env (fails fast)
│   ├── db/
│   │   ├── index.ts              ← appPool + adminPool
│   │   ├── schema.ts             ← Drizzle tables (tenants, users)
│   │   └── tenant-context.ts     ← withTenantContext() — THE core helper
│   ├── middleware/
│   │   ├── auth.ts               ← JWT verification + role gate
│   │   ├── tenant-context.ts     ← copies tid from JWT to req
│   │   ├── error-handler.ts      ← AppError → JSON
│   │   └── request-logger.ts     ← Pino HTTP + request ID
│   ├── modules/                  ← feature modules go here
│   ├── lib/
│   │   ├── logger.ts             ← Pino instance
│   │   ├── errors.ts             ← typed AppError hierarchy
│   │   └── async-handler.ts
│   └── types/express.d.ts        ← req.auth + req.tenantId
├── scripts/
│   ├── migrate.ts                ← runs drizzle migrations
│   ├── seed.ts                   ← idempotent seed
│   └── db-reset.sh
└── tests/
```

## Production notes

- Never use the postgres superuser from app code. The `app_user` role exists for this.
- Behind a load balancer, `trust proxy` is enabled in production so rate-limit + IP logging work.
- `Dockerfile` builds a non-root, prod-only image. Pass env vars via the orchestrator (don't bake `.env` in).
- For PgBouncer in transaction mode: this codebase is compatible because we use `SET LOCAL` inside transactions.
