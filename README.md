# 焚烧下单与排程 MVP

第一阶段提供手机号/密码登录、强制改密、会话、管理员用户管理、审计记录与登录限流，并附带生产健康检查、容器样例和腾讯云运行手册。

## 本地启动

要求 Node.js 22、Docker Desktop 和 npm。复制 `.env.example` 为不提交的 `.env`，然后执行：

```powershell
docker compose -f compose.dev.yaml up -d
npm ci
npm run prisma:generate
npx prisma migrate deploy
npm run dev
```

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
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm audit --omit=dev --audit-level=high
docker build -t fenshi-order-scheduling-mvp:phase-1 .
```

E2E 还需设置 `.env.example` 列出的六个 `E2E_*` 变量；不得把这些值写入日志或提交到仓库。

## 健康检查

- `GET /api/health/live`：只证明 Node 进程可响应，不访问数据库。
- `GET /api/health/ready`：执行 PostgreSQL `SELECT 1`，数据库不可用时返回 503。

## 生产运维

- [腾讯云部署与回滚](docs/runbooks/deploy-tencent-cloud.md)
- [备份与恢复演练](docs/runbooks/backup-and-restore.md)
- [事件响应](docs/runbooks/incident-response.md)

`compose.production.example.yaml` 仅包含应用和 Caddy，不创建生产数据库。生产数据库必须使用腾讯云托管 PostgreSQL 私网 TLS 地址，并通过外部 Secret/环境注入。容器启动不会自动执行迁移；发布人员必须先运行 `npx prisma migrate deploy`。
