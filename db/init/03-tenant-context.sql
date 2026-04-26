-- Register a custom GUC (Grand Unified Configuration) parameter that RLS
-- policies will read via current_setting('app.current_tenant_id', true).
--
-- The parameter is set per-transaction via:
--     SET LOCAL app.current_tenant_id = '<uuid>';
--
-- The second arg `true` to current_setting() returns NULL (instead of erroring)
-- when the GUC has not been set in the current transaction. RLS policies
-- treat NULL as "no tenant context" and reject all rows.

-- No-op: PostgreSQL accepts custom GUC names with a dot prefix without
-- pre-registration. This file exists to make the convention discoverable
-- and to centralize any future global RLS-related setup.

-- If you ever need a database-wide default (you almost certainly don't):
-- ALTER DATABASE multitenant_dev SET app.current_tenant_id TO '';
