-- Run once per target database as its owner before the first Prisma migration.
-- This script is idempotent. It creates two least-privilege login roles:
--   fenshi_migrator: DDL in public and ownership of its migration objects.
--   fenshi_app:      runtime table/sequence DML only; no schema CREATE.
--
-- Invoke interactively so psql's \password command keeps passwords out of
-- shell history and process arguments:
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/runbooks/postgresql-roles.sql
--
-- For unattended, controlled provisioning only, pass both variables with
-- psql's -v option; do not place production secrets in this repository.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fenshi_migrator') THEN
    CREATE ROLE fenshi_migrator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fenshi_app') THEN
    CREATE ROLE fenshi_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE fenshi_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE fenshi_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

\if :{?fenshi_migrator_password}
  ALTER ROLE fenshi_migrator PASSWORD :'fenshi_migrator_password';
\else
  \password fenshi_migrator
\endif
\if :{?fenshi_app_password}
  ALTER ROLE fenshi_app PASSWORD :'fenshi_app_password';
\else
  \password fenshi_app
\endif

-- Do not rely on the default PUBLIC CONNECT grant; record the intended roles.
SELECT format('GRANT CONNECT ON DATABASE %I TO fenshi_migrator, fenshi_app', current_database()) \gexec
SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM fenshi_app', current_database()) \gexec

-- Lock down the default application schema, then grant only its required use.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO fenshi_migrator;
GRANT USAGE ON SCHEMA public TO fenshi_app;

-- Existing objects, if this is an in-place bootstrap. Objects must be owned by
-- fenshi_migrator for future Prisma ALTER/DROP migrations; transfer ownership
-- with an approved, database-owner-reviewed migration before using this script.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fenshi_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO fenshi_app;

-- Future objects created by the migration role inherit the app's DML grants.
ALTER DEFAULT PRIVILEGES FOR ROLE fenshi_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fenshi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fenshi_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO fenshi_app;

-- Verification (run after `prisma migrate deploy`):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT 1;'
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'CREATE TABLE must_fail (id int);'
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'CREATE TEMP TABLE must_fail (id int);'
-- The first command succeeds; both CREATE commands must fail with permission denied.
