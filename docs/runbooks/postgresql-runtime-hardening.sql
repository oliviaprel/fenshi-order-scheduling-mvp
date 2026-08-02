-- Run after every successful `prisma migrate deploy`. The table is created by
-- Prisma during the first deployment, so this is a repeatable post-migration
-- artifact instead of part of the pre-migration role bootstrap.
\set ON_ERROR_STOP on

REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE "_prisma_migrations" FROM fenshi_app;

