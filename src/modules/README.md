# `src/modules/`

Each feature lives in its own folder here. Default module layout:

```
modules/<feature>/
├── <feature>.router.ts      # Express router — mounts middleware, defines routes
├── <feature>.handlers.ts    # Thin HTTP handlers — parse input, call service, send response
├── <feature>.service.ts     # Business logic — calls repository, enforces invariants
├── <feature>.repo.ts        # Drizzle queries — ALWAYS via withTenantContext()
├── <feature>.schema.ts      # Zod schemas for request/response bodies
└── <feature>.test.ts        # Vitest tests
```

**Required wiring in `src/app.ts`:**

```ts
app.use(
  '/api/v1/<feature>',
  authMiddleware,
  tenantContextMiddleware,
  <feature>Router,
);
```

**The contract every module follows:**

- Handlers never touch Drizzle directly. They call the service.
- Services never touch the pool directly. They call the repo.
- Repo functions take `tenantId` as their first parameter and wrap their
  Drizzle calls in `withTenantContext(tenantId, async (tx) => ...)`.
- Routes that mutate require `requireRole('owner', 'admin')` on top of auth.

This separation keeps tests simple (mock the repo, not the pool) and makes
the RLS boundary obvious in code review.

See `CLAUDE.md` → **"Adding a New Feature Module"** for a copy-pasteable example.
