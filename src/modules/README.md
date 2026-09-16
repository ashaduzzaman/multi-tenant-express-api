# `src/modules/`

Each feature lives in its own folder here. Three are already built — `auth/`, `roles/`, `users/` — copy their shape for a new one (`roles/` is the smallest complete example). Default module layout:

```
modules/<feature>/
├── <feature>.schema.ts      # Zod schemas for request/response bodies
├── <feature>.repo.ts        # Prisma queries — ALWAYS via withTenantContext()
├── <feature>.service.ts     # Business logic — a class taking an injected repo, + a wired singleton
├── <feature>.handlers.ts    # Thin HTTP handlers — parse input, call service, send response
├── <feature>.router.ts      # Express router — mounts its own auth/permission middleware
├── <feature>.schema.test.ts
├── <feature>.repo.test.ts    # real DB — proves RLS isolation
├── <feature>.service.test.ts # stubbed repo — no DB
└── <feature>.router.test.ts  # Supertest, real DB, real HTTP
```

**Required wiring in `src/app.ts`:**

```ts
import { projectsRouter } from "#/modules/projects/projects.router.js";
app.use("/api/v1/projects", projectsRouter);
```

Nothing else — the router mounts `authMiddleware` / `tenantContextMiddleware` / `loadPermissions` / `requirePermission` itself (see `roles.router.ts`), so `app.ts` stays a plain index of what's mounted where.

**The contract every module follows:**

- Handlers never touch Prisma directly. They call the service.
- Services never touch Prisma directly. They call the repo, injected via the constructor:
  ```ts
  export interface RolesRepo { listRoles: (...) => Promise<...>; /* … */ }
  export class RolesService {
    constructor(private readonly repo: RolesRepo) {}
  }
  export const rolesService = new RolesService(repo); // handlers import this
  ```
  This is what lets `*.service.test.ts` test business rules (e.g. "a system role can't be deleted") with a `vi.fn()`-stubbed repo and zero database access.
- Repo functions take `tenantId` as their first parameter and wrap their Prisma calls in `withTenantContext(tenantId, async (tx) => ...)` / `withTenantContextReadOnly(...)`.
- Routes that mutate require the relevant `requirePermission('<resource>:<action>')` on top of `authMiddleware` + `loadPermissions`. See `src/config/permissions.ts` for the catalog and `CLAUDE.md` §6 for the RBAC model.
- Schema lives in its own file so it can be reused by tests and OpenAPI generators.

This separation keeps tests fast (most of them never touch a database) and makes the RLS boundary and the permission boundary both obvious in code review.

See `CLAUDE.md` → **"Adding a new feature module"** for the full walkthrough, and `PLAN.md` for why the RBAC/auth design looks the way it does.
