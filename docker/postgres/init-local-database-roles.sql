-- Local development only. These fixed credentials match .env.example and
-- must never be used outside the disposable compose.dev.yaml database.

CREATE ROLE fenshi_migrator
  LOGIN PASSWORD 'fenshi_migrator_dev'
  NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE ROLE fenshi_app
  LOGIN PASSWORD 'fenshi_app_dev'
  NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT CONNECT ON DATABASE fenshi TO fenshi_migrator, fenshi_app;
REVOKE TEMPORARY ON DATABASE fenshi FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO fenshi_migrator;
GRANT USAGE ON SCHEMA public TO fenshi_app;

ALTER DEFAULT PRIVILEGES FOR ROLE fenshi_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fenshi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fenshi_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO fenshi_app;
