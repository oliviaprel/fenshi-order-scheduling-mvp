# Task 9 实施报告：管理员用户管理界面与真实浏览器 E2E

## 状态

- 完成管理员用户管理页面、真实 API 交互、服务端管理员边界、响应式布局和真实浏览器 E2E。
- 范围严格停留在用户管理；未实现物料、价格、订单或其他后续业务。
- 基线提交：`ba24437`。

## TDD：RED / GREEN

### RED 1：管理员页面不存在

先创建 `e2e/admin-users.spec.ts`，未改生产代码。首次有效运行：

```powershell
$env:APP_ORIGIN='http://127.0.0.1:3000'
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npm run test:e2e -- e2e/admin-users.spec.ts
```

结果：首测失败，`getByRole('heading', { name: '用户管理' })` 找不到；serial 套件其余 5 项未运行。失败原因正是 `/admin/users` 页面缺失。第一次尝试因 global setup 缺少 `APP_ORIGIN` 提前报错，补齐固定本机 origin 后才得到上述有效 RED。

### GREEN 1：完整管理员流程

最小实现后逐项推进：

- 三视口完整流程、分页先达到 4/6；
- 真实 409 已返回正确文案，修正测试与 Next route announcer 的 `role=alert` 定位歧义；
- 普通用户导航已经返回 HTTP 403，但最初落入 Next 默认英文 forbidden 边界；把中文边界放到 Next 16 实际使用的根级 `app/forbidden.tsx` 后通过；
- 最终 Task 9 定向结果：`6 passed`。

### RED / GREEN 2：生产可用页容量

自审发现最小实现每页 2 人不适合作为生产默认。先让分页 E2E 创建 9 个独立用户并断言首屏 10 条：旧实现按预期 RED，`Expected length: 10, Received length: 2`。随后仅把服务端首屏和客户端后续页的 `PAGE_SIZE` 改为 10，定向分页结果 `1 passed`，并保留真实 cursor 请求断言。

## 实现摘要

- `admin/layout.tsx` 在服务端调用 `requireAdmin()`；数据获取 page 在调用 `listManagedUsers()` 前再次独立鉴权并转换到 Next `forbidden()`，避免把 layout 当作数据访问边界。普通用户导航响应为真实 HTTP 403。
- 首屏在服务器调用 `listManagedUsers()`；搜索、下一页、上一页和刷新均调用 `/api/admin/users`。
- 创建、编辑、暂停、恢复、禁用和重置密码全部调用既有真实管理员 API。
- 编辑 PATCH 携带当前 `version`。`USER_VERSION_CONFLICT` 显示固定文案“该用户已被其他管理员修改，请刷新后重试”，并提供刷新动作。
- 禁用无论从独立操作还是编辑状态选择进入，均先展示二次确认；重置密码同样二次确认。
- 桌面使用表格；900px 及以下使用同一 state 的卡片视图。三种状态固定显示为“正常 / 已暂停 / 已禁用”。
- 列表展示创建时间和最后更新时间，使用 `Asia/Shanghai` 格式化。
- 管理员应用头部仅对管理员显示“用户管理”入口；这只是导航呈现，权限仍由服务端强制执行。

## 临时密码关闭后消失的证明

创建和重置的临时密码只写入当前对话框的 React state。点击“我已保存”时先 `setTemporaryPassword(null)`，随后父组件卸载对话框；未写 URL、localStorage、sessionStorage 或日志，也未提供持久化副本。

三个真实视口流程分别对创建密码和重置密码执行以下浏览器断言：

- 关闭后 `body` 不再包含该密码；
- 当前 URL 不包含该密码；
- `JSON.stringify(localStorage)` 与 `JSON.stringify(sessionStorage)` 不包含该密码；
- 收集的全部前端 console message 不包含该密码。

上述检查先在页面上下文和本地 predicate 中计算是否保留，仅把 boolean 交给 Playwright matcher；失败日志不会把临时密码作为 expected value 输出。

Playwright 配置保持 `trace: off`、`screenshot: off`、`video: off`，不会生成携带密码的失败产物。

## 409 冲突证明

E2E 先用 UI 打开包含当前 `version` 的编辑对话框，再通过同一真实管理员会话发起另一条真实 PATCH，让服务端版本递增。陈旧对话框提交后：

- 收到并显示固定刷新提示；
- 用真实 GET 查询确认服务端名称仍为并发更新值；
- 明确断言服务端不存在陈旧页面提交的名称；
- 点击“刷新列表”后能搜索并看到服务端最新值。

## 普通用户服务端拒绝证明

E2E 由管理员通过真实 API 创建专用普通用户，管理员真实退出后，普通用户用临时密码通过登录 UI 登录并真实改密；随后导航 `/admin/users`：

- 主文档响应状态严格为 `403`；
- 页面显示“无权访问”和“此页面仅限管理员使用”；
- 测试不伪造 Cookie，也不复用全局普通用户，避免污染其他 E2E。

## 三视口、响应式与键盘

在 `390×844`、`768×1024`、`1440×900` 三个视口均完成：创建、真实搜索、编辑为暂停、重置密码、禁用。每个视口均断言 `documentElement.scrollWidth <= innerWidth`。

- 390 和 768 使用卡片；1440 使用表格。
- “新增用户”通过聚焦后按 Enter 打开，证明关键操作可由键盘触发。
- 重置和禁用都通过 Enter 打开；modal 初始聚焦安全的“取消”，Shift+Tab 在首尾控件间圈定，Escape 关闭后恢复触发器焦点，再用 Tab+Enter 完成确认。确认完成切换到一次性密码阶段时会重新建立 modal 并聚焦“我已保存”。
- 搜索框焦点断言同时要求 outline 颜色非透明且 outline 宽度大于 0；没有只检查 `outlineStyle`，避免透明 outline 假阳性。

## 完整验证

最终提交前的新鲜全量命令使用固定 `http://127.0.0.1:3000` 与 `fenshi_test` PostgreSQL：

| 门禁 | 结果 |
|---|---|
| `npm test` | 单元 8 files / 32 tests；集成 11 files / 56 tests，全部通过 |
| `npm run test:e2e` | 14 tests 全部通过；管理员与认证文件并行运行无共享用户污染 |
| `npm run lint` | 通过，0 错误 |
| `npm run typecheck` | 通过，0 错误 |
| `npm run build` | Next.js 16.2.12 生产构建成功；`/admin/users` 为动态服务端路由 |
| `git diff --check` | 通过 |

## 变更文件

- 新建 `e2e/admin-users.spec.ts`
- 新建 `src/app/(protected)/admin/layout.tsx`
- 新建 `src/app/(protected)/admin/users/page.tsx`
- 新建 `src/app/(protected)/admin/users/page.integration.test.ts`
- 新建 `src/app/forbidden.tsx`
- 新建 `src/components/admin/user-list.tsx`
- 新建 `src/components/admin/user-form-dialog.tsx`
- 新建 `src/components/admin/reset-password-dialog.tsx`
- 新建 `src/components/ui/status-badge.tsx`
- 新建 `src/components/ui/modal-dialog.tsx`
- 修改 `src/components/app-shell.tsx`
- 修改 `src/app/(protected)/layout.tsx`
- 修改 `src/lib/api-client.ts`
- 修改 `src/app/globals.css`
- 修改 `next.config.ts`
- 新建本报告

## 自审

- 权限：layout 与实际读取用户数据的 page 都在服务器独立执行管理员 guard；page 在查询前拒绝普通用户并进入规范 forbidden boundary，而非仅隐藏按钮。
- API：客户端没有 Prisma 访问；所有写操作使用既有 API envelope，失败不伪装成功。
- 并发：编辑 payload 取打开对话框时的 `user.version`；冲突不 merge 陈旧输入。
- 密码：未新增密码日志、storage、URL 或持久化；E2E 产物捕获保持关闭。
- 状态：管理员列表只使用固定中文映射；网页不能创建或编辑 ADMIN 角色。
- 响应式：桌面与卡片渲染同一 state；所有容器允许收缩，三视口实际无横向滚动。
- 测试质量：真实 UI 登录、真实 PostgreSQL、真实 API；除制造服务端并发更新外未 route mock 管理接口。焦点检查验证可见颜色和正宽度。
- 变异检查：删除管理员 guard、version、确认步骤、状态映射、搜索/分页 fetch、密码卸载或 focus-visible 颜色，至少会使一个 E2E 断言失败。

## 独立审查与修复闭环

独立 reviewer 对 `ba24437..44ae37c` 做只读审查，结论为 0 Critical、4 Important、1 Minor。所有 finding 均已处理：

1. 新增真实 PostgreSQL page 集成测试。旧 page 在普通用户真实 Session 下返回 200（RED）；page 独立 `requireAdmin()` 后先返回 403，再进一步要求进入 `NEXT_HTTP_ERROR_FALLBACK;403` forbidden boundary，避免未处理授权异常日志，最终 GREEN。
2. 临时密码保留测试不再把秘密作为 matcher 参数，只断言页面内计算的 booleans。
3. 新增共享可访问 modal：初始焦点、Tab/Shift+Tab 圈定、Escape、触发器焦点恢复；键盘 E2E 旧实现准确 RED（取消按钮未获焦），新实现 GREEN。
4. 满页创建测试旧实现准确 RED（搜索仍为空，证明本地 prepend 保留陈旧 cursor）；创建后改为真实 API 搜索新用户、清空 cursor/history，GREEN。翻页 history 也只在请求成功后提交，处理 Minor。
5. 原 reviewer 复核确认上述问题已关闭，同时发现 secret-producing POST pending 时仍可取消的新 Important。E2E 仅延迟后继续真实创建/重置请求；旧实现 RED（pending 时取消未禁用），修复后 Escape 不关闭、取消禁用，响应到达后仍强制展示一次性密码，GREEN。复核提出的创建后 history Minor 也改为只在权威 GET 成功后清空。

## 顾虑与后续观察

- 中文 HTTP 403 依赖 Next 16 的 `experimental.authInterrupts`；当前版本构建与浏览器验证均通过，但升级 Next 时需复核该 API 是否转为稳定或发生约定变化。
- 对话框使用本地共享 modal primitive，已覆盖初始焦点、焦点圈定、Escape 和焦点恢复；若未来引入嵌套 modal 或 portal 层级，再扩展统一 primitive，本任务不增加依赖。
- 本机 D 盘运行 Next dev 偶尔报告 slow filesystem 警告；不影响测试结果，也不属于产品代码问题。
