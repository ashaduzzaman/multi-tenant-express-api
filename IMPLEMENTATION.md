# IMPLEMENTATION.md — Live progress log

> Companion to `PLAN.md`. Updated after every completed step, in order.
> Status legend: `[ ]` pending, `[~]` in progress, `[x]` done, `[!]` blocked/deviation (explained inline).

## Local dev/test environment note

No Docker available in the build environment used for this pass. A throwaway
local Postgres 18 cluster was initialized instead (separate from any existing
local Postgres install) on **port 5433**, trust-auth, purely for running the
TDD loop and verifying migrations during this session:

- `multitenant_dev` and `multitenant_test` databases created
- extensions (`uuid-ossp`, `pgcrypto`, `citext`, `pg_trgm`) enabled on both
- `app_user` role created on both, matching `db/init/02-roles.sql`

This does not replace `docker-compose.yml`, which remains the documented dev
path for anyone else using this template. `.env` for this session points at
port 5433.

## CI/CD — required before any NEW phase or feature branch (added retroactively)

**Not numbered as a phase on purpose — it doesn't belong in the historical
sequence below, it gates everything after it.** Phases 1–11 below already
happened before the three-tier `feature/* → dev → staging → main` branch
model and its CI gate existed as a policy — that history isn't rewritten.
But **no new feature branch or PR happens until this is done**: every PR
(feature→dev, dev→staging, staging→main) must be gated by CI from here on.
See `PLAN.md` §16 for the design.

Expanded significantly past the original plan after the user reviewed the first draft and asked for the fuller foundation+dev+staging tier described in `PLAN.md` §16 before merging. All action versions below were verified against the GitHub API at implementation time (`actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`, `gitleaks/gitleaks-action@v3`, `docker/build-push-action@v7`, `docker/login-action@v4`, `docker/metadata-action@v6`, `aquasecurity/trivy-action@v0.36.0`), not assumed.

`.github/workflows/ci.yml` — `pull_request` → `[dev, staging, main]`, `concurrency` with `cancel-in-progress`:

- [x] `lint-and-format` job: `pnpm lint` + `pnpm format:check` (no DB)
- [x] `typecheck` job (no DB)
- [x] `build` job (no DB)
- [x] `prisma-schema` job: `prisma validate` + `prisma format --check` (no DB — verified locally these only need `DATABASE_ADMIN_URL` to resolve to _something_ URL-shaped, never an actual connection)
- [x] `secret-scan` job: gitleaks v3 (personal-account repo, no license key needed — confirmed via gitleaks-action's own docs)
- [x] `dependency-audit` job: `pnpm audit --audit-level=high`, non-blocking on `dev`, blocking on `staging`/`main` (`continue-on-error: ${{ github.base_ref == 'dev' }}`)
- [x] `test` job: Postgres service container, `db/init/*.sql` equivalent (roles + extensions, applied via `psql` since the GitHub-managed service doesn't run docker-volume init scripts), **migration drift check** (`prisma migrate diff --exit-code`, verified locally both for a clean pass and for correctly catching an intentionally-introduced drift), `prisma migrate deploy`, then `pnpm test:coverage`

`.github/workflows/docker.yml` — `push` to `[staging, main]` only (not every PR — would spam the registry for unmerged commits):

- [x] Build → Trivy scan (CRITICAL/HIGH, fails the job) → upload SARIF to the Security tab → push to GHCR **only if the scan passed** (image is built+scanned before the push step ever runs)

- [x] **Verified against a real PR: first run surfaced the `pnpm-workspace.yaml` bug above** (6/7 checks failed), fixed.
- [x] **Second real run surfaced a second bug: the `test` job never ran `prisma generate`**, unlike every other job. `prisma migrate deploy` only applies migrations — it does not generate the client, unlike `migrate dev`. Result: `Cannot find module '.prisma/client/default'`, 13/23 test files failing. Reproduced locally first (deleted the generated client, confirmed the exact same error), then confirmed `npx prisma generate` fixes it and the full suite goes back to 172/172. Added the missing step.
- [ ] Re-run not yet observed from here after this second fix — check it actually goes green before trusting the gate.
- [ ] `docker.yml` specifically still unverified — needs an actual push to `staging`/`main`, which hasn't happened yet.
- [ ] Tell the user to mark the CI jobs as required status checks on `dev`, `staging`, and `main` in GitHub repo settings — **immediate next step once this PR merges**
- [x] **Confirmed with the user (2026-09-15): hosting not decided yet — `deploy-dev.yml`/`deploy-staging.yml`/`deploy-prod.yml` stay unbuilt for now.** Not a gap: everything built today (CI gates, Docker build+Trivy-scan+push to GHCR) stands on its own — the eventual deploy step just picks up the already-published, already-scanned image. Revisit once a hosting target is chosen; don't re-litigate the "why wasn't this built" question, it's answered here.
- [ ] Playwright E2E — still deferred, unrelated to the hosting question: nothing to meaningfully test until the frontend has a real login flow (its Phase 3).

## Phase 0 — Planning

- [x] Read both repos, produced initial Drizzle-based reuse plan
- [x] Clarified auth transport / RBAC depth / module scope with user
- [x] User changed direction: Prisma instead of Drizzle, TDD, two brain files, implement in one pass
- [x] `PLAN.md` written
- [x] `IMPLEMENTATION.md` written (this file)

## Phase 1 — Prisma swap

- [x] Remove `drizzle-orm`, `drizzle-kit`, `drizzle.config.ts`, `src/db/schema.ts` (Drizzle version)
- [x] Add `prisma`, `@prisma/client` (also added `cookie-parser`, `supertest` — needed by Phase 5/6/10+)
- [x] `prisma/schema.prisma` — full model set written in one pass (see deviation note below)
- [x] `src/db/client.ts` — `prisma` (app_user) + `adminPrisma` (admin) two-client setup
- [x] `src/db/tenant-context.ts` — `withTenantContext` / `withTenantContextReadOnly` / `pingTenantContext` reimplemented on Prisma interactive transactions
- [x] Test: `src/db/tenant-context.test.ts` — written FIRST (red: file didn't exist), then implementation made it green. 8/8 passing, proves RLS isolation actually works through Prisma.
- [x] `package.json` scripts updated (`db:generate`, `db:migrate`, `db:migrate:dev`, `db:studio`, `db:sync-permissions`)
- [x] `.env` / `.env.example` / `.env.test` created; `.gitignore` added (none existed before)

## Phase 2 — Schema: RBAC + refresh tokens

- [x] `prisma/schema.prisma`: Permission, Role, RolePermission, RefreshToken, `User.roleId` — done together with Phase 1's schema, see deviation note
- [x] `prisma migrate dev --create-only`, hand-edited migration.sql to append RLS (tenants/users/roles/role_permissions/refresh_tokens) + grants (incl. read-only grant on the global `permissions` catalog)
- [x] Applied migration to both `multitenant_dev` and `multitenant_test`
- [x] `npx prisma generate` run successfully

## Phase 3 — Permission catalog

- [x] `src/config/permissions.ts` (starter registry: users:_, roles:_) + `DEFAULT_ROLE_PERMISSIONS` (Owner/Admin/Member) + tests (6 passing)
- [x] `src/lib/sync-permissions.ts` (testable upsert function, admin-client injected) + `scripts/sync-permissions.ts` (CLI runner)
- [x] Test: idempotency + update-in-place verified (3 passing, real DB)
- [!] Found & fixed a real bug during TDD: a JSDoc comment containing the literal substring `*/` inside a file path closed the comment early and broke esbuild parsing. Fixed by rewording. (Caught immediately by the RED step, exactly the kind of thing TDD is for.)

## Phase 4 — Lib utilities (TDD)

- [x] `src/lib/refresh-token.ts` + test (5 passing)
- [x] `src/lib/pagination.ts` + test (7 passing)
- [x] `src/lib/permission-cache.ts` + test (6 passing, fake timers). Cache keyed by `tenantId:roleId`; DB fetch injected as a callback so the cache itself has zero DB/framework dependency.
- [!] Found & fixed a real bug during TDD: original `parseInt(x,10) || default` pattern (ported from RIS-app-api's `pagination.ts`, which has the same bug) treats an explicit `pageSize=0` the same as "not provided" and silently returns 20 instead of clamping to 1. Fixed with explicit `Number.isNaN` checks. 35/35 tests green after the fix.

## Phase 5 — Middleware (TDD)

- [x] `src/lib/jwt.ts` — `signAccessToken`/`verifyAccessToken` extracted as pure, testable functions (new — not in the original plan's file list, but auth.ts previously inlined this; splitting it out let it be unit-tested with real jose calls, no Express needed). 6 tests.
- [x] `authMiddleware` extended for cookies (+ Bearer fallback, cookie takes priority) + test (6 passing). `AuthContext` changed from `role: enum` to `roleId: string` per the schema decision.
- [x] `src/middleware/permissions.ts` — `loadPermissions` + `requirePermission` + `requireAnyPermission` + tests (7 passing, incl. one DB-integration test proving the RBAC tables are actually read correctly)
- [x] `src/types/express.d.ts` updated: `AuthContext.role` → `roleId` + optional `permissions`

## Phase 6 — `modules/auth/` (TDD)

- [x] `auth.schema.ts` (Zod: register, login) + tests (8 passing)
- [x] `auth.repo.ts` + integration tests (8 passing) — proves cross-tenant email isolation directly (two tenants, same email, RLS keeps them apart)
- [x] `auth.service.ts` (constructor-injected `AuthRepo` interface) + unit tests with a stubbed repo (14 passing) — dummy-bcrypt timing defense, refresh rotation, identical error for bad-tenant/bad-user/bad-password
- [x] `auth.handlers.ts` + `auth.router.ts` — register/login rate-limited (10/15min), cookie helpers (secure/sameSite conditional on NODE_ENV — RIS hardcoded these to prod values even in dev, fixed here)
- [x] E2E tests (Supertest, real DB): register, duplicate-slug 409, invalid-payload 422, login success/failure parity, full register→me→refresh→logout→refresh-fails flow proving rotation actually invalidates the old token. 6 passing.
- [!] **Found and fixed a real bug in the pre-existing scaffold, not code I wrote this pass:** `notFoundHandler` in `src/middleware/error-handler.ts` was typed as a 4-arg `ErrorRequestHandler`. Express decides "is this an error handler" purely by counting declared parameters, so a 4-arg "404 handler" only ever runs when something upstream calls `next(err)` — at which point it intercepts the error before the real `errorHandler` and reports a misleading generic 404 instead of the actual failure. This was caught because the E2E test's second request in a sequence (login with wrong password) got a bare 404 instead of 401. Fixed by making it a plain 3-arg `RequestHandler`; removed the now-unused `noRouteMatched()` export it existed to support (unreferenced anywhere). All 90 tests green after the fix.
- **Design decision (see PLAN.md):** login requires `tenantSlug` alongside email/password, since email is only unique per-tenant. Refresh/logout resolve tenant from the token hash via a narrow `adminPrisma` lookup (documented as the second sanctioned admin-bypass use case, alongside provisioning).

## Phase 7 — `modules/roles/` (TDD)

- [x] `roles.schema.ts` (create/update, permissionIds as uuid arrays) + tests (8 passing)
- [x] `roles.repo.ts` + integration tests (11 passing) — covers per-tenant unique name, cross-tenant name reuse, RLS isolation on findRoleById, permission-set replace-on-update, userCount aggregation
- [x] `roles.service.ts` (constructor-injected `RolesRepo`) + unit tests (7 passing) — system-role delete protection, users-assigned delete protection, permission-cache invalidation ONLY on a permissionIds change (not on a bare rename — cheaper and correctly scoped)
- [x] `roles.handlers.ts` + `roles.router.ts` (all routes: auth + tenant context + loadPermissions + per-route `requirePermission`)
- [x] E2E tests (6 passing): lists the 3 seeded default roles, lists the permission catalog, full create/update/delete lifecycle as Owner, 403 deleting a system role, 403 for a Member missing `roles:create`, 401 unauthenticated
- All roles-module tests passed on the first run after implementation — no bugs found here (contrast with auth/pagination phases).

## Phase 8 — `modules/users/` (TDD)

- [x] `users.schema.ts` (create/update/changePassword) + tests (9 passing)
- [x] `users.repo.ts` + integration tests (9 passing) — soft-delete exclusion from list/find, RLS isolation, P2002/P2003 error mapping
- [x] `users.service.ts` (constructor-injected `UsersRepo`) + unit tests (10 passing) — password hashing before persistence, cannot-delete-self rule
- [x] `users.handlers.ts` + `users.router.ts`
- [x] New reusable primitive added here: `requireSelfOrPermission(paramName, permission)` in `src/middleware/permissions.ts` (+3 tests) — lets anyone change their OWN password regardless of role, while changing someone else's still needs `users:update`. Not in the original PLAN.md endpoint table's literal permission column, but is exactly what "self or admin" in that table implies; without it a Member could never change their own password. Added as a generic, reusable middleware rather than a one-off check.
- [x] Extracted `tests/helpers/e2e-auth.ts` (`registerOwner`, `loginAsSeededRole`) after noticing the roles-router E2E test and the new users-router E2E test needed identical setup — refactored roles.router.test.ts to use it too, no behavior change (still 6 passing there).
- [x] E2E tests (7 passing): list-after-register, full create/get/update/delete lifecycle incl. 404-after-delete, self-delete blocked (400), self password-change allowed for a Member (200), other-user password-change blocked for a Member (403), user creation blocked for a Member (403), 401 unauthenticated.
- All users-module tests passed on first run.

**Full suite after Phase 8: 160/160 tests passing across 21 files.**

## Phase 9 — Seed script

- [x] `scripts/seed.ts` rewritten for Prisma — reuses `registerTenantWithOwner` from `auth.repo.ts` directly (no separate seed-only provisioning code path to drift out of sync with the real register endpoint), seeds Acme + Globex with `Password123!`
- [x] Runs `syncPermissions` first (documented prerequisite — a tenant registered before the catalog is synced would get roles with zero permissions)
- [x] Idempotency verified by running twice against the dev DB — second run logs "already seeded, skipping" for both tenants, no errors, no duplicates
- [x] Removed obsolete `scripts/migrate.ts` (Drizzle-specific) — `db:migrate` now calls `prisma migrate deploy` directly, no wrapper script needed
- [!] Small cleanup while wiring this up: `registerTenantWithOwner` originally took the full `RegisterInput` type (including `password`, which it never reads — it takes `passwordHash` as a separate argument). Introduced a `TenantProvisioningInput` type with just the 4 fields it actually uses, so `seed.ts` doesn't need a dummy `password: 'unused'` field. `AuthRepo`'s interface in `auth.service.ts` updated to match. All 160 tests still green after the change.

## Phase 10 — Wiring & docs

- [x] Added `cookie-parser` middleware to `src/app.ts` (was missing — auth cookies wouldn't have been readable via `req.cookies` outside of tests, where each module's own test app added it locally)
- [x] Mounted `authRouter` → `/api/v1/auth`, `rolesRouter` → `/api/v1/roles`, `usersRouter` → `/api/v1/users` in `src/app.ts`
- [x] Rewrote `src/index.ts`: Prisma clients instead of Drizzle pools, calls `syncPermissions(adminPrisma)` before `app.listen` (boot sequence now: sync permissions → listen → graceful shutdown disconnects both Prisma clients)
- [x] Manually smoke-tested the live server end-to-end (booted on a scratch port, curl'd register → me → list roles → list users → refresh → logout) — full flow works against the real dev DB, not just the test DB
- [x] Rewrote `CLAUDE.md`, `README.md`, `src/modules/README.md` for Prisma + the three shipped modules + the RBAC model + TDD workflow
- [!] **Found and fixed a second real bug while smoke-testing:** none this time — the notFoundHandler bug (Phase 6) was the only one; the live smoke test passed cleanly on the first try after wiring.

## Phase 11 — Final verification

- [x] `pnpm typecheck` — clean. Fixed a **pre-existing** scaffold bug on the way: base `tsconfig.json` had `rootDir: "./src"` while also `include`-ing `scripts/`, `tests/`, and `*.config.ts` — a structural conflict (TS6059) that would have failed on day one of the scaffold, not something introduced this pass. Removed the explicit `rootDir` (TS infers it per-config now); `tsconfig.build.json`'s narrower `include: ["src/**/*"]` still infers `rootDir: "./src"` on its own, so `dist/` output shape is unchanged.
- [x] `pnpm lint` — clean (0 errors, 0 warnings). Fixed a mix of pre-existing and newly-introduced issues:
  - Pre-existing, unrelated to this pass: `eslint.config.js` itself wasn't covered by the TS project service (added `allowDefaultProject`); `tseslint.config()` is deprecated in the installed typescript-eslint version (migrated to ESLint core's `defineConfig`); stale/unnecessary `eslint-disable` comments in `env.ts` and `express.d.ts`; a couple of `no-unnecessary-*`/`no-non-null-assertion`/`no-confusing-void-expression` violations in `async-handler.ts`, `errors.ts`, `pagination.ts`, `middleware/tenant-context.ts` that the strict-type-checked ESLint preset was never actually run against before (no evidence in the repo that `pnpm lint` had ever been executed clean).
  - `pino-http`'s shipped `.d.ts` resolves to an uncallable type under `moduleResolution: NodeNext` (declares `export default` in what TS treats as a CommonJS-format file) — cast at the one usage site in `request-logger.ts`, documented inline.
  - Introduced by this pass, now fixed: a non-null assertion in `auth.repo.ts`, a void-expression issue in `permission-cache.ts`, two `require-await` violations in test stubs, and Express 5's `req.params` now typing values as `string | string[]` — added a small `requireParam()` helper (`src/lib/request-params.ts`) instead of asserting.
  - Added an ESLint override (test files only) turning off `no-unsafe-*` for Supertest's untyped `res.body` — standard practice, does not touch `src/` strictness.
- [x] `pnpm test` — **172/172 passing**, 23 test files, **96.23% statement / 88.99% branch coverage** (floor is 70%; auth/roles/users modules are 95–100%).
- [x] Added two more test files while closing coverage gaps found during this phase: `src/app.test.ts` (smoke tests `createApp()` itself — `/healthz`, `/readyz`, an unmapped-route 404, and that `/api/v1/auth/register` plus the roles/users routers are actually reachable through the real app factory, not just each module's own standalone test app) and `src/middleware/error-handler.test.ts` (unit tests for every branch of `errorHandler` — ZodError, <500 AppError, ≥500 AppError, unknown error — plus a regression guard asserting `notFoundHandler.length === 2` and `errorHandler.length === 4`, directly protecting against the exact arity bug class found in Phase 6).

**Final state: typecheck clean, lint clean, 172/172 tests passing, 96.23% coverage. Full stack manually smoke-tested live (register → me → list roles → list users → refresh → logout) against the dev database on a scratch port, in addition to the automated Supertest suites.**

## Deviations / decisions made during implementation

- **`pnpm audit` found 20 real vulnerabilities (2 critical, 10 high, 8
  moderate)** — reported by the user from a real audit run, then reproduced
  and root-caused locally. All three clustered into transitive dev/build
  tooling, not application runtime code:
  1. **`tar`** (12 advisories, 1 critical) via `bcrypt > @mapbox/node-pre-gyp
     > tar`— bcrypt's own install-time tooling, several versions behind on
a heavily-patched package. Fixed with a`pnpm-workspace.yaml` `overrides`entry forcing`tar: ^7.5.22`regardless of what`@mapbox/node-pre-gyp`
     > declares.
  2. **`vite`/`esbuild`/`@vitest/mocker`** (7 advisories, 1 critical) via our
     own `vitest`/`@vitest/coverage-v8` — pinned at `^2.1.8`, several majors
     behind. Fixed by bumping to `^4.1.11` — the minimum version that's
     actually patched (there's a 5.x, but 4.1.11 fixes every advisory found
     without the extra risk of an unnecessary second major jump).
  3. **`deepmerge-ts`** (1 high) via `prisma > @prisma/config` — again
     install/CLI-time only, not `@prisma/client`'s runtime path. Fixing this
     "properly" would mean a Prisma 6→7 major bump, which is far riskier
     than the vulnerability itself (a DoS via recursive object graphs in a
     config-loading path with no untrusted-input exposure). Used the same
     override approach instead: force `deepmerge-ts: ^8.0.0` directly,
     leaving `prisma` itself at `6.19.3`.
     `pnpm.overrides` in `package.json` **also** turned out to be silently
     ignored by this pnpm version — same class of bug as the
     `onlyBuiltDependencies`/`allowBuilds` move earlier — confirmed via the
     same "no longer read by pnpm" warning, moved to `pnpm-workspace.yaml`'s
     `overrides:` key instead. `pnpm audit` now reports 0 vulnerabilities;
     confirmed the full suite still passes after every change (see below).
- **The vitest 2→4 bump broke `bcrypt` resolution in tests** — investigated
  thoroughly before concluding it was a **local environment artifact, not a
  real bug**: plain `node -e "require('bcrypt')"` failed identically with
  no vitest involved at all, tracing back to a corrupted local pnpm
  content-addressable store (bcrypt's package was missing its own
  `bcrypt.js` — confirmed against the real npm tarball, which does ship
  it). Wiping the pnpm store (`~/AppData/Local/pnpm/store`) and reinstalling
  fixed it outright — nothing wrong with vitest 4, this repo's config, or
  the dependency bump itself. **Kept two defensive vitest.config.ts settings
  anyway** (`server.deps.external: ['bcrypt']`, `optimizeDeps.exclude:
['bcrypt']`) since they're Vitest's own documented guidance for native
  addons regardless of whether they were the actual fix here — harmless,
  and correct practice going forward.
- **Added `.prettierignore`** (didn't exist) excluding `pnpm-lock.yaml` and
  `prisma/migrations` — found because `pnpm-lock.yaml` needed reformatting
  after all the dependency changes above, and a machine-generated lockfile
  being subject to Prettier is a recipe for it flip-flopping between "needs
  formatting" and "clean" on every future `pnpm install`. Migrations get the
  same treatment for the same reason, and because CLAUDE.md §11 already
  says not to touch applied migrations at all.
- **First real CI run: 6 of 7 checks failed with `ERROR packages field
missing or empty` from `pnpm store path --silent`.** Root cause:
  `pnpm-workspace.yaml` (added this session, originally just to hold
  `allowBuilds`/`onlyBuiltDependencies` after `pnpm approve-builds`
  rewrote it) had no `packages:` field. **pnpm 12 (installed locally this
  session) tolerates that; pnpm 9 (what `pnpm/action-setup` installs per
  this workflow's pinned version) does not** — reproduced locally with
  `npx pnpm@9 store path --silent` before fixing, confirmed fixed after
  adding `packages: ["."]`, then confirmed a full `pnpm install
--frozen-lockfile` succeeds end-to-end under pnpm 9 in an isolated copy.
  This one file explains all 6 failures at once: every job except
  `secret-scan` calls `pnpm/action-setup`, which runs `store path`
  internally before any job-specific step executes — one broken config
  file took down the entire pnpm-dependent half of the workflow in one shot.
- **Created `dev` and `staging` branches (from `main`) and pushed both to
  origin**, alongside the same in the sibling `admin-dashboard-nextjs`
  repo — the three-tier `feature/* → dev → staging → main` workflow
  (`CLAUDE.md` §0) needs both to exist, and neither repo had either before
  this.
- **CI/CD moved to an unnumbered section before Phase 0** instead of staying
  as the original "Phase 12" at the end. The user corrected this mid-project:
  CI has to exist before the _first_ gated PR, not after 11 phases of
  ungated work — see the CI/CD section above for why it isn't slotted into
  the historical 0–11 sequence at all.
- **Found and fixed while adding the `format:check` CI gate: `pnpm format:check`
  had never actually been run before** — 76 files needed reformatting (pure
  whitespace/quote-style, Prettier never changes logic). Ran `pnpm format`
  once, then re-ran `typecheck`/`lint`/the full test suite (still 172/172)
  to confirm nothing broke.
- **Fixed the `Dockerfile`: it never ran `prisma generate`.** The image
  would have built "successfully" and then failed at container startup —
  `@prisma/client`'s generated code wouldn't exist. Added the generate step
  (needs `DATABASE_ADMIN_URL` set to a placeholder even though it never
  connects — verified locally that `prisma generate`/`validate`/`format`
  all just need the var to _resolve_, not a real database).
- **Added `.dockerignore`** (didn't exist) so the build context isn't
  `node_modules`/`.git`/`dist` for no reason.
- **`prisma migrate diff` does not auto-create its shadow database**, unlike
  `prisma migrate dev`, even though the connecting role has `CREATEDB` —
  discovered by actually running the drift-check command locally (P1003:
  database does not exist) before trusting it in CI. Added an explicit
  `CREATE DATABASE multitenant_shadow` step before the diff check. Also
  verified the check actually catches drift, not just that it passes
  cleanly: temporarily added an unmigrated field to `schema.prisma`, ran
  the same command, confirmed it fails with `--exit-code`, then reverted.

- **Phase 1 + Phase 2 schema combined into a single migration.** PLAN.md
  separated them (tenants/users first, RBAC tables second) to mirror how a
  real incremental rollout would go. Since this is a greenfield scaffold
  with no data to migrate incrementally, splitting it into two migrations
  would only add churn (generate, hand-edit RLS, apply — twice) with no
  benefit. TDD discipline is applied at the code level (every module/lib/
  middleware still written test-first) rather than at the migration-count
  level, which isn't where the risk is.
- **No Docker available in this environment.** Used a throwaway local
  Postgres 18 cluster on port 5433 instead (see "Local dev/test environment
  note" above). `docker-compose.yml` is untouched and remains correct for
  anyone else using this template with Docker installed.
- **Vitest path-alias resolution.** The scaffold's `#/*` → `./src/*` alias
  was only ever consumed by `tsx` (via `tsconfig.json` `paths`) and had
  never been exercised under Vitest before (no test files existed). Added
  a `resolve.alias` regex (`/^#\//`) to `vitest.config.ts` so test files can
  use the same `#/lib/errors.js`-style imports as source files. This is the
  Vite-native equivalent of what `tsx` already did for the dev/build path —
  no new dependency needed.
- **`.gitignore` did not exist.** Added one before creating `.env`/`.env.test`
  so secrets/local DB URLs can't be accidentally committed.
