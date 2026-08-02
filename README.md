# 焚烧下单与排程 MVP

第一阶段提供手机号/密码登录、强制改密、会话、管理员用户管理、审计记录与登录限流，并附带生产健康检查、容器样例和腾讯云运行手册。

> **NO PRODUCTION LAUNCH — 生产状态（2026-08-03）：禁止上线。**
>
> - Caddy gate: FAIL；2.10.2: 64 High / 6 Critical；2.11.4 candidate: 10 High / 0 Critical。
>   在获得扫描门禁通过的新 digest 前，禁止发布生产镜像。
> - H2 restore drill 尚未在真实腾讯云隔离实例完成并留证。
> - GitHub ruleset/master/GHCR/attestation 尚未在外部环境完成并留证。
> - L3 CSP deferred；完整订单排期业务也仍在后续阶段。
>
> 详见 [Stage 1 加固证据](docs/reviews/stage-1-production-hardening.md)。

## 本地启动

要求 Node.js 22、Docker Desktop 和 npm。复制 `.env.example` 为不提交的 `.env`，然后执行：

```powershell
docker compose -f compose.dev.yaml up -d
npm ci
npm run prisma:generate
npx prisma migrate deploy
npm run dev
```

`compose.dev.yaml` 仅为本机开发创建 `.env.example` 中的 `fenshi_migrator`
和 `fenshi_app` 角色及固定开发密码。初始化脚本只会在全新 PostgreSQL 数据卷上运行；
已有旧数据卷请按 `docs/runbooks/postgresql-roles.sql` 手动补齐角色，或在确认本地数据可丢弃后
删除该 Compose 数据卷并重新启动。生产环境不得使用这些开发密码。

另开一个交互式终端运行 `npm run admin:create` 创建首个管理员；密码不接受命令行参数，也不会回显。应用默认地址为 `http://localhost:3000`。

## 质量门禁

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
$env:MIGRATION_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
$env:APP_ORIGIN='http://127.0.0.1:3000'
npm run lint
npm run typecheck
npm run prisma:validate
npx prisma migrate deploy
npm run test:database-roles
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm audit --omit=dev --audit-level=high
docker build -t fenshi-order-scheduling-mvp:phase-1 .
```

`test:database-roles` 会使用独立 Compose project、非冲突的 localhost 端口和专属数据卷，
从全新数据库验证迁移/运行角色分离、4 个迁移、运行角色 CRUD 以及永久和临时 DDL 拒绝，
并在结束时删除该 project 和数据卷。Dockerfile 的依赖安装关闭内嵌 advisory 请求并限制并发，
但不会绕过 lockfile integrity 或生命周期脚本；上面的独立 production `npm audit` 仍是强制门禁。

E2E 还需设置 `.env.example` 列出的六个 `E2E_*` 变量；不得把这些值写入日志或提交到仓库。

## 健康检查

- `GET /api/health/live`：只证明 Node 进程可响应，不访问数据库。
- `GET /api/health/ready`：执行 PostgreSQL `SELECT 1`，数据库不可用时返回 503。

## 生产运维

- [腾讯云部署与回滚](docs/runbooks/deploy-tencent-cloud.md)
- [备份与恢复演练](docs/runbooks/backup-and-restore.md)
- [事件响应](docs/runbooks/incident-response.md)

`compose.production.example.yaml` 仅包含应用和 Caddy，不创建生产数据库。生产数据库必须使用腾讯云托管 PostgreSQL 私网 TLS 地址，并通过外部 Secret/环境注入。容器启动不会自动执行迁移；发布人员必须先运行 `npx prisma migrate deploy`。
