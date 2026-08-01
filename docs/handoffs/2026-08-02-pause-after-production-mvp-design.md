# 2026-08-02 生产加固与业务 MVP 设计暂停交接

## 当前状态

- 仓库：`D:\Projects\Codingproject\fenshi-order-scheduling-mvp`
- 分支：`master`
- 设计提交：`bcdc6d7 docs: design production hardening and business MVP`
- GitHub：`https://github.com/oliviaprel/fenshi-order-scheduling-mvp`
- 当前阶段：设计已由用户逐节确认、写入并完成自审；尚未创建实施计划，也未修改业务代码。

## 已确认范围

总体项目按以下顺序拆为五个独立验收阶段：

1. 生产加固；
2. 客户、物料和专属价格；
3. 用户订单闭环；
4. 管理员确认与排期；
5. 焚烧任务与通知。

关键决策包括：独立 Customer 可选关联 User、人民币分整数、稳定提交日订单号、管理员可编辑尚未焚烧的已确认订单、取消留痕、公开 GHCR、`master` PR+CI、运行/迁移数据库账号分离、CVM 每日维护 CLI、审计日志两年归档、订单历史永久保留。

## 设计来源

- 原始需求：`C:\Users\Administrator\Downloads\轻量焚烧订单排期系统_需求与执行文档_v1.0.md`
- 已确认 v4 原型和修订文档：`D:\Projects\Codingproject\下单程序\docs\superpowers\specs\`
- 外部上线审计：`C:\Users\Administrator\.codex\attachments\693c1d54-e7ae-4d60-8098-084be9e68d0e\pasted-text.txt`
- 正式设计：`docs/superpowers/specs/2026-08-02-production-hardening-business-mvp-design.md`

## 下次继续

1. 请用户审阅正式设计文档并确认是否需要修改。
2. 用户确认文档后，读取并使用 `superpowers:writing-plans`，把五阶段设计写成详细实施计划。
3. 在实施计划获批前不要修改业务代码。
4. 实施时优先完成生产加固，并使用 TDD、独立审查和阶段验收。
5. 腾讯云 PostgreSQL 真实恢复演练仍是外部上线门槛；完成前不得承载真实业务数据。

## 当前未执行事项

- 设计提交尚未推送到 GitHub。
- 尚未创建实现分支或工作树。
- 尚未编写新的实施计划。
- 尚未执行任何第二阶段数据库迁移或业务实现。
