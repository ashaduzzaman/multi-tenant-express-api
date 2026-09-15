# MODULES.md — Module coverage tracker

> Companion to `PLAN.md` (design decisions) and `IMPLEMENTATION.md` (build log).
> This file answers one question: **of everything a multi-tenant SaaS needs,
> what does this starter kit actually have, and what's next?** Update it
> whenever a module ships, changes scope, or gets explicitly deferred —
> keep the status current, not just the initial snapshot.

Status legend: `✅ Done` · `🚧 Partial` (works, but narrower than the full concern) · `⬜ Not started`

---

## 1. Tenancy core — what makes this multi-tenant at all

| Module | Status | Notes |
|---|---|---|
| Tenant/organization registry | ✅ Done | `Tenant` model (`prisma/schema.prisma`): slug, name, `status` enum (`active`/`suspended`/`deleted`). |
| Tenant provisioning & lifecycle | 🚧 Partial | Signup → workspace creation is done (`registerTenantWithOwner`, one transaction: tenant + Owner/Admin/Member roles + owner user). **Missing:** anything that acts on `suspended`/`deleted` status — no suspend endpoint, no offboarding/data-deletion flow. The enum exists; nothing reads it yet. |
| Tenant context resolution | 🚧 Partial | Resolved from the JWT claim (`tid`) via `tenantContextMiddleware`, request-scoped. **Missing:** subdomain/header/path-based resolution — fine for an API-only template, would matter for a public multi-domain frontend. |
| Data isolation layer | ✅ Done | This is the architecture's centerpiece: Postgres RLS + `withTenantContext()`/`withTenantContextReadOnly()`, `FORCE ROW LEVEL SECURITY`, two DB roles (`app_user`/admin). See `CLAUDE.md` §3–4. |
| Tenant-scoped configuration | ⬜ Not started | No per-tenant feature flags, settings, branding, or limits table yet. |
| Custom domains / white-labeling | ⬜ Not started | |

## 2. Identity & access

| Module | Status | Notes |
|---|---|---|
| Authentication | 🚧 Partial | Email/password only (`modules/auth/`), httpOnly cookies, refresh rotation, dummy-bcrypt timing defense. **Missing:** OAuth/social login, magic links, MFA. |
| User ↔ tenant membership | 🚧 Partial — **architectural gap, not just a missing feature** | Current schema is **one user row = one tenant** (`users.tenantId` + `unique(tenantId, email)`). A person with accounts in two tenants today has two entirely separate `User` rows with two separate passwords — there is no single identity that belongs to multiple tenants, no workspace switcher, no "membership" join table. Real "user can belong to many workspaces" support is a schema change (a `Membership`/`TenantUser` join table decoupling identity from tenant membership), not an additive module — flagging this now so it's a deliberate decision later, not a surprise. |
| Roles & permissions (RBAC) | ✅ Done | Tenant-scoped `roles` + `role_permissions`, global `permissions` catalog, 5-min cache. `modules/roles/`. |
| Invitations & onboarding | ⬜ Not started | Today, adding a user to a tenant is `POST /api/v1/users` (an admin sets their password directly) — no invite-by-email flow, no pending-invite state, no domain auto-join. |
| SSO/SAML/OIDC + SCIM | ⬜ Not started | Enterprise-tier feature; not attempted. |
| API keys / service accounts | ⬜ Not started | All auth today is user-session (cookie/bearer JWT) — no tenant-scoped API keys for machine-to-machine access. |

## 3. Billing & monetization

| Module | Status | Notes |
|---|---|---|
| Plans & pricing catalog | ⬜ Not started | |
| Subscription management | ⬜ Not started | |
| Payment provider integration | ⬜ Not started | |
| Entitlements & quota enforcement | ⬜ Not started | |
| Usage metering | ⬜ Not started | |

Nothing in this category exists yet. It's a big, mostly self-contained slice (Stripe/Paddle webhooks, a `Subscription`/`Plan` schema, an entitlements check at the permission-gate layer) — good candidate for its own pass, same shape as the auth+RBAC+users pass.

## 4. Platform services

| Module | Status | Notes |
|---|---|---|
| Notifications | ⬜ Not started | Explicitly deferred in `PLAN.md` §14 (RIS-app-api has a portable design for this — event bus + delivery-preference pairs — worth reusing when this is picked up). |
| File/object storage | ⬜ Not started | Same — RIS-app-api's S3 `StorageAdapter` interface is a clean, generic starting point, deferred per `PLAN.md` §14. |
| Background jobs & scheduling | ⬜ Not started | Deferred; RIS-app-api uses `pg-boss`, which fits this stack (already Postgres-based, no new infra). |
| Search/indexing | ⬜ Not started | |
| Caching (general-purpose) | 🚧 Partial | Only `permission-cache.ts` exists — an in-memory, tenant-namespaced TTL cache for exactly one thing (permission lookups). No general cache layer (e.g. Redis) for other hot reads. |
| Integrations/webhooks framework | ⬜ Not started | |
| Public API + rate limiting | 🚧 Partial | `express-rate-limit` is wired globally and (stricter) on `/auth/login`+`/auth/register`, but it's **IP-based**, not per-tenant or per-API-key — and there's no public API surface distinct from the authenticated app API yet (depends on API keys, above). |

## 5. Observability, audit & compliance

| Module | Status | Notes |
|---|---|---|
| Audit log | ⬜ Not started | No `audit_log` table or write-path. Worth tenant-scoping like every other table here (RLS + `tenant_id`-leading index) when it's built. |
| App logging/metrics/tracing | 🚧 Partial | Structured Pino logging + request-ID propagation exists (`request-logger.ts`), redaction configured for secrets. **Missing:** metrics (Prometheus/OpenTelemetry), distributed tracing, and logs aren't consistently tagged with `tenantId` — worth a pass to thread it through `logger.child({ tenantId })` at the request-logger level. |
| Data export & deletion (GDPR/PIPEDA) | ⬜ Not started | The soft-delete pattern on `users` (`deletedAt`) is a start, but there's no per-tenant export, no right-to-erasure flow, no retention policy. |
| Security controls | 🚧 Partial | bcrypt hashing, RLS, parameterized queries, Zod validation at every boundary, Pino redaction — the fundamentals are solid. **Missing:** per-tenant encryption keys (higher-tier feature), secrets-manager integration (currently plain env vars, fine for a starter kit). |
| Backups & tenant-level restore | ⬜ Not started | Infrastructure concern, not really API code — but worth a documented runbook eventually. |

## 6. Admin & operations

| Module | Status | Notes |
|---|---|---|
| Super-admin / internal back-office | ⬜ Not started | No cross-tenant admin panel, no impersonation-with-audit. |
| Feature flag & rollout system | ⬜ Not started | |
| Status/health | 🚧 Partial | `GET /healthz` (liveness) + `GET /readyz` (DB/RLS readiness) exist. No public status page or incident-comms tooling — reasonable for an API template. |
| Tenant analytics | ⬜ Not started | |

## 7. Product surface

Not applicable in the current form — **this repo is an API-only starter kit, no frontend.** Onboarding wizard, settings UI, and in-app help are frontend concerns that would live in a companion app consuming this API.

---

## Against your own "minimum viable" bar

You listed: *tenant registry + provisioning, tenant context middleware, data isolation, auth + membership + roles, invitations, subscription/billing with entitlements, audit log, and a super-admin panel.*

| Item | Status |
|---|---|
| Tenant registry + provisioning | ✅ Done |
| Tenant context middleware | ✅ Done |
| Data isolation | ✅ Done |
| Auth | 🚧 Partial (email/password only) |
| Membership | 🚧 Partial (**one-user-one-tenant**, no cross-tenant membership yet — see §2) |
| Roles | ✅ Done |
| Invitations | ⬜ Not started |
| Subscription/billing + entitlements | ⬜ Not started |
| Audit log | ⬜ Not started |
| Super-admin panel | ⬜ Not started |

**5 of 10 done, 2 partial, 3 not started** — this pass covered the foundation (tenancy + isolation + RBAC), not the full MVP bar. That was the deliberately scoped first pass (see `PLAN.md` §14).

## Suggested next-pass order

Roughly in dependency order — each one unblocks or is much easier once the one above it exists:

1. **Invitations** — natural extension of the auth/users modules already built; no new architectural concept, just an email-flow + pending-invite state.
2. **User ↔ tenant membership redesign** — before billing (seats are counted per membership) and before invitations get widely used (an invited user accepting into a *second* tenant needs this to exist). Worth deciding now rather than retrofitting later.
3. **Audit log** — cross-cutting, cheap to bolt onto every existing write path once the table exists (write-through from services, not handlers).
4. **Billing & entitlements** — biggest standalone slice; gate it behind a `requireEntitlement()` middleware analogous to `requirePermission()`.
5. **Notifications, file storage, background jobs** — the three explicitly deferred from the first pass, each with a design already sketched in `PLAN.md` §14 by way of RIS-app-api's reusable patterns.
6. **Super-admin panel, API keys, feature flags, analytics** — once there are real tenants and a billing model to protect/observe.

This ordering is a suggestion, not a commitment — revisit it if priorities change, and update the tables above (not just this list) as each module actually ships.
