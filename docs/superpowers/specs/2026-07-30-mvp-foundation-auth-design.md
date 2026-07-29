# 轻量焚烧订单排期系统 MVP：基础、认证与用户管理设计

## 1. 背景与目标

现有 `fenshi-order-scheduling-demo` 是用于确认流程和界面的交互原型。它采用浏览器 `localStorage`、模拟身份切换、固定演示日期和 Cloudflare Sites 托管，不承载真实客户、价格或订单。

生产 MVP 新建独立仓库 `fenshi-order-scheduling-mvp`。第一阶段只建立可信的安全边界：

- 标准 Next.js Node.js 应用；
- PostgreSQL 数据库和 Prisma 迁移；
- 手机号密码登录；
- 数据库 Session；
- 管理员与普通用户角色；
- 用户账号创建、修改、暂停、停用、恢复和密码重置；
- 审计日志；
- CI、Docker 和腾讯云部署基础。

本阶段不实现物料、专属价格、订单、每日任务或通知。后续阶段在本阶段的身份、权限和数据基础上逐步接入。

## 2. 已确认决策

- 使用独立代码仓库，不在原型仓库中改造。
- 生产运行架构采用 Next.js 模块化单体。
- 使用标准 Node.js Runtime，不使用 vinext 或 Cloudflare Worker。
- 使用腾讯云服务器运行 Docker 化应用。
- 使用腾讯云 PostgreSQL 托管实例作为唯一数据库。
- 使用 Prisma 管理数据库模型和迁移。
- 使用自建不透明数据库 Session，不采用 JWT 保存用户权限。
- 首个管理员通过服务器交互命令创建。
- 网页端不开放注册，也不创建其他管理员。
- 第一阶段完成安全基础和用户管理，同时维护完整后续路线图。

## 3. 非目标

第一阶段不包含：

- 物料、别名、默认价格和用户专属价格；
- 订单创建、复制文本、确认、取消和焚烧；
- 每日订单与物料汇总；
- 站内通知；
- 在线支付、短信、微信推送、物流、库存或开放注册；
- 将原型中的 `localStorage` 数据迁移为生产数据；
- 自动导入任何真实客户信息。

原型界面可作为视觉参考，但不得复制其模拟权限、模拟数据或本地状态架构。

## 4. 总体架构

### 4.1 运行结构

```text
浏览器
  ↓ HTTPS
反向代理
  ↓
Next.js Node.js 容器
  ├─ 页面与路由
  ├─ Route Handlers
  ├─ auth / users / permissions 服务
  └─ Prisma
       ↓ TLS
腾讯云 PostgreSQL
```

应用采用一个代码仓库和一个部署单元。页面与服务端 API 共用领域服务和校验规则，但浏览器组件不能直接访问 Prisma。

### 4.2 模块边界

```text
src/
  app/
    (auth)/login/
    (auth)/change-password/
    (user)/home/
    admin/users/
    api/auth/
    api/admin/users/
    api/health/
  features/
    auth/
    users/
  server/
    auth/
    users/
    permissions/
    audit/
    db/
    validation/
  components/
  lib/
prisma/
  schema.prisma
  migrations/
  seed/
tests/
  unit/
  integration/
  e2e/
```

模块职责：

- `server/auth`：密码、登录、Session 创建和撤销。
- `server/permissions`：`requireSession()`、`requireAdmin()` 和账号状态检查。
- `server/users`：用户创建、资料修改、状态流转和密码重置。
- `server/audit`：记录关键管理和认证事件。
- `server/db`：Prisma 客户端和事务边界。
- `server/validation`：Zod 输入模型和手机号标准化。

任何模块不得通过前端按钮是否显示来判断权限。

## 5. 数据模型

### 5.1 User

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | UUID | 主键 |
| `role` | enum | `ADMIN` / `USER` |
| `displayName` | string | 去除首尾空格，1–50 字符 |
| `phone` | string | 标准化后的中国大陆手机号，唯一 |
| `passwordHash` | string | Argon2id 哈希 |
| `status` | enum | `ACTIVE` / `PAUSED` / `DISABLED` |
| `mustChangePassword` | boolean | 新建或重置后为 `true` |
| `passwordChangedAt` | datetime | 密码最后修改时间 |
| `version` | integer | 乐观并发控制，初始为 1 |
| `createdAt` | datetime | UTC |
| `updatedAt` | datetime | UTC |

手机号输入允许包含 `+86`、空格或连字符，保存前统一转换为 11 位号码，并验证 `^1[3-9]\d{9}$`。

网页管理员只能创建 `USER`。额外 `ADMIN` 只能通过服务器命令创建。

### 5.2 Session

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | UUID | 主键 |
| `tokenHash` | string | SHA-256，唯一 |
| `userId` | UUID | 外键 |
| `createdAt` | datetime | UTC |
| `lastSeenAt` | datetime | UTC |
| `expiresAt` | datetime | 最长 7 天 |

浏览器只保存随机 Session Token。数据库只保存 Token 哈希。删除 Session 即撤销登录。

### 5.3 LoginThrottle

| 字段 | 类型 | 规则 |
|---|---|---|
| `keyHash` | string | 手机号或来源 IP 的不可逆哈希 |
| `windowStartedAt` | datetime | 统计窗口 |
| `failureCount` | integer | 失败次数 |
| `blockedUntil` | datetime nullable | 解锁时间 |

限速规则：

- 同一标准化手机号或来源 IP 在 15 分钟内最多失败 5 次；
- 超限后阻止登录 15 分钟；
- 登录成功后清除该手机号的失败记录；
- 返回统一错误，不暴露手机号是否存在。

### 5.4 AuditLog

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | UUID | 主键 |
| `actorUserId` | UUID nullable | 初始化管理员时允许为空 |
| `action` | string | 稳定动作名 |
| `targetType` | string | 例如 `USER` |
| `targetId` | UUID nullable | 目标对象 |
| `beforeJson` | JSONB nullable | 不含密码或 Token |
| `afterJson` | JSONB nullable | 不含密码或 Token |
| `requestId` | string nullable | 关联请求日志 |
| `createdAt` | datetime | UTC |

必须记录：

- 管理员初始化；
- 登录成功和退出；
- 用户创建和资料修改；
- 用户暂停、停用、恢复；
- 用户改密和管理员重置密码。

登录失败只记录安全事件摘要，不记录输入密码或完整 Session Token。

## 6. 认证与 Session

### 6.1 密码

- 使用 Argon2id。
- 密码长度为 10–72 个字符。
- 密码不得出现在日志、审计记录、异常信息或数据库明文字段中。
- 管理员创建用户或重置密码时输入临时密码。
- 临时密码登录后，只能访问改密和退出接口。
- 改密成功后撤销该用户其他 Session，并为当前浏览器创建新 Session。

### 6.2 Cookie

Cookie 名称为 `fenshi_session`，属性：

- `HttpOnly`;
- 生产环境 `Secure`;
- `SameSite=Lax`;
- `Path=/`;
- `Max-Age=604800`。

Session Token 使用密码学安全随机数生成，至少 32 字节。应用不得把角色、账号状态或业务权限编码进 Cookie。

### 6.3 Session 规则

- 每次受保护请求从 Cookie 读取 Token，计算哈希后查询 Session 和 User。
- Session 不存在、过期或账号为 `DISABLED` 时清除 Cookie 并返回未认证。
- `PAUSED` 用户允许登录；后续订单阶段由服务端禁止创建和修改订单。
- `DISABLED` 用户不能登录，停用操作在同一事务内删除其全部 Session。
- 用户修改密码或管理员重置密码后撤销旧 Session。
- 退出只删除当前 Session。
- `lastSeenAt` 最多每 15 分钟更新一次，避免每个请求都写数据库。

## 7. 首个管理员初始化

提供交互命令：

```bash
npm run admin:create
```

命令行为：

1. 连接目标数据库；
2. 交互输入显示名称和手机号；
3. 隐藏输入密码与确认密码；
4. 执行与网页相同的手机号和密码校验；
5. 检查手机号唯一性；
6. 创建 `ACTIVE ADMIN`，`mustChangePassword=false`；
7. 写入 `ADMIN_BOOTSTRAPPED` 审计记录；
8. 不输出密码或密码哈希。

命令可重复用于创建额外管理员，但不能覆盖现有账号。

## 8. 第一阶段页面与流程

### 8.1 登录页

- 手机号、密码输入；
- 统一错误提示；
- 登录中状态；
- 不提供注册、找回密码或短信验证码；
- 已登录用户根据角色跳转到用户首页或管理员用户管理页。

### 8.2 强制改密页

- 输入当前临时密码、新密码和确认密码；
- 改密成功后撤销旧 Session，创建新 Session；
- `mustChangePassword=true` 时，除退出、当前用户信息和改密外的受保护请求均拒绝。

### 8.3 用户首页

第一阶段只展示：

- 当前显示名称；
- 账号状态；
- 修改密码；
- 退出；
- “订单功能将在后续阶段接入”的明确说明。

不展示虚假的订单或价格数据。

### 8.4 管理员用户管理

管理员可以：

- 查看用户列表；
- 按姓名或手机号搜索；
- 创建普通用户；
- 修改显示名称和手机号；
- 在 `ACTIVE`、`PAUSED`、`DISABLED` 之间切换；
- 重置临时密码；
- 查看账号创建和最后更新时间。

约束：

- 不物理删除用户；
- 网页端不能修改角色；
- 管理员不能通过用户管理页面停用或修改管理员账号；
- 更新请求必须携带当前 `version`；版本不一致返回 `409` 并要求刷新。

## 9. 服务端接口

认证：

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `GET /api/me`

管理员用户管理：

- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/reset-password`

健康检查：

- `GET /api/health/live`：进程可响应，不查询数据库。
- `GET /api/health/ready`：执行轻量数据库查询。

所有写接口必须：

- 使用 Zod 校验请求；
- 验证请求 `Origin` 与应用允许域名一致；
- 验证 Session、角色、账号状态和强制改密状态；
- 使用明确 DTO，不接收 Prisma 模型或宽泛 `Partial<User>`；
- 在事务内完成状态修改、Session 撤销和审计记录；
- 返回稳定的错误码和安全文案。

## 10. 错误模型

```ts
type ApiError = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId: string;
};
```

状态码：

- `401`：未登录或 Session 已失效；
- `403`：角色不足、账号停用或必须先改密；
- `404`：目标不存在；
- `409`：手机号重复或版本冲突；
- `422`：输入校验失败；
- `429`：登录限速；
- `500`：未知服务器错误。

生产环境的 `500` 只返回通用文案和 `requestId`，不返回堆栈、SQL、环境变量或内部路径。

## 11. 测试策略

### 11.1 单元测试

- 手机号标准化和非法手机号；
- 密码长度边界；
- Session Token 生成、哈希和过期判断；
- `ACTIVE`、`PAUSED`、`DISABLED` 权限；
- 强制改密限制；
- 登录限速窗口；
- 审计数据脱敏。

### 11.2 PostgreSQL 集成测试

- Prisma 迁移可在空数据库执行；
- 管理员初始化；
- 登录成功、错误密码和统一错误；
- 手机号唯一约束；
- 创建用户和强制改密；
- 用户自行改密后旧 Session 失效；
- 管理员重置密码后全部 Session 失效；
- 暂停用户仍能登录；
- 停用用户无法登录，已有 Session 失效；
- 乐观锁冲突；
- 每个管理动作产生正确审计记录。

集成测试使用独立 PostgreSQL 测试库，不使用 SQLite 替代。

### 11.3 Playwright

- 管理员登录并创建用户；
- 新用户使用临时密码登录并被强制改密；
- 改密后进入用户首页；
- 普通用户访问 `/admin/users` 被拒绝；
- 普通用户调用管理 API 返回 `403`；
- 管理员暂停用户后用户仍可登录；
- 管理员停用用户后其现有页面失去访问权限；
- 管理员重置密码后旧密码不能登录。

## 12. CI 门禁

GitHub Actions 使用 PostgreSQL Service Container，依次运行：

```bash
npm ci
npm run lint
npm run typecheck
npm run prisma:validate
npm run prisma:migrate:test
npm run test
npm run test:integration
npm run test:e2e
npm run build
npm audit --omit=dev
```

任何步骤失败均阻止合并。生产依赖审计发现 High 或 Critical 漏洞时阻止发布；误报必须形成书面豁免并注明到期时间。

## 13. 部署与运维基础

### 13.1 Docker

- 使用多阶段构建；
- 运行镜像不包含开发依赖；
- 使用非 root 用户；
- 只暴露应用端口；
- 容器启动前执行已审核的 Prisma 部署迁移；
- 健康检查调用 `/api/health/live`。

### 13.2 腾讯云

- 腾讯云服务器运行应用容器和 HTTPS 反向代理；
- PostgreSQL 使用腾讯云托管实例，不与应用共用服务器；
- 应用通过 TLS 连接数据库；
- 数据库账号仅拥有应用所需权限；
- 安全组只允许必要端口；
- 生产环境变量保存在服务器受限文件或腾讯云密钥服务中，不提交 Git。

### 13.3 备份与日志

- PostgreSQL 每日自动备份，默认保留 14 天；
- 第一阶段完成前进行一次测试库恢复演练；
- 应用输出结构化 JSON 日志；
- 日志包含 `requestId`、路由、结果和耗时；
- 日志不包含密码、Session Token、密码哈希或完整手机号；
- 为存活检查和就绪检查配置外部监控。

### 13.4 第一阶段部署验收

- 在测试环境完成真实 Docker 部署；
- 连接独立测试 PostgreSQL；
- 完成管理员初始化、用户创建、登录、改密、暂停、停用和恢复流程；
- 完成数据库备份和恢复演练；
- 不录入真实客户数据。

## 14. 后续阶段路线图

### 阶段 2：物料库与专属价格

- 物料、别名、单位、软停用和排序；
- 默认价格和用户专属价格；
- 金额以人民币“分”的整数存储；
- 用户只能读取自己的有效价格；
- 物料和价格操作进入审计日志。

### 阶段 3：用户订单

- 服务端可信定价；
- 订单创建、待确认编辑和软取消；
- 订单归属检查；
- UUID、唯一订单号和价格快照；
- 严格复制文本；
- 用户不能通过请求修改可信价格。

### 阶段 4：管理员核对与锁定

- 明确确认 DTO 和 Zod 校验；
- 管理员修改待确认订单；
- 事务化确认和最终快照；
- 原始版本、变更历史和审计日志；
- 并发确认和状态锁定；
- 管理员软取消。

### 阶段 5：每日任务与焚烧执行

- `Asia/Shanghai` 业务日期；
- 每日订单、物料汇总和逾期任务；
- 标记已焚烧和完成时间；
- 日程查询；
- 用户与管理员每日摘要。

### 阶段 6：通知与上线准备

- 站内通知、未读数和已读状态；
- 幂等每日提醒；
- 全局错误页、安全响应头和错误追踪；
- 隐私规则和数据删除流程；
- 完整备份恢复演练；
- 第二次上线安全审计。

每个阶段均独立编写设计规范和实施计划，使用 TDD，运行单元、集成和端到端测试，完成浏览器人工验收并接受代码审查。

## 15. 第一阶段验收标准

第一阶段完成必须同时满足：

1. 新仓库中不存在原型的 vinext、Worker 或 localStorage 业务状态。
2. Prisma 迁移可在空 PostgreSQL 数据库成功执行。
3. 服务器命令可安全创建首个管理员。
4. 管理员可登录、退出和修改密码。
5. 管理员可创建、修改、暂停、停用、恢复普通用户并重置密码。
6. 新用户首次登录必须改密。
7. 普通用户不能访问管理页面或调用管理 API。
8. 停用用户的现有 Session 立即失效。
9. 登录限速、手机号唯一、乐观锁和审计日志通过集成测试。
10. CI 全部通过。
11. Docker 测试环境部署、健康检查、数据库备份和恢复演练通过。
12. 未录入任何真实客户数据。
