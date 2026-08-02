# 腾讯云部署与回滚运行手册

## Database role separation

Run `docs/runbooks/postgresql-roles.sql` as the target database owner before
the first deployment. Keep the `fenshi_migrator` password exclusively in the
controlled migration environment. `MIGRATION_DATABASE_URL` is required only
when invoking Prisma CLI commands and must never appear in the Compose `app`
environment. The container's `DATABASE_URL` and host-only
`OPERATIONS_DATABASE_URL` use `fenshi_app` for runtime DML and administrator
commands respectively.

## Pull request E2E fixtures

The phone numbers and strong passwords declared in the pull-request CI workflow
are public, non-production test fixtures. They are created only inside the
disposable `fenshi_test` service database, which E2E global setup resets before
the tests. They must never be copied into a production or shared environment.
Keeping these values directly in the workflow makes pull requests from forks and
Dependabot runnable without repository secrets. Global setup still rejects
missing setup fixture values and any database name that does not end in `_test`;
individual test helpers likewise reject empty values before use.

## GitHub 镜像供应链发布

生产 Caddy 基线固定为 `caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d`。CI 和发布工作流都对这个确切引用生成 SPDX SBOM、保存完整 High/Critical inventory，并在任何 registry 登录/推送前阻断可修复 High/Critical。Dependabot 的 Docker 更新只能作为候选；合并前必须同时更新 tag+digest、工作流精确契约和 mutation tests，并重新保存两份扫描证据。

生产镜像固定为 `ghcr.io/oliviaprel/fenshi-order-scheduling-mvp`。Pull request 的
`CI` 工作流只在 runner 本地构建和启动镜像，并生成 SBOM、执行 High/Critical
漏洞扫描；它没有 GHCR 登录、镜像推送、OIDC 或 attestation 写权限。只有
`master` push 触发的 `Publish image` 工作流可以推送：

- `sha-<完整 40 位提交 SHA>`，用于追踪构建输入；
- `latest`，只作为人工浏览便利标签，禁止用于生产部署；
- 工作流摘要中的 `ghcr.io/oliviaprel/fenshi-order-scheduling-mvp@sha256:...`，
  这是部署和回滚必须记录的不可变引用。

首次发布后，包管理员必须在 package settings 将 GHCR package 改为
**Public**。GitHub 新 package 默认为 private，而且 public 变更不可逆；确认仓库、
包名和发布内容无误后再操作。随后从未登录 GHCR 的临时 Docker 配置验证匿名拉取：

```bash
COMMIT_SHA='替换为 master 的完整 40 位提交 SHA'
IMAGE_REF="ghcr.io/oliviaprel/fenshi-order-scheduling-mvp:sha-${COMMIT_SHA}"
anonymous_docker_config="$(mktemp -d)"
docker --config "$anonymous_docker_config" pull "$IMAGE_REF"
IMAGE_DIGEST="$(docker image inspect --format='{{index .RepoDigests 0}}' "$IMAGE_REF" | cut -d@ -f2)"
rm -rf "$anonymous_docker_config"
printf '%s\n' "ghcr.io/oliviaprel/fenshi-order-scheduling-mvp@${IMAGE_DIGEST}"
```

在对应 `Publish image` run 中确认 Trivy 步骤成功，并下载名为
`fenshi-image-<提交 SHA>.spdx.json` 的 artifact。文件内容必须是 SPDX JSON，且
artifact 对应同一个提交。用 GitHub CLI 验证 provenance：

同一个 run 还必须下载 `fenshi-image-vulnerabilities-<提交 SHA>` artifact。它是
`ignore-unfixed: false` 生成的完整 High/Critical JSON 清单，必须包含当前尚无上游
修复的发现。发布 gate 另以 `ignore-unfixed: true` 和 `exit-code: 1` 阻断所有已有
修复的 High/Critical；这是一项受控的可处置性策略，不表示镜像没有漏洞，也不得
改成忽略已有修复的漏洞。每次部署评审完整清单，发现上游新增修复后必须升级基础
镜像并清零对应项，Stage 8 将清单纳入持续审计证据。

```bash
gh attestation verify \
  "oci://ghcr.io/oliviaprel/fenshi-order-scheduling-mvp@${IMAGE_DIGEST}" \
  --repo oliviaprel/fenshi-order-scheduling-mvp
```

将 Actions run URL、提交 SHA、镜像 digest、SBOM artifact、完整 Trivy JSON、
fixable gate 结果、attestation 验证输出和 package Public 截图保存到
`docs/deployment-evidence/YYYY-MM-DD-stage-1/`。GitHub 外部配置步骤见
[`github-ruleset.md`](github-ruleset.md)。

## 目的与发布门槛

本文面向未参与开发的发布人员。生产拓扑固定为“公网 → Caddy HTTPS → 私网 Node 容器 → 腾讯云托管 PostgreSQL”，应用端口 3000 和数据库端口不得暴露到公网。

首次上线前必须同时满足：CI 全绿、镜像以不可变 digest 标识、隔离数据库恢复演练已在[演练记录表](backup-and-restore.md#演练记录)留下成功记录、变更负责人和回滚负责人在线。**验收完成前禁止导入任何真实客户数据。**

腾讯云参考：[安全组概述](https://cloud.tencent.com/document/product/213/112610)、[PostgreSQL 私网连接](https://intl.cloud.tencent.com/document/product/409/34626)、[设置 SSL 加密](https://cloud.tencent.com/document/product/409/115986)。

## 1. 准备基础设施

1. 在同一地域和 VPC 创建 CVM、子网和腾讯云 PostgreSQL 17 实例；数据库只启用私网地址，不开启公网地址。
2. CVM 安装受支持的 Linux、Docker Engine、Docker Compose 插件、Node.js 22 和 Git。启用系统安全更新和时间同步。
3. CVM 安全组入站只允许：TCP 80/443 来自公网；TCP 22 仅来自公司出口 IP 或堡垒机。不要放行 3000。
4. PostgreSQL 安全组仅允许来自应用 CVM 安全组/私网地址的数据库端口；不要允许 `0.0.0.0/0`。
5. 在 PostgreSQL 控制台“数据安全 → SSL”开启 SSL，保护实际使用的私网 VIP，下载 CA PEM。注意开启 SSL 会重启实例，应在维护窗口操作；克隆出的实例需重新开启 SSL。
6. 将域名 A/AAAA 记录指向 CVM 公网地址。Caddy 在 80/443 可达且 DNS 生效后自动申请并续期证书，并把 HTTP 重定向到 HTTPS。

## 2. 放置发布文件与 Secret

在 CVM 创建 `/opt/fenshi/release`（固定版本源码）和 `/etc/fenshi`（仅 root 与受限 `fenshi` 服务组可穿越）。复制 `compose.production.example.yaml`、`deploy/Caddyfile.example` 和腾讯云 CA PEM。`app.env` 仍只允许 root 读取，维护服务只读取单独的 `maintenance.env`。执行：

```bash
id -u fenshi >/dev/null 2>&1 || sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin fenshi
sudo install -d -m 0750 /opt/fenshi/release
sudo install -d -o root -g fenshi -m 0750 /etc/fenshi
sudo install -o root -g fenshi -m 0640 TencentDB-PG-SSL-CA.pem /etc/fenshi/tencentdb-postgresql-ca.pem
sudo touch /etc/fenshi/app.env
sudo chown root:root /etc/fenshi/app.env
sudo chmod 0600 /etc/fenshi/app.env
test "$(stat -c '%U:%G %a' /etc/fenshi)" = 'root:fenshi 750'
test "$(stat -c '%U:%G %a' /etc/fenshi/tencentdb-postgresql-ca.pem)" = 'root:fenshi 640'
test "$(stat -c '%U:%G %a' /etc/fenshi/app.env)" = 'root:root 600'
sudo -u fenshi test -r /etc/fenshi/tencentdb-postgresql-ca.pem
sudo -u fenshi test ! -r /etc/fenshi/app.env
```

`/etc/fenshi/app.env` 使用 shell/Compose 可读取的单引号值；数据库用户名和密码必须 URL 编码，不得提交或粘贴到工单、聊天和日志：

```dotenv
APP_DOMAIN='orders.example.com'
APP_IMAGE='ghcr.io/oliviaprel/fenshi-order-scheduling-mvp@sha256:替换为已验签摘要'
TENCENTDB_POSTGRESQL_CA_FILE='/etc/fenshi/tencentdb-postgresql-ca.pem'
DATABASE_URL='postgresql://fenshi_app:URL编码密码@私网VIP:5432/fenshi?sslmode=verify-full&sslrootcert=/run/secrets/tencentdb-postgresql-ca.pem'
OPERATIONS_DATABASE_URL='postgresql://fenshi_app:URL编码密码@私网VIP:5432/fenshi?sslmode=verify-full&sslrootcert=/etc/fenshi/tencentdb-postgresql-ca.pem'
MIGRATION_DATABASE_URL='postgresql://fenshi_migrator:URL编码密码@私网VIP:5432/fenshi?sslmode=verify-full&sslrootcert=/etc/fenshi/tencentdb-postgresql-ca.pem'
```

`DATABASE_URL` 供容器使用，CA 是 Docker Secret 路径；`OPERATIONS_DATABASE_URL` 只供宿主机以 `fenshi_app` 身份运行管理员命令，CA 是宿主路径；`MIGRATION_DATABASE_URL` 只供宿主机以 `fenshi_migrator` 身份执行 Prisma 迁移。它不在 Compose 的 `app` 环境中注入。以 `sudo docker compose --env-file /etc/fenshi/app.env -f compose.production.example.yaml config --quiet` 检查配置，成功时不展开 Secret。CI、镜像、仓库和 Compose 文件均不得保存真实 Secret。

## 3. 首次发布

1. 将与镜像 digest 对应的源码提交检出到 `/opt/fenshi/release`，确认 `git status --short` 为空。
2. 在受控终端仅读取当前命令需要的 Secret，不要启用 shell trace。依赖安装必须在没有生产 Secret 的环境中运行：

   ```bash
   cd /opt/fenshi/release
   env -u DATABASE_URL -u OPERATIONS_DATABASE_URL -u MIGRATION_DATABASE_URL npm ci
   set +x
   MIGRATION_DATABASE_URL="$(sudo sed -n "s/^MIGRATION_DATABASE_URL='\(.*\)'$/\1/p" /etc/fenshi/app.env)"
   MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" npm run prisma:generate
   ```

3. **先迁移，后启动新镜像**。容器入口不会自动迁移，也不得把破坏性迁移放入启动命令：

   ```bash
   MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy
   psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/runbooks/postgresql-runtime-hardening.sql
   ```

4. 首次且仅首次，在仍未开放业务流量时以交互式 TTY 创建管理员：

   ```bash
   OPERATIONS_DATABASE_URL="$(sudo sed -n "s/^OPERATIONS_DATABASE_URL='\(.*\)'$/\1/p" /etc/fenshi/app.env)"
   DATABASE_URL="$OPERATIONS_DATABASE_URL" npm run admin:create
   unset MIGRATION_DATABASE_URL OPERATIONS_DATABASE_URL
   ```

   密码应由密码管理器生成，在隐藏提示中输入；不得作为参数、环境变量或日志内容。普通用户只能由管理员登录后创建。

5. 拉取并启动：

   ```bash
   sudo docker compose --env-file /etc/fenshi/app.env -f compose.production.example.yaml pull
   sudo docker compose --env-file /etc/fenshi/app.env -f compose.production.example.yaml up -d
   ```

6. 按顺序验收；任一步失败都停止放量并进入回滚：

   ```bash
   curl --fail --silent --show-error https://orders.example.com/api/health/live
   test "$(curl --silent --output /dev/null --write-out '%{http_code}' https://orders.example.com/api/health/ready)" = "404"
   test "$(sudo docker compose --env-file /etc/fenshi/app.env -f compose.production.example.yaml exec -T app node -e \"fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.stdout.write(String(r.status)))\")" = "200"
   sudo docker compose --env-file /etc/fenshi/app.env -f compose.production.example.yaml ps
   ```

   三重门槛必须同时满足：`external live=200`、`external ready=404`、`internal ready=200`。再用管理员和一个合成普通用户完成登录、强制改密和退出烟测；不要使用真实客户数据。

## 4. 后续发布

1. 保存当前 `APP_IMAGE` digest 为回滚候选，确认其仍可从镜像仓库拉取。
2. 在新版本源码上依次运行无生产 Secret 的 `env -u DATABASE_URL -u OPERATIONS_DATABASE_URL -u MIGRATION_DATABASE_URL npm ci`、全量质量门禁、迁移，并在每次迁移后运行同一个 `docs/runbooks/postgresql-runtime-hardening.sql`；完成后 `unset MIGRATION_DATABASE_URL OPERATIONS_DATABASE_URL`。
3. 只有迁移成功后，才把 `/etc/fenshi/app.env` 的 `APP_IMAGE` 更新为新 digest并运行 `docker compose pull && docker compose up -d`。
4. 检查 live、ready、容器状态和登录烟测；记录提交 SHA、镜像 digest、迁移编号、操作者和时间。

## 5. 回滚到上一镜像

1. 如果 ready 失败或核心登录烟测失败，停止放量，但不要删除数据库、卷或备份。
2. 将 `/etc/fenshi/app.env` 的 `APP_IMAGE` 改回上一个已验证 digest。
3. 执行：

   ```bash
   sudo docker compose --env-file /etc/fenshi/app.env -f compose.production.example.yaml pull app
   sudo docker compose --env-file /etc/fenshi/app.env -f compose.production.example.yaml up -d app
   curl --fail --silent --show-error https://orders.example.com/api/health/live
   test "$(curl --silent --output /dev/null --write-out '%{http_code}' https://orders.example.com/api/health/ready)" = "404"
   ```

4. 迁移只允许前向执行；不得自动运行 schema downgrade。若旧镜像与已部署 schema 不兼容，保持流量关闭，交由数据库负责人按已审查的恢复方案处理。
5. 回滚后记录原因、镜像 digest、数据库迁移状态、健康检查和登录验证结果，并创建事件复盘。

## 6. 日常检查

- 外部监控每分钟检查 live，内部监控每分钟检查 ready；连续失败触发值班告警。
- 每天确认自动备份成功且保留期为 14 天，流程见[备份与恢复](backup-and-restore.md)。
- 每月验证 TLS 证书、腾讯云 CA、镜像仓库访问和最近一次可回滚 digest。
- Caddy 必须覆盖客户端传入的 `X-Forwarded-For`；不得把应用 3000 端口直接暴露。
