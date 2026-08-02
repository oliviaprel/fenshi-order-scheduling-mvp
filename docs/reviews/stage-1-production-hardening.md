# Stage 1 生产加固验证与审计证据

- 验证分支：`codex/stage-1-production-hardening`
- 验证基线：`114cfab`
- 本地验证 HEAD：代码与配置验证覆盖至 `ba1eea2`；本证据文件的提交见 Git 历史
- 验证窗口：2026-08-02 23:16–2026-08-03 00:03（Asia/Shanghai）
- 本地环境：Windows / Docker Desktop，Node.js `v24.14.0`，npm `11.9.0`，PostgreSQL `17-alpine`

## 结论

Stage 1 的代码级加固和本地质量门禁已经验证，但**当前仍不允许生产上线**。以下外部证据
不能在本地开发机伪造，必须由对应负责人完成后再复核：

1. H2：在独立腾讯云 PostgreSQL 实例执行真实备份恢复演练，记录备份 ID、源/目标实例、
   RPO、RTO、数据计数、ADMIN/USER 登录结果和负责人。
2. 在 `master` 真实运行 GitHub Actions，应用 ruleset，并确认 pull request 无发布权限。
3. 从 `master` 发布公开 GHCR 镜像，记录不可变 registry digest，下载 SPDX SBOM 和完整
   High/Critical 清单，并在线验证 GitHub provenance attestation。

另外，CSP 的 nonce 化属于 L3 后续项，本阶段明确延后；在完成前不得引入富文本或直接
渲染不可信 HTML。完整订单、物料、价格、排期和通知业务也不属于 Stage 1。

## 本地完整门禁

| 命令 | 2026-08-02 实际结果 |
| --- | --- |
| `npm ci` | exit 0；本机 Node 24.14.0 收到 `jsdom` engine 警告，CI/日常开发应使用 README 要求的 Node 22 最新 LTS |
| `npm run prisma:generate` | exit 0，Prisma Client 7.9.1 生成成功 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run prisma:validate` | exit 0，schema valid |
| `npm run test:workflows` | 22/22 通过，结构基线验证通过 |
| `npm run test:unit` | 17 个文件、63/63 通过 |
| `npm run test:integration` | 14 个文件、85/85 通过 |
| `npm run test:e2e` | 20/20 通过 |
| `npm run build` | exit 0，Next.js 16.2.12 production build 成功 |
| `npm audit --omit=dev --audit-level=high` | exit 0，0 vulnerabilities |
| `docker build -t fenshi-stage1:test .` | exit 0；本地 digest/image ID `sha256:690a612521c5d5211330d468588efa7f185cbe0566829ca7a775c179808ba87e` |

本机 worktree 使 Next.js 报告“检测到多个 lockfile”的非失败告警；GitHub 的独立 checkout
不具备该目录结构。E2E 只使用一次性 `fenshi_test` 合成账号，未使用或记录生产凭据。

Docker Desktop NAT 在第一次构建依赖下载时出现批量 `ECONNRESET`。在保留 package-lock
integrity、生命周期脚本和独立 `npm audit` 的前提下，最终构建仅临时给 deps 阶段使用
`--no-audit --maxsockets=5` 降低重复 advisory 请求和下载并发；构建完成后 `Dockerfile`
立即恢复为已提交的 `RUN npm ci`，没有提交该环境 workaround。该事实不影响上述独立
production audit 的 0 vulnerabilities 结果，也不能替代 GitHub runner 上的标准构建证据。

## 容器与边缘验证

- 本地镜像 content ID/RepoDigest：`sha256:690a612521c5d5211330d468588efa7f185cbe0566829ca7a775c179808ba87e`；
- 镜像默认用户为 `nextjs`；显式 `docker run --user 1001` 和运行中 `id -u` 均返回 `1001`；
- app 容器内部 `/api/health/live` 返回 200 和 `{"status":"ok"}`；
- app 容器内部 `/api/health/ready` 返回 200 和 `{"status":"ok"}`；
- 使用仓库 `deploy/Caddyfile.example`、站点主机 `localhost` 访问公共 live 返回 200；
- 同一 Caddy 入口访问公共 ready 返回 404；`caddy validate` 返回 `Valid configuration`。

用于 smoke 的 app、Caddy 容器和专属 `fenshi-stage1-smoke` 网络在验证后均已删除；测试
连接现有本地 `fenshi_test`，没有创建或删除业务数据卷。

本地 content ID 不能替代发布后由 registry 返回的不可变 digest，也不能替代 GHCR
attestation。生产部署只能使用 `ghcr.io/oliviaprel/fenshi-order-scheduling-mvp@sha256:...`。

## 审计项证据矩阵

| 审计项 | 状态 | 代码/配置提交 | 实际验证证据 |
| --- | --- | --- | --- |
| H1 CI 未覆盖 `master` | 本地关闭；外部 ruleset 待办 | `44c9861`, `4be8543`, `def8554`, `eb16a3f` | `npm run test:workflows` 22/22；真实 `master` run/ruleset 尚未执行 |
| H2 真实备份恢复演练 | **外部阻塞** | 既有 `docs/runbooks/backup-and-restore.md` | 演练表仍为“未执行”；必须由云数据库负责人完成 |
| H3 请求体无界 | 已关闭 | `da2a743`, `90fd69d` | 32 KiB、有/无 `Content-Length`、reader cancel 路径由 unit/integration 全量覆盖 |
| H4 readiness 公网开放 | 已关闭 | `68ef088` | Caddy 公共 ready 404、app 内部 ready 200（见容器验证） |
| H5 无生产容器供应链 | 本地实现；外部发布待办 | `44c9861`, `4be8543`, `def8554`, `eb16a3f` | workflow 22/22；本地构建/运行见上；GHCR/SBOM artifact/Trivy artifact/attestation 待真实 `master` run |
| M1 客户端控制 request ID | 已关闭 | `da2a743`, `90fd69d` | UUID/1–64 安全字符与 fallback 测试包含于 63 unit |
| M2 未捕获错误未统一记录 | 已关闭 | `8117304` | 路由 unknown-error 结构化日志 integration 测试包含于 85 integration |
| M3 辅助表无定期清理 | 已关闭 | `39b88c7`, `69025a2`, `402d40b` | 有界、幂等、并发安全维护测试与 CLI 验证包含于全量门禁 |
| M4 密码重置无版本校验 | 已关闭 | `0c51b44`, `86c8070` | stale version 409 和无副作用测试包含于 85 integration |
| M5 审计缺修改前数据 | 已关闭 | `0c51b44`, `86c8070` | safe before/after public user snapshot 测试包含于 85 integration |
| M6 日志脱敏不完整 | 已关闭 | `8117304` | 嵌套 password/token/cookie/secret/database URL 脱敏测试包含于 63 unit |
| M7 运行/迁移账号未分离 | 已关闭 | `06c0475`, `72e2aef`, `ba1eea2` | fresh local volume 以 migrator 完成 4 个迁移，app `SELECT 1` 成功且 `CREATE TABLE` 被拒；生产仍按 SQL runbook 建号 |
| L1 缺少 HSTS | 已关闭 | `68ef088` | Next config 测试包含于 63 unit |
| L2 Session Cookie 名称约束弱 | 已关闭 | `68ef088` | production `__Host-fenshi_session` 与 dev/test 名称测试包含于全量门禁 |
| L3 CSP 允许 inline script | **延后** | 无 | 后续 nonce CSP 专项；本阶段不声称关闭 |

## 本地数据库角色 onboarding 修复

Task 5 留下的本地 onboarding 问题已在 `ba1eea2` 修复：fresh `compose.dev.yaml` 数据卷会先
创建 `.env.example` 对应的 `fenshi_migrator` 与 `fenshi_app` 开发角色，再创建测试库。
2026-08-02 使用独立 Compose project 和宿主端口 55432 实测：4 个 Prisma migration 均由
migrator 成功部署，app role 的 `SELECT 1` 成功，永久表 DDL 返回 `permission denied for schema public`。
测试后只删除了该临时 project 及其专属数据卷。固定开发密码不得用于生产；旧本地数据卷
需要按 README 指引手动补齐角色或在确认数据可丢弃后重建。

## 外部证据回填清单

上线复核人必须把以下证据保存到 `docs/deployment-evidence/YYYY-MM-DD-stage-1/`，不得只在
聊天或口头确认：

- ruleset API 输出或截图、required checks 名称；
- pull request CI URL、`master` publish run URL 和完整 commit SHA；
- GHCR Public 状态、匿名 pull 结果和 immutable digest；
- SPDX JSON artifact、完整 Trivy High/Critical JSON 与 fixable gate 结果；
- `gh attestation verify` 输出；
- 腾讯云隔离恢复演练完整记录和负责人签字。

所有外部项完成、证据复核通过且后续业务阶段达到其自身上线门槛之前，README 的
“尚未获准上线”状态不得移除。
