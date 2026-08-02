# 每日维护与审计归档

## 行为与保留边界

`npm run maintenance:daily` 可安全重跑。每次运行：

- 删除 `expiresAt <= now` 的 Session 和登录预留；
- 删除 `updatedAt` 严格早于 30 天前、且 `blockedUntil` 为空或 `blockedUntil <= now` 的限速记录；
- 审计在线保留期采用 UTC 日历年。归档边界是将 `now` 的 UTC 年减 2，日期超过目标月份末日时夹紧到月末，UTC 时分秒毫秒不变；只归档 `createdAt < cutoff`，恰好位于边界的记录仍在线；
- 每次最多按 `createdAt, id` 升序归档 5000 条。UTF-8 NDJSON 先 gzip，再以 AES-256-GCM 加密；密文和 manifest 都经临时文件 `fsync` 后原子改名。Linux 还同步目录项，Windows 依赖同目录原子改名与已同步文件句柄；
- 只有密文和 manifest 均持久化成功并返回 archive ID 后，才在短事务中按本批精确 ID 和原 cutoff 删除。归档失败绝不删除审计记录；订单、订单事件和取消历史不在维护删除范围内。

并发运行可能为同一批记录生成多个有效归档，但只会删除精确快照 ID；重复归档应安全保留。生产 CVM 只配置一个定时实例，避免不必要的重复文件。`archivedAuditLogs` 是本次实际删除数，可能小于 manifest 的 `count`；即使并发导致实际删除为 0，已生成归档的 `archiveId` 仍会返回。

## 服务器配置

维护 CLI 在 CVM 宿主机运行，不能复用容器内 `/run/secrets/...` CA 路径的 `DATABASE_URL`。在仅 root 和应用运行用户可读的 `/etc/fenshi/maintenance.env` 中配置独立的宿主机运行环境（数据库角色仍是 `fenshi_app`）：

```dotenv
APP_ORIGIN='https://你的生产域名'
DATABASE_URL='postgresql://fenshi_app:URL编码密码@私网VIP:5432/fenshi?sslmode=verify-full&sslrootcert=/etc/fenshi/tencentdb-postgresql-ca.pem'
AUDIT_ARCHIVE_DIR='/var/lib/fenshi/audit-archives'
AUDIT_ARCHIVE_KEY='<32 个随机字节的规范 base64 编码>'
```

不要在 shell 历史、进程参数、工单或日志中粘贴密钥。密钥应由受控密钥管理系统生成/保存，再写入受限环境文件。不要改宽现有容器 `/etc/fenshi/app.env` 的权限；单独初始化维护文件和目录：

```bash
id -u fenshi >/dev/null 2>&1 || useradd --system --home /nonexistent --shell /usr/sbin/nologin fenshi
chgrp -R fenshi /opt/fenshi/release
chmod -R g+rX /opt/fenshi/release
chmod g+s /opt/fenshi/release
install -d -o fenshi -g fenshi -m 0700 /var/lib/fenshi/audit-archives
touch /etc/fenshi/maintenance.env
chown root:fenshi /etc/fenshi/maintenance.env
chmod 0640 /etc/fenshi/maintenance.env
```

归档目录必须纳入加密备份，并将密文与对应 `.manifest.json` 一起复制。归档密钥的保留周期不得短于归档数据；轮换时记录每批归档所用密钥的受控映射，旧密钥在其最后一批归档到期前不得销毁。

## systemd 定时器（推荐）

`/etc/systemd/system/fenshi-maintenance.service`：

```ini
[Unit]
Description=Fenshi daily maintenance
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=fenshi
Group=fenshi
WorkingDirectory=/opt/fenshi/release
EnvironmentFile=/etc/fenshi/maintenance.env
ExecStart=/usr/bin/flock -n /var/lib/fenshi/audit-archives/.maintenance.lock /usr/bin/npm run maintenance:daily
PrivateTmp=true
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/fenshi/audit-archives
UMask=0077
```

`/etc/systemd/system/fenshi-maintenance.timer`：

```ini
[Unit]
Description=Run Fenshi maintenance daily

[Timer]
OnCalendar=*-*-* 03:20:00 Asia/Shanghai
Persistent=true
RandomizedDelaySec=300
Unit=fenshi-maintenance.service

[Install]
WantedBy=timers.target
```

```bash
systemctl daemon-reload
systemctl enable --now fenshi-maintenance.timer
systemctl list-timers fenshi-maintenance.timer
```

若只能使用 cron，使用单一条目并保留互斥锁：

```cron
20 3 * * * /bin/bash -o pipefail -c 'set -a; . /etc/fenshi/maintenance.env; set +a; cd /opt/fenshi/release && /usr/bin/flock -n /var/lib/fenshi/audit-archives/.maintenance.lock /usr/bin/npm run maintenance:daily 2>&1 | /usr/bin/logger -t fenshi-maintenance'
```

不要同时启用 systemd timer 和 cron。

## 输出、日志轮转与告警

成功时 stdout 只有一行 JSON，例如：

```json
{"expiredSessions":2,"expiredReservations":1,"staleThrottles":3,"archivedAuditLogs":5000,"archiveId":"b0d695d0-6fc4-47bc-9886-a5db6340871d"}
```

没有待归档记录时 `archiveId` 为 `null`。失败时退出码非零，stderr 只有安全错误码 `{"error":"MAINTENANCE_FAILED"}`；CLI 不输出审计记录、数据库连接串或归档密钥。

使用 journald 时由平台统一限制容量与保留期（例如在 `/etc/systemd/journald.conf.d/fenshi.conf` 设置 `SystemMaxUse=1G`、`MaxRetentionSec=30day`）。cron 若改为文件日志，必须配置 `logrotate`，不得无限增长。

监控每天检查 unit 最近一次退出码和运行时间；非零退出、24 小时未成功、归档目录不可写、磁盘剩余空间低于阈值都应告警。查看证据：

```bash
systemctl status fenshi-maintenance.service
journalctl -u fenshi-maintenance.service --since '2 days ago' --output=cat
```

## 手工重跑

先确认没有定时实例运行，再以应用用户和相同环境执行：

```bash
systemctl is-active fenshi-maintenance.service
sudo -u fenshi /usr/bin/flock -n /var/lib/fenshi/audit-archives/.maintenance.lock \
  /usr/bin/env --chdir=/opt/fenshi/release \
  bash -c 'set -a; source /etc/fenshi/maintenance.env; set +a; npm run maintenance:daily'
```

故障修复后连续执行两次是允许的；第二次通常返回零删除。如果第一批正好达到 5000 条，应继续重跑，直到 `archivedAuditLogs` 为 0。不要手工删除在线审计记录或不完整归档。

## 归档校验与恢复

恢复只在隔离主机进行。把密文、manifest 和对应历史密钥放入受限目录；不要把解密后的记录输出到终端。下面命令验证 SHA-256 与 GCM tag、解压并以 `0600` 新建 NDJSON 文件，同时核对行数：

```bash
read -r -s -p 'Archive key: ' AUDIT_ARCHIVE_KEY
printf '\n'
export AUDIT_ARCHIVE_KEY
MANIFEST=/secure/restore/audit-ARCHIVE_ID.manifest.json
ARCHIVE_DIR=/secure/restore
RESTORED=/secure/restore/restored.ndjson
node --input-type=module - "$MANIFEST" "$ARCHIVE_DIR" "$RESTORED" <<'NODE'
import { createDecipheriv, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const [manifestPath, archiveDirectory, outputPath] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (basename(manifest.filename) !== manifest.filename) throw new Error('Unsafe filename');
const ciphertext = await readFile(join(archiveDirectory, manifest.filename));
const digest = createHash('sha256').update(ciphertext).digest('hex');
if (digest !== manifest.ciphertextSha256) throw new Error('Ciphertext digest mismatch');
const key = Buffer.from(process.env.AUDIT_ARCHIVE_KEY ?? '', 'base64');
if (key.length !== 32) throw new Error('Invalid archive key');
const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(manifest.iv, 'base64'));
decipher.setAuthTag(Buffer.from(manifest.authenticationTag, 'base64'));
const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
const ndjson = gunzipSync(compressed);
const count = ndjson.toString('utf8').split('\n').filter(Boolean).length;
if (count !== manifest.count) throw new Error('Record count mismatch');
await writeFile(outputPath, ndjson, { flag: 'wx', mode: 0o600 });
NODE
unset AUDIT_ARCHIVE_KEY
```

在隔离环境逐行解析并核对预期 ID、时间范围和数量后，再由数据库负责人制定显式导入方案。不要把恢复脚本直接指向生产库，也不要因恢复归档而覆盖现有审计记录。
