# PostgreSQL 备份与恢复演练运行手册

## 策略与责任

- 数据库：腾讯云托管 PostgreSQL，使用私网 TLS；生产不得使用 Compose 自建数据库。
- 数据备份：每天自动全量备份，保留 **14 天**；日志备份同样至少保留 14 天，以保持可用的时间点恢复窗口。
- 数据库负责人每天确认最近一次备份成功，每周确认可恢复时间范围，每次演练后由发布负责人复核记录。
- 首次上线验收前必须在新的隔离数据库完成一次真实恢复演练。没有云实例和凭据时只能准备步骤，不能把本地迁移或测试冒充云端恢复。

腾讯云参考：[自动备份设置](https://cloud.tencent.com/document/product/409/68388)、[备份数据](https://cloud.tencent.com/document/product/409/33945)、[克隆实例](https://cloud.tencent.com/document/product/409/68277)。腾讯云支持按备份集或时间点克隆成新实例；克隆过程不影响源实例。

## 配置每日备份

1. 登录腾讯云 PostgreSQL 控制台，选择正确地域和生产实例 ID。
2. 打开“备份恢复 → 自动备份设置”，选择业务低峰窗口，设置每天自动备份、数据备份保留 14 天。
3. 开启日志备份并设置至少 14 天；关闭日志备份会失去时间点恢复能力。
4. 保存后截图/导出实例 ID、设置和修改时间到受控运维记录，不要包含密码或连接串。
5. 次日确认自动备份状态成功、时间落在窗口内，并检查“可恢复时间范围”覆盖预期 RPO。

## 隔离恢复演练前置条件

- 负责人已获授权创建临时计费实例，并有腾讯云控制台权限。
- 源必须是专用演练实例或已批准的生产备份；目标必须是**新的隔离实例**，名称包含 `restore-drill-YYYYMMDD`，不得覆盖原实例。
- 目标与源处于同一地域/VPC、PostgreSQL 大版本一致；目标安全组只允许演练 CVM。
- 准备两个合成账号（ADMIN、USER）及独立密码管理器记录；禁止导入真实客户数据。
- 记录演练开始时间、源实例 ID、目标实例 ID、操作者。RPO 是选定备份时间点与演练基准时间的差；RTO 是开始恢复到全部校验通过的时长。

## 执行演练

1. 将应用指向源演练实例，运行 `npx prisma migrate deploy`。交互运行 `npm run admin:create` 创建合成管理员，再从管理页面创建合成普通用户并完成一次登录。
2. 记录源端基线，不得导出密码字段：

   ```sql
   SELECT "role", count(*) FROM "User" GROUP BY "role" ORDER BY "role";
   SELECT count(*) AS session_count FROM "Session";
   SELECT migration_name, finished_at
   FROM "_prisma_migrations"
   ORDER BY finished_at DESC NULLS LAST;
   ```

3. 在腾讯云“备份恢复”发起手动备份，等待状态为成功，记录备份 ID、备份时间点和完成时间。
4. 在备份列表选择“克隆”，**按该备份集**创建新的隔离实例。不要选择原实例回档。记录恢复开始和克隆可用时间。
5. 克隆完成后重新开启 SSL（克隆实例默认不开启 SSL），下载该实例 CA 到演练 CVM 的 `/etc/fenshi/restore-drill/tencentdb-postgresql-ca.pem`，权限设为 0600。记录源和克隆实例 ID 并执行防误连检查：

   ```bash
   set -euo pipefail
   read -r -p "源实例 ID: " SOURCE_INSTANCE_ID
   read -r -p "克隆实例 ID: " RESTORE_CLONE_INSTANCE_ID
   test -n "$SOURCE_INSTANCE_ID" && test -n "$RESTORE_CLONE_INSTANCE_ID"
   test "$SOURCE_INSTANCE_ID" != "$RESTORE_CLONE_INSTANCE_ID" || { echo "拒绝：恢复目标与源实例相同" >&2; exit 1; }
   export RESTORE_CA_FILE='/etc/fenshi/restore-drill/tencentdb-postgresql-ca.pem'
   test -r "$RESTORE_CA_FILE" || { echo "克隆实例 CA 不可读" >&2; exit 1; }
   ```

   从密码管理器粘贴两条只指向**克隆私网地址**的 URL；第一条供容器使用，CA 路径必须是 `/run/secrets/restore-postgresql-ca.pem`，第二条供宿主命令使用，CA 路径必须是 `$RESTORE_CA_FILE`。不得复用生产 `DATABASE_URL`、`/etc/fenshi/app.env` 或生产 app 容器。

   ```bash
   read -r -s -p "克隆库容器 DATABASE_URL: " RESTORE_DATABASE_URL; printf '\n'
   read -r -s -p "克隆库宿主 OPERATIONS_DATABASE_URL: " RESTORE_OPERATIONS_DATABASE_URL; printf '\n'
   export RESTORE_DATABASE_URL RESTORE_OPERATIONS_DATABASE_URL
   # URL 形状：postgresql://用户:URL编码密码@克隆私网VIP:5432/fenshi?sslmode=verify-full&sslrootcert=对应CA绝对路径
   ```

6. 在发布源码目录用宿主专用 URL 验证迁移状态并运行同一组只读计数：

   ```bash
   DATABASE_URL="$RESTORE_OPERATIONS_DATABASE_URL" npx prisma migrate status
   psql "$RESTORE_OPERATIONS_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT "role", count(*) FROM "User" GROUP BY "role" ORDER BY "role";'
   psql "$RESTORE_OPERATIONS_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS session_count FROM "Session";'
   ```

7. 创建并启动只含 app 和临时 Caddy 的隔离 Compose project。镜像必须是本次发布候选的不可变 digest；HTTPS 端口只绑定 `127.0.0.1`。临时 Caddy 只为生产环境的 `Secure` Session Cookie 提供本机 HTTPS，不接触生产 Caddy。以下临时文件不包含 URL 值，只引用当前 shell 的克隆库变量：

   ```bash
   export RESTORE_APP_IMAGE='registry.example.com/fenshi-order-scheduling-mvp@sha256:替换为候选摘要'
   export RESTORE_APP_PORT='3443'
   export RESTORE_ORIGIN="https://127.0.0.1:${RESTORE_APP_PORT}"
   export RESTORE_PROJECT="fenshi-restore-drill-$(date -u +%Y%m%d%H%M%S)"
   export RESTORE_COMPOSE_FILE="/tmp/${RESTORE_PROJECT}.compose.yaml"
   export RESTORE_CADDY_FILE="/tmp/${RESTORE_PROJECT}.Caddyfile"
   export RESTORE_CADDY_CA_FILE="/tmp/${RESTORE_PROJECT}.root.crt"
   umask 077
   cat >"$RESTORE_CADDY_FILE" <<'CADDY'
   {
     admin off
   }
   https://127.0.0.1 {
     tls internal
     reverse_proxy app:3000
   }
   CADDY

   cat >"$RESTORE_COMPOSE_FILE" <<'YAML'
   services:
     app:
       image: ${RESTORE_APP_IMAGE:?set immutable restore candidate image}
       restart: "no"
       environment:
         NODE_ENV: production
         APP_ORIGIN: ${RESTORE_ORIGIN:?set localhost restore origin}
         DATABASE_URL: ${RESTORE_DATABASE_URL:?set clone-only database URL}
       expose:
         - "3000"
       volumes:
         - type: bind
           source: ${RESTORE_CA_FILE:?set clone CA file}
           target: /run/secrets/restore-postgresql-ca.pem
           read_only: true
       healthcheck:
         test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
         interval: 5s
         timeout: 3s
         retries: 12
         start_period: 10s
     caddy:
       image: caddy:2.10-alpine
       restart: "no"
       depends_on:
         app:
           condition: service_started
       ports:
         - "127.0.0.1:${RESTORE_APP_PORT:?set restore port}:443"
       volumes:
         - type: bind
           source: ${RESTORE_CADDY_FILE:?set restore Caddyfile}
           target: /etc/caddy/Caddyfile
           read_only: true
         - caddy-data:/data
         - caddy-config:/config
   volumes:
     caddy-data:
     caddy-config:
   YAML

   cleanup_restore_app() {
     docker compose --project-name "$RESTORE_PROJECT" -f "$RESTORE_COMPOSE_FILE" down --volumes --remove-orphans
     rm -f "$RESTORE_COMPOSE_FILE" "$RESTORE_CADDY_FILE" "$RESTORE_CADDY_CA_FILE"
   }
   trap 'cleanup_restore_app || true' EXIT

   docker compose --project-name "$RESTORE_PROJECT" -f "$RESTORE_COMPOSE_FILE" config --quiet
   docker compose --project-name "$RESTORE_PROJECT" -f "$RESTORE_COMPOSE_FILE" up -d --wait --wait-timeout 90
   docker compose --project-name "$RESTORE_PROJECT" -f "$RESTORE_COMPOSE_FILE" \
     cp caddy:/data/caddy/pki/authorities/local/root.crt "$RESTORE_CADDY_CA_FILE"
   chmod 0600 "$RESTORE_CADDY_CA_FILE"
   curl --fail --silent --show-error --cacert "$RESTORE_CADDY_CA_FILE" "$RESTORE_ORIGIN/api/health/live"
   curl --fail --silent --show-error --cacert "$RESTORE_CADDY_CA_FILE" "$RESTORE_ORIGIN/api/health/ready"
   ```

   该 project 名称、网络、app 和 Caddy 容器必须独立于生产栈；此演练不绑定 80/443，也不得对生产 Compose project 执行 `up`、`down` 或 Secret 更新。数据库连接仍使用 `sslmode=verify-full`；HTTP 烟测使用临时 Caddy CA，禁止用 `--insecure` 绕过任一 TLS 校验。

8. 用下列函数分别对合成 ADMIN 和 USER 执行登录及 `/api/me` 烟测。密码通过隐藏输入和 stdin 发送，不进入命令历史或 curl 参数；输出只用于核对角色/状态，不保存 Cookie：

   ```bash
   login_smoke() (
     local label="$1" phone password cookie_file
     read -r -p "${label} 手机号: " phone
     read -r -s -p "${label} 密码: " password; printf '\n'
     cookie_file="$(mktemp)"
     trap 'rm -f "$cookie_file"' EXIT
     chmod 0600 "$cookie_file"
     DRILL_PHONE="$phone" DRILL_PASSWORD="$password" node -e 'process.stdout.write(JSON.stringify({phone:process.env.DRILL_PHONE,password:process.env.DRILL_PASSWORD}))' |
       curl --fail --silent --show-error \
         --cacert "$RESTORE_CADDY_CA_FILE" \
         --header 'content-type: application/json' \
         --header "origin: ${RESTORE_ORIGIN}" \
         --data-binary @- \
         --cookie-jar "$cookie_file" \
         "$RESTORE_ORIGIN/api/auth/login" >/dev/null
     curl --fail --silent --show-error --cacert "$RESTORE_CADDY_CA_FILE" --cookie "$cookie_file" "$RESTORE_ORIGIN/api/me"
   )

   login_smoke ADMIN
   login_smoke USER
   ```

9. 对比源/目标角色计数、Session 计数、迁移列表和登录结果。再次查询源端计数，确认克隆演练没有改动原数据库；记录 RPO、RTO、全部校验和异常。记录完成后只清理独立演练 project 和临时 Compose 文件：

   ```bash
   cleanup_restore_app
   trap - EXIT
   unset RESTORE_DATABASE_URL RESTORE_OPERATIONS_DATABASE_URL RESTORE_APP_IMAGE RESTORE_APP_PORT RESTORE_ORIGIN RESTORE_PROJECT RESTORE_COMPOSE_FILE RESTORE_CADDY_FILE RESTORE_CADDY_CA_FILE
   ```

   确认演练容器和网络已消失、生产 app 仍在运行。只有负责人签字且记录完整后，才可按腾讯云变更流程销毁临时克隆实例；销毁前再次核对目标实例 ID 与生产实例 ID 不同。克隆 CA 在实例销毁并完成证据留存后由负责人单独删除。

## 失败处理

- 克隆或校验失败：保留目标实例、腾讯云任务 ID、应用结构化日志和时间线，禁止修改源实例；转入[事件响应](incident-response.md)。
- 数据计数不一致：停止上线，记录具体表和差异，确认选取的备份时间点与迁移版本后重新演练。
- 登录失败但计数一致：检查 SSL、`APP_ORIGIN`、用户状态、`mustChangePassword` 和 Session；不得通过关闭 TLS 绕过。

## 演练记录

每次演练新增一行；备份 ID/实例 ID 可写受控工单链接，不写连接串、密码或 Token。

| 日期 | 源/目标实例 | 备份标识与时间点 | RPO | RTO | 迁移/计数/ADMIN 登录/USER 登录/源库不变 | 结论与负责人 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-01 | — | — | — | — | 未执行 | **阻断**：当前开发环境没有腾讯云托管 PostgreSQL 实例、恢复权限或凭据；首次上线验收前必须由云数据库负责人完成真实隔离恢复并把成功证据补入本表。负责人待指派。 |
