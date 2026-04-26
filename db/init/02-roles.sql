-- Runs ONCE on a fresh postgres data volume.
--
-- Two-role security model:
--   * postgres / app_admin → BYPASSES RLS. Used for: migrations, tenant
--     provisioning, system maintenance. Never used for request-scoped queries.
--   * app_user             → RLS APPLIES. Used by the application to serve
--     all tenant-scoped requests. Cannot bypass RLS even by accident.
--
-- This is THE critical safety boundary. Do not change which role the app
-- connects as without understanding the implications.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Grant connect on the database (substituted by postgres at init time)
GRANT CONNECT ON DATABASE multitenant_dev TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

-- Future tables/sequences created by migrations should be usable by app_user
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_user;
