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
5. 克隆完成后重新开启 SSL（克隆实例默认不开启 SSL），下载该实例 CA，并创建只指向克隆私网地址的 `RESTORE_DATABASE_URL`。
6. 在发布源码目录验证迁移状态并运行同一组只读计数：

   ```powershell
   $env:DATABASE_URL=$env:RESTORE_DATABASE_URL
   npx prisma migrate status
   psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -c 'SELECT "role", count(*) FROM "User" GROUP BY "role" ORDER BY "role";'
   psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS session_count FROM "Session";'
   ```

7. 启动一套只绑定内网/本机的临时应用指向克隆实例。分别用合成管理员和普通用户登录，访问 `/api/me`，再退出；禁止运行 E2E 全局初始化，因为它会清空测试数据库。
8. 对比源/目标角色计数、Session 计数、迁移列表和登录结果。再次查询源端计数，确认克隆演练没有改动原数据库。
9. 记录 RPO、RTO、全部校验和异常。只有负责人签字且记录完整后，才可按腾讯云变更流程销毁临时克隆实例；销毁前再次核对目标实例 ID 与生产实例 ID 不同。

## 失败处理

- 克隆或校验失败：保留目标实例、腾讯云任务 ID、应用结构化日志和时间线，禁止修改源实例；转入[事件响应](incident-response.md)。
- 数据计数不一致：停止上线，记录具体表和差异，确认选取的备份时间点与迁移版本后重新演练。
- 登录失败但计数一致：检查 SSL、`APP_ORIGIN`、用户状态、`mustChangePassword` 和 Session；不得通过关闭 TLS 绕过。

## 演练记录

每次演练新增一行；备份 ID/实例 ID 可写受控工单链接，不写连接串、密码或 Token。

| 日期 | 源/目标实例 | 备份标识与时间点 | RPO | RTO | 迁移/计数/ADMIN 登录/USER 登录/源库不变 | 结论与负责人 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-01 | — | — | — | — | 未执行 | **阻断**：当前开发环境没有腾讯云托管 PostgreSQL 实例、恢复权限或凭据；首次上线验收前必须由云数据库负责人完成真实隔离恢复并把成功证据补入本表。负责人待指派。 |
