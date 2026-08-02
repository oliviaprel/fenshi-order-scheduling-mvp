# 部署安全要求

## Database credentials and least privilege

The web runtime receives and parses only `DATABASE_URL`, which must use the
`fenshi_app` role. It has no schema `CREATE` privilege and is limited to the
application's table and sequence DML permissions. Do not inject
`MIGRATION_DATABASE_URL` into the application container.

Run Prisma schema deployment from a controlled operator environment using
`MIGRATION_DATABASE_URL` and the distinct `fenshi_migrator` role. Prisma
loads this variable from `prisma.config.ts`; a missing value must stop the
migration command, but must never stop the web runtime. Bootstrap and review
the roles with [the PostgreSQL role runbook](runbooks/postgresql-roles.sql)
before the first migration, and rotate the two credentials independently.

应用将 `x-forwarded-for` 的第一个值作为登录限流客户端 IP。生产反向代理必须删除客户端传入的同名请求头，并用代理确认的来源地址覆盖该头；不得追加或原样透传任意客户端提供的值。

应用进程不得直接暴露到公网。只有实施上述覆盖规则的受信任反向代理可以访问应用端口。
