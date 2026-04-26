// Global test setup. Runs once before any test file.
//
// Currently empty. When tests need a real DB:
//   - Spin up a separate test schema or test container
//   - Run migrations
//   - Truncate between tests via beforeEach
//
// Keep RLS-aware tests using withTenantContext() with a known seeded tenant id.
