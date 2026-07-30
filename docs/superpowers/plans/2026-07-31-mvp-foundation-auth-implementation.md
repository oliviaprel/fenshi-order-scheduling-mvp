# 焚烧订单排期系统 MVP 基础、认证与用户管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一个可部署到腾讯云、以 PostgreSQL 持久化、具备真实登录会话、服务端权限控制和管理员用户管理的第一阶段生产 MVP。

**Architecture:** 使用 Next.js App Router 的模块化单体架构；Route Handler 负责 HTTP 边界，领域服务负责业务规则，Prisma 7 通过 `@prisma/adapter-pg` 访问 PostgreSQL。认证采用数据库中仅保存哈希值的不透明 Session；所有权限和账户状态由服务端在每次受保护请求中校验。

**Tech Stack:** Node.js 22 LTS、Next.js 16.2.12、React 19.2.8、TypeScript 5.9.3、Tailwind CSS 4.3.3、Prisma 7.9.1、PostgreSQL 17、Zod 4.4.3、Argon2 0.45.1、Vitest 4.1.10、Playwright 1.62.0、Docker。

## Global Constraints

- 原型仓库只作为视觉和交互参考，不复制其 `localStorage`、模拟登录、前端权限或 vinext/Worker 架构。
- 第一阶段不实现物料、专属价格、订单、排期、焚烧任务和通知；数据库与模块边界要为后续阶段保留空间，但不得提前写空实现。
- 所有金额在后续阶段使用整数分；本阶段不创建金额字段。
- 所有生产写请求必须通过 Zod 校验、Origin 校验、Session 校验、角色校验和账户状态校验。
- 密码、原始 Session Token、数据库连接串和临时密码不得写入日志、审计记录或 API 响应之外的持久化位置。
- Web 管理端只能创建 `USER`，不能创建、修改或降级 `ADMIN`；额外管理员仅通过服务器 CLI 创建。
- 数据库集成测试必须使用 PostgreSQL，禁止使用 SQLite 替代。
- 每个任务严格执行红—绿—重构：先写失败测试，确认失败原因正确，再写最小实现。
- 每个任务完成后运行该任务的定向测试；任务 10 再运行全量质量门禁。
- 每个任务单独提交，提交前不得夹带其他任务或原型仓库的改动。

---

### Task 1: 建立 Next.js 工程骨架、质量脚本与环境配置

**Files:**
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `.env.example`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `vitest.unit.config.ts`
- Create: `vitest.integration.config.ts`
- Create: `vitest.setup.ts`
- Create: `playwright.config.ts`
- Create: `src/app/globals.css`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/lib/env.ts`
- Test: `src/lib/env.test.ts`

- [ ] **Step 1: 写环境变量解析的失败测试**

```ts
// src/lib/env.test.ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("rejects a missing database URL", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "test",
        APP_ORIGIN: "http://localhost:3000",
      }),
    ).toThrow("DATABASE_URL");
  });

  it("accepts the required runtime settings", () => {
    expect(
      parseEnv({
        NODE_ENV: "test",
        APP_ORIGIN: "http://localhost:3000",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/fenshi",
      }),
    ).toMatchObject({
      NODE_ENV: "test",
      APP_ORIGIN: "http://localhost:3000",
    });
  });
});
```

- [ ] **Step 2: 创建固定版本的工程依赖与测试脚本**

`package.json` 至少包含：

```json
{
  "name": "fenshi-order-scheduling-mvp",
  "private": true,
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "vitest run --config vitest.unit.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts --no-file-parallelism",
    "test:e2e": "playwright test",
    "prisma:generate": "prisma generate",
    "prisma:validate": "prisma validate",
    "admin:create": "tsx scripts/create-admin.ts"
  },
  "dependencies": {
    "@prisma/adapter-pg": "7.9.1",
    "@prisma/client": "7.9.1",
    "argon2": "0.45.1",
    "next": "16.2.12",
    "pg": "8.22.0",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@playwright/test": "1.62.0",
    "@tailwindcss/postcss": "4.3.3",
    "@testing-library/jest-dom": "7.0.0",
    "@testing-library/react": "16.3.2",
    "@types/node": "26.1.2",
    "@types/pg": "8.20.0",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "eslint": "9.39.4",
    "eslint-config-next": "16.2.12",
    "jsdom": "30.0.1",
    "prisma": "7.9.1",
    "tailwindcss": "4.3.3",
    "tsx": "4.23.1",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  }
}
```

执行：

```powershell
npm install
npm run test:unit -- src/lib/env.test.ts
```

预期：测试因 `src/lib/env.ts` 不存在而失败。

- [ ] **Step 3: 实现最小工程配置与类型安全环境解析**

```ts
// src/lib/env.ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
});

export type AppEnv = z.infer<typeof envSchema>;
export const parseEnv = (input: NodeJS.ProcessEnv): AppEnv => envSchema.parse(input);
export const getEnv = (): AppEnv => parseEnv(process.env);
```

根页面只显示产品名称和“正在初始化”，不得加入模拟数据或模拟登录。`.env.example` 使用无真实凭据的本地示例；`.gitignore` 忽略 `.env*`，但保留 `.env.example`。

`vitest.unit.config.ts` 只包含 `src/**/*.test.ts` 并排除 `src/**/*.integration.test.ts`；`vitest.integration.config.ts` 只包含 `src/**/*.integration.test.ts`，使用 Node 环境且关闭文件并行，避免多个测试同时清空共享测试库。

- [ ] **Step 4: 验证工程骨架**

```powershell
npm run test:unit -- src/lib/env.test.ts
npm run lint
npm run typecheck
```

预期：全部通过。

- [ ] **Step 5: 提交**

```powershell
git add .gitignore .nvmrc .env.example package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs vitest.unit.config.ts vitest.integration.config.ts vitest.setup.ts playwright.config.ts src
git commit -m "chore: scaffold production MVP application"
```

---

### Task 2: 建立 PostgreSQL 开发环境、Prisma 模型与数据库客户端

**Files:**
- Create: `compose.dev.yaml`
- Create: `prisma.config.ts`
- Create: `prisma/schema.prisma`
- Create: `prisma/migrations/<generated_timestamp>_foundation/migration.sql`
- Create: `src/server/db/client.ts`
- Create: `src/server/db/test-database.ts`
- Test: `src/server/db/schema.integration.test.ts`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: 写真实 PostgreSQL Schema 集成测试**

```ts
// src/server/db/schema.integration.test.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { resetTestDatabase } from "./test-database";

describe("foundation schema", () => {
  beforeEach(resetTestDatabase);
  afterAll(() => prisma.$disconnect());

  it("enforces normalized phone uniqueness", async () => {
    const data = {
      role: "USER" as const,
      displayName: "清和堂",
      phone: "13800138000",
      passwordHash: "not-a-real-password-hash",
      status: "ACTIVE" as const,
      mustChangePassword: true,
    };
    await prisma.user.create({ data });
    await expect(prisma.user.create({ data })).rejects.toMatchObject({ code: "P2002" });
  });
});
```

- [ ] **Step 2: 启动本地 PostgreSQL 并确认测试因模型尚未生成而失败**

`compose.dev.yaml` 使用 `postgres:17-alpine`，暴露 `5432`，健康检查使用 `pg_isready`，数据库名分别支持开发库 `fenshi` 和测试库 `fenshi_test`。测试命令显式使用测试连接串。

```powershell
docker compose -f compose.dev.yaml up -d
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npm run test:integration -- src/server/db/schema.integration.test.ts
```

预期：因 Prisma Client/表不存在而失败。

- [ ] **Step 3: 定义完整第一阶段模型**

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum UserRole {
  ADMIN
  USER
}

enum UserStatus {
  ACTIVE
  PAUSED
  DISABLED
}

model User {
  id                String       @id @default(uuid()) @db.Uuid
  role              UserRole
  displayName       String       @db.VarChar(50)
  phone             String       @unique @db.VarChar(11)
  passwordHash      String
  status            UserStatus   @default(ACTIVE)
  mustChangePassword Boolean      @default(true)
  passwordChangedAt DateTime?
  version           Int          @default(1)
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
  sessions          Session[]
  auditLogs         AuditLog[]   @relation("AuditActor")
}

model Session {
  id         String   @id @default(uuid()) @db.Uuid
  tokenHash  String   @unique @db.Char(64)
  userId     String   @db.Uuid
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())
  expiresAt  DateTime
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
}

model LoginThrottle {
  keyHash         String    @id @db.Char(64)
  windowStartedAt DateTime
  failureCount    Int
  blockedUntil    DateTime?
  updatedAt       DateTime  @updatedAt
}

model AuditLog {
  id          String   @id @default(uuid()) @db.Uuid
  actorUserId String?  @db.Uuid
  action      String   @db.VarChar(100)
  targetType  String   @db.VarChar(50)
  targetId    String?  @db.VarChar(100)
  beforeJson  Json?
  afterJson   Json?
  requestId   String   @db.VarChar(100)
  createdAt   DateTime @default(now())
  actor       User?    @relation("AuditActor", fields: [actorUserId], references: [id], onDelete: SetNull)

  @@index([actorUserId, createdAt])
  @@index([targetType, targetId])
}
```

`prisma.config.ts` 从环境变量读取 `DATABASE_URL`。`src/server/db/client.ts` 使用：

```ts
const adapter = new PrismaPg({ connectionString: getEnv().DATABASE_URL });
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
```

仅在非生产环境缓存 Prisma 单例。`resetTestDatabase` 只允许数据库名以 `_test` 结尾，并按外键顺序清空四张表；不满足条件时立即抛错。

- [ ] **Step 4: 生成迁移并运行测试**

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npx prisma migrate dev --name foundation
npm run prisma:validate
npm run prisma:generate
npm run test:integration -- src/server/db/schema.integration.test.ts
```

预期：迁移成功，唯一性测试通过。

- [ ] **Step 5: 提交**

```powershell
git add compose.dev.yaml prisma.config.ts prisma package.json package-lock.json .env.example .gitignore src/server/db
git commit -m "feat: add PostgreSQL foundation schema"
```

---

### Task 3: 实现输入校验、密码、Session Token 与统一错误边界

**Files:**
- Create: `src/modules/auth/auth.schemas.ts`
- Create: `src/modules/auth/password.ts`
- Create: `src/modules/auth/session-token.ts`
- Create: `src/modules/users/user.schemas.ts`
- Create: `src/server/http/api-error.ts`
- Create: `src/server/http/origin.ts`
- Create: `src/server/http/request-id.ts`
- Test: `src/modules/auth/auth-primitives.test.ts`
- Test: `src/modules/users/user.schemas.test.ts`
- Test: `src/server/http/origin.test.ts`

- [ ] **Step 1: 写边界条件失败测试**

```ts
// src/modules/users/user.schemas.test.ts
import { describe, expect, it } from "vitest";
import { normalizeMainlandPhone, passwordSchema } from "./user.schemas";

describe("user input rules", () => {
  it.each([
    ["+86 138-0013-8000", "13800138000"],
    ["13800138000", "13800138000"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeMainlandPhone(input)).toBe(expected);
  });

  it("rejects invalid mainland mobile numbers", () => {
    expect(() => normalizeMainlandPhone("12800138000")).toThrow();
  });

  it("accepts only 10 to 72 character passwords", () => {
    expect(passwordSchema.safeParse("123456789").success).toBe(false);
    expect(passwordSchema.safeParse("1234567890").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(73)).success).toBe(false);
  });
});
```

```ts
// src/modules/auth/auth-primitives.test.ts
it("creates a 32-byte-or-longer token and hashes it deterministically", () => {
  const token = createSessionToken();
  expect(Buffer.from(token, "base64url")).toHaveLength(32);
  expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
  expect(hashSessionToken(token)).toBe(hashSessionToken(token));
});

it("verifies Argon2id passwords", async () => {
  const hash = await hashPassword("correct horse battery staple");
  expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  expect(await verifyPassword(hash, "wrong password")).toBe(false);
});
```

- [ ] **Step 2: 确认测试失败**

```powershell
npm run test:unit -- src/modules/users/user.schemas.test.ts src/modules/auth/auth-primitives.test.ts src/server/http/origin.test.ts
```

预期：模块不存在，测试失败。

- [ ] **Step 3: 实现安全原语和统一错误结构**

必须导出以下接口：

```ts
export function normalizeMainlandPhone(input: string): string;
export const passwordSchema: z.ZodString;
export function hashPassword(password: string): Promise<string>;
export function verifyPassword(hash: string, password: string): Promise<boolean>;
export function createSessionToken(): string;
export function hashSessionToken(token: string): string;
export function assertAllowedOrigin(request: Request): void;
export function getRequestId(request: Request): string;
export class ApiError extends Error {
  status: number;
  code: string;
  fieldErrors?: Record<string, string[]>;
}
export function toErrorResponse(error: unknown, requestId: string): Response;
```

Session Token 使用 `randomBytes(32).toString("base64url")`，哈希使用 SHA-256 十六进制。密码使用 Argon2id。Origin 必须与 `APP_ORIGIN` 的 origin 完全一致；无 Origin 的同源浏览器 GET/HEAD 允许，写方法缺失或不匹配则返回 `403 ORIGIN_NOT_ALLOWED`。未知错误返回通用中文消息和 `requestId`，不得泄漏堆栈。

- [ ] **Step 4: 运行测试和静态检查**

```powershell
npm run test:unit -- src/modules/users/user.schemas.test.ts src/modules/auth/auth-primitives.test.ts src/server/http/origin.test.ts
npm run typecheck
```

预期：全部通过。

- [ ] **Step 5: 提交**

```powershell
git add src/modules/auth src/modules/users src/server/http
git commit -m "feat: add authentication security primitives"
```

---

### Task 4: 实现首个管理员 CLI 与审计写入

**Files:**
- Create: `src/modules/audit/audit.service.ts`
- Create: `src/modules/users/user.service.ts`
- Create: `src/modules/users/user.types.ts`
- Create: `scripts/create-admin.ts`
- Test: `src/modules/users/create-admin.integration.test.ts`
- Test: `src/modules/audit/audit.integration.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 写管理员创建和敏感字段审计测试**

```ts
// src/modules/users/create-admin.integration.test.ts
it("creates an active admin with a hashed password", async () => {
  const admin = await createAdmin(
    { displayName: "系统管理员", phone: "+86 138-0013-8000", password: "secure-pass-2026" },
    { requestId: "cli-admin-create" },
  );
  expect(admin).toMatchObject({
    role: "ADMIN",
    phone: "13800138000",
    status: "ACTIVE",
    mustChangePassword: false,
  });
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
  expect(stored.passwordHash).not.toContain("secure-pass-2026");
});

it("never stores a password or password hash in audit JSON", async () => {
  await createAdmin(
    { displayName: "系统管理员", phone: "13800138000", password: "secure-pass-2026" },
    { requestId: "cli-admin-create" },
  );
  const audit = await prisma.auditLog.findFirstOrThrow();
  expect(JSON.stringify(audit)).not.toContain("secure-pass-2026");
  expect(JSON.stringify(audit)).not.toContain("passwordHash");
});
```

- [ ] **Step 2: 确认测试因服务不存在而失败**

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npm run test:integration -- src/modules/users/create-admin.integration.test.ts src/modules/audit/audit.integration.test.ts
```

- [ ] **Step 3: 实现事务内创建管理员和审计**

服务接口：

```ts
export type RequestContext = { requestId: string; actorUserId?: string };

export async function createAdmin(
  input: { displayName: string; phone: string; password: string },
  context: RequestContext,
): Promise<PublicUser>;

export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: {
    actorUserId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    before?: unknown;
    after?: unknown;
    requestId: string;
  },
): Promise<void>;
```

`PublicUser` 必须显式列出 `id/role/displayName/phone/status/mustChangePassword/version/createdAt/updatedAt`，不得通过对象展开返回 Prisma User。创建用户和审计必须在同一事务中完成；手机号重复转换为 `409 PHONE_ALREADY_EXISTS`。

CLI 使用 `node:readline/promises` 收集姓名和手机号，密码输入必须关闭回显；若当前终端无法安全关闭回显则终止并提示通过交互式 TTY 执行，禁止把密码作为命令行参数。CLI 成功时只输出管理员 ID、姓名和手机号。

- [ ] **Step 4: 运行集成测试并人工烟测 CLI**

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npm run test:integration -- src/modules/users/create-admin.integration.test.ts src/modules/audit/audit.integration.test.ts
npm run admin:create
```

预期：自动测试通过；CLI 隐藏密码输入，成功后数据库存在 ADMIN 和对应审计记录。

- [ ] **Step 5: 提交**

```powershell
git add scripts src/modules/audit src/modules/users package.json package-lock.json
git commit -m "feat: add secure administrator bootstrap"
```

---

### Task 5: 实现登录限流、Session 生命周期和认证服务

**Files:**
- Create: `src/modules/auth/login-throttle.service.ts`
- Create: `src/modules/auth/session.service.ts`
- Create: `src/modules/auth/auth.service.ts`
- Create: `src/modules/auth/auth.types.ts`
- Test: `src/modules/auth/login-throttle.integration.test.ts`
- Test: `src/modules/auth/session.integration.test.ts`
- Test: `src/modules/auth/auth.service.integration.test.ts`

- [ ] **Step 1: 写登录、限流和状态规则测试**

```ts
it("creates a seven-day session for a valid active user", async () => {
  const result = await login(
    { phone: "13800138000", password: "secure-pass-2026" },
    { ip: "127.0.0.1", now: new Date("2026-07-31T00:00:00.000Z"), requestId: "req-1" },
  );
  expect(result.token).toBeTruthy();
  expect(result.user.phone).toBe("13800138000");
  expect(result.expiresAt.toISOString()).toBe("2026-08-07T00:00:00.000Z");
  expect(await prisma.session.findFirstOrThrow()).not.toHaveProperty("token", result.token);
});

it("blocks a phone or IP for fifteen minutes after five failures", async () => {
  for (let index = 0; index < 5; index += 1) {
    await expect(
      login(
        { phone: "13800138000", password: "wrong-password" },
        { ip: "203.0.113.10", now: new Date("2026-07-31T00:00:00.000Z"), requestId: `req-${index}` },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  }
  await expect(
    login(
      { phone: "13800138000", password: "secure-pass-2026" },
      { ip: "203.0.113.10", now: new Date("2026-07-31T00:01:00.000Z"), requestId: "req-6" },
    ),
  ).rejects.toMatchObject({ status: 429, code: "LOGIN_BLOCKED" });
});
```

还需覆盖：

- `DISABLED` 用户不能登录；
- `PAUSED` 用户可以登录；
- 过期 Session 被删除并返回未认证；
- `lastSeenAt` 在 15 分钟内不写库，超过 15 分钟才更新；
- 登出只删除当前 Session；
- 修改密码后删除该用户除当前请求外的所有 Session；
- 不存在手机号和错误密码返回相同的 `INVALID_CREDENTIALS`。

- [ ] **Step 2: 确认集成测试失败**

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npm run test:integration -- src/modules/auth/login-throttle.integration.test.ts src/modules/auth/session.integration.test.ts src/modules/auth/auth.service.integration.test.ts
```

- [ ] **Step 3: 实现时间可注入的认证服务**

核心接口：

```ts
export type LoginContext = {
  ip: string;
  now: Date;
  requestId: string;
};

export async function login(
  input: { phone: string; password: string },
  context: LoginContext,
): Promise<{ user: PublicUser; token: string; expiresAt: Date }>;

export async function authenticateSession(
  rawToken: string | undefined,
  now: Date,
): Promise<AuthenticatedUser | null>;

export async function logout(rawToken: string | undefined): Promise<void>;

export async function changeOwnPassword(
  actor: AuthenticatedUser,
  input: { currentPassword: string; newPassword: string },
  context: RequestContext & { currentTokenHash: string },
): Promise<void>;
```

登录限流键分别为 `sha256("phone:"+normalizedPhone)` 和 `sha256("ip:"+ip)`。窗口为 15 分钟，连续 5 次失败后 `blockedUntil = now + 15 minutes`；成功登录清除手机号限流记录，但不清除可能被多人共享的 IP 历史。失败计数必须在事务内通过行锁或原子更新递增，并增加一个并发测试，证明 5 个同时失败的请求不会丢失计数。比较密码时，对不存在用户也验证一个进程启动时生成的哑元 Argon2 Hash，降低账户枚举侧信道。

Session 有效期固定 7 天，不滑动延长。所有状态、限流、Session 与审计相关多写操作使用事务。

- [ ] **Step 4: 运行定向测试**

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npm run test:integration -- src/modules/auth/login-throttle.integration.test.ts src/modules/auth/session.integration.test.ts src/modules/auth/auth.service.integration.test.ts
npm run typecheck
```

预期：全部通过。

- [ ] **Step 5: 提交**

```powershell
git add src/modules/auth
git commit -m "feat: implement database-backed authentication"
```

---

### Task 6: 建立认证 API、Cookie 与服务端访问守卫

**Files:**
- Create: `src/server/auth/current-user.ts`
- Create: `src/server/auth/guards.ts`
- Create: `src/server/http/client-ip.ts`
- Create: `src/server/http/route-handler.ts`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/app/api/auth/change-password/route.ts`
- Create: `src/app/api/me/route.ts`
- Test: `src/app/api/auth/auth-routes.integration.test.ts`
- Test: `src/server/auth/guards.test.ts`

- [ ] **Step 1: 写 Route Handler 行为测试**

测试必须验证：

```ts
expect(response.headers.get("set-cookie")).toContain("fenshi_session=");
expect(response.headers.get("set-cookie")).toContain("HttpOnly");
expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
expect(response.headers.get("set-cookie")).toContain("Max-Age=604800");
```

并覆盖：

- 生产环境 Cookie 含 `Secure`，测试环境不要求 HTTPS；
- 错误 Origin 返回 403；
- 未登录 `/api/me` 返回统一 401；
- `mustChangePassword=true` 时，只允许 `/api/me`、修改密码和登出；
- `requireAdmin` 拒绝 USER；
- 响应体不包含 `passwordHash`、`tokenHash`；
- 每个错误响应包含 `requestId`。

- [ ] **Step 2: 确认测试失败**

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npm run test:integration -- src/app/api/auth/auth-routes.integration.test.ts
npm run test:unit -- src/server/auth/guards.test.ts
```

- [ ] **Step 3: 实现 Cookie 和访问守卫**

Cookie 常量：

```ts
export const SESSION_COOKIE = "fenshi_session";
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: getEnv().NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};
```

守卫接口：

```ts
export async function getCurrentUser(): Promise<AuthenticatedUser | null>;
export async function requireUser(options?: { allowPasswordChangeRequired?: boolean }): Promise<AuthenticatedUser>;
export async function requireAdmin(): Promise<AuthenticatedUser & { role: "ADMIN" }>;
```

`route-handler.ts` 统一捕获 `ApiError`、附加/透传 `x-request-id` 并输出 JSON。客户端 IP 只信任部署代理注入的首个 `x-forwarded-for` 值；部署文档必须要求反向代理覆盖该头，不能透传任意客户端值。

- [ ] **Step 4: 运行测试**

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npm run test:integration -- src/app/api/auth/auth-routes.integration.test.ts
npm run test:unit -- src/server/auth/guards.test.ts
npm run lint
npm run typecheck
```

- [ ] **Step 5: 提交**

```powershell
git add src/server/auth src/server/http src/app/api
git commit -m "feat: expose secure authentication APIs"
```

---

### Task 7: 实现登录、强制改密和最小用户首页

**Files:**
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/change-password/page.tsx`
- Create: `src/app/(protected)/layout.tsx`
- Create: `src/app/(protected)/home/page.tsx`
- Create: `src/components/auth/login-form.tsx`
- Create: `src/components/auth/change-password-form.tsx`
- Create: `src/components/app-shell.tsx`
- Create: `src/lib/api-client.ts`
- Create: `e2e/global-setup.ts`
- Create: `e2e/helpers/auth.ts`
- Create: `e2e/auth.spec.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `playwright.config.ts`
- Modify: `.env.example`

- [ ] **Step 1: 写用户关键路径 E2E 测试**

```ts
test("temporary-password user must change password before home", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("手机号").fill("13800138000");
  await page.getByLabel("密码").fill("temporary-pass-2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("当前密码").fill("temporary-pass-2026");
  await page.getByLabel("新密码").fill("permanent-pass-2026");
  await page.getByRole("button", { name: "修改密码" }).click();
  await expect(page).toHaveURL(/\/home$/);
});
```

还需覆盖错误密码中文提示、退出登录、DISABLED Session 被立即踢回登录页。

- [ ] **Step 2: 运行 E2E 并确认失败**

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npx playwright install chromium
npm run test:e2e -- e2e/auth.spec.ts
```

预期：页面不存在或元素找不到，测试失败。

- [ ] **Step 3: 建立隔离的 E2E 数据准备**

`e2e/global-setup.ts` 仅允许连接数据库名以 `_test` 结尾，先清库，再直接调用已测试的领域服务创建：

- 管理员：`E2E_ADMIN_PHONE` / `E2E_ADMIN_PASSWORD`
- 强制改密普通用户：`E2E_USER_PHONE` / `E2E_USER_PASSWORD`
- 已禁用普通用户及其 Session 测试数据

所有密码从测试环境变量读取且不得输出。`playwright.config.ts` 的 `webServer` 使用 `npm run dev`，URL 为 `http://127.0.0.1:3000`，并把同一 `APP_ORIGIN` 与测试数据库连接串传给应用。`e2e/helpers/auth.ts` 提供 `loginAsAdmin(page)` 和 `loginAsUser(page)`，禁止通过伪造 Cookie 绕过真实登录。

- [ ] **Step 4: 实现服务端重定向和表单**

`/` 根据状态重定向：

- 未登录 → `/login`
- `mustChangePassword` → `/change-password`
- 已登录 → `/home`

受保护布局在服务端调用 `requireUser()`。登录和改密表单通过 `fetch` 调用 API，按钮在提交期间禁用，错误聚焦到错误摘要，字段使用真实 `<label>`，不得只用 placeholder。最小用户首页仅显示姓名、账户状态和“订单功能将在下一阶段开放”，不加入伪订单。

- [ ] **Step 5: 验证浏览器流程和响应式布局**

```powershell
npm run test:e2e -- e2e/auth.spec.ts
npm run lint
npm run typecheck
```

再以 Playwright 检查 390×844 和 1440×900 两个视口，确认无横向滚动、键盘焦点可见。

- [ ] **Step 6: 提交**

```powershell
git add src/app src/components src/lib/api-client.ts e2e playwright.config.ts .env.example
git commit -m "feat: add login and password-change experience"
```

---

### Task 8: 实现管理员用户管理服务与 API

**Files:**
- Create: `src/modules/users/admin-user.service.ts`
- Create: `src/app/api/admin/users/route.ts`
- Create: `src/app/api/admin/users/[id]/route.ts`
- Create: `src/app/api/admin/users/[id]/reset-password/route.ts`
- Test: `src/modules/users/admin-user.service.integration.test.ts`
- Test: `src/app/api/admin/users/admin-user-routes.integration.test.ts`

- [ ] **Step 1: 写管理员业务规则测试**

覆盖以下精确行为：

```ts
it("rejects a stale optimistic-lock version", async () => {
  await expect(
    updateManagedUser(
      user.id,
      { displayName: "新名称", phone: user.phone, status: "ACTIVE", version: user.version - 1 },
      adminContext,
    ),
  ).rejects.toMatchObject({ status: 409, code: "USER_VERSION_CONFLICT" });
});

it("disables a user and revokes every session in one transaction", async () => {
  await updateManagedUser(
    user.id,
    { displayName: user.displayName, phone: user.phone, status: "DISABLED", version: user.version },
    adminContext,
  );
  expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  expect(await prisma.auditLog.findFirst({ where: { action: "USER_DISABLED" } })).not.toBeNull();
});
```

还需覆盖：

- Web 创建的角色固定为 USER；
- 管理员账号不出现在可编辑目标中；
- 直接请求 ADMIN ID 返回 403；
- 搜索匹配姓名或规范化手机号；
- 创建用户返回一次性临时密码，但审计不保存该密码；
- 重置密码设置 `mustChangePassword=true` 并撤销全部 Session；
- `PAUSED` 不撤销 Session；
- 更新姓名/手机号/状态时 `version + 1`；
- 手机号冲突返回 409。

- [ ] **Step 2: 确认测试失败**

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npm run test:integration -- src/modules/users/admin-user.service.integration.test.ts src/app/api/admin/users/admin-user-routes.integration.test.ts
```

- [ ] **Step 3: 实现显式 DTO 和事务**

接口：

```ts
export async function listManagedUsers(
  input: { query?: string; cursor?: string; limit: number },
): Promise<{ items: PublicUser[]; nextCursor: string | null }>;

export async function createManagedUser(
  input: { displayName: string; phone: string },
  context: AdminContext,
): Promise<{ user: PublicUser; temporaryPassword: string }>;

export async function updateManagedUser(
  id: string,
  input: { displayName: string; phone: string; status: UserStatus; version: number },
  context: AdminContext,
): Promise<PublicUser>;

export async function resetManagedUserPassword(
  id: string,
  context: AdminContext,
): Promise<{ temporaryPassword: string }>;
```

临时密码由密码学安全随机源生成，长度至少 16 个字符。一次性密码只在成功响应中返回一次。更新使用带 `id + version + role: USER` 条件的原子更新；影响行数为 0 时再查询区分 404、403 和 409。用户变更、Session 撤销和审计在同一事务中。

API 查询参数 `limit` 限制为 1–100，默认 30；cursor 使用用户 UUID。所有三个写 API 调用 `assertAllowedOrigin` 和 `requireAdmin`。

- [ ] **Step 4: 运行服务和路由测试**

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npm run test:integration -- src/modules/users/admin-user.service.integration.test.ts src/app/api/admin/users/admin-user-routes.integration.test.ts
npm run typecheck
```

- [ ] **Step 5: 提交**

```powershell
git add src/modules/users src/app/api/admin
git commit -m "feat: add administrator user management APIs"
```

---

### Task 9: 实现管理员用户管理界面

**Files:**
- Create: `src/app/(protected)/admin/layout.tsx`
- Create: `src/app/(protected)/admin/users/page.tsx`
- Create: `src/components/admin/user-list.tsx`
- Create: `src/components/admin/user-form-dialog.tsx`
- Create: `src/components/admin/reset-password-dialog.tsx`
- Create: `src/components/ui/status-badge.tsx`
- Test: `e2e/admin-users.spec.ts`
- Modify: `src/components/app-shell.tsx`

- [ ] **Step 1: 写管理员管理 E2E 测试**

```ts
test("admin creates, edits, pauses and resets a user", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "新增用户" }).click();
  await page.getByLabel("账户名称").fill("清和堂");
  await page.getByLabel("手机号").fill("13800138000");
  await page.getByRole("button", { name: "确认创建" }).click();
  await expect(page.getByText("临时密码仅显示一次")).toBeVisible();
  await page.getByRole("button", { name: "我已保存" }).click();
  await expect(page.getByRole("row", { name: /清和堂/ })).toBeVisible();
  await page.getByRole("button", { name: "编辑清和堂" }).click();
  await page.getByLabel("状态").selectOption("PAUSED");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("已暂停")).toBeVisible();
});
```

还需覆盖搜索、禁用确认、重置密码一次性展示、409 冲突后提示刷新、普通用户访问 `/admin/users` 返回 403 页面。

- [ ] **Step 2: 确认 E2E 失败**

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npm run test:e2e -- e2e/admin-users.spec.ts
```

- [ ] **Step 3: 实现可访问、响应式管理界面**

管理员布局服务端调用 `requireAdmin()`。列表首屏服务端获取数据，搜索和后续分页走 API。桌面使用表格，窄屏使用同一数据的卡片布局。状态中文映射固定为：

```ts
const USER_STATUS_LABELS = {
  ACTIVE: "正常",
  PAUSED: "已暂停",
  DISABLED: "已禁用",
} as const;
```

禁用、重置密码必须二次确认。临时密码对话框关闭后不得在 DOM、URL、浏览器存储或前端日志中保留。编辑对话框携带当前 `version`；收到 409 时禁止覆盖服务器数据，展示“该用户已被其他管理员修改，请刷新后重试”。

- [ ] **Step 4: 浏览器验证**

```powershell
npm run test:e2e -- e2e/admin-users.spec.ts
npm run lint
npm run typecheck
```

使用 390×844、768×1024、1440×900 三个视口检查创建、编辑、搜索、暂停、禁用、重置密码和键盘操作。

- [ ] **Step 5: 提交**

```powershell
git add src/app src/components e2e/admin-users.spec.ts
git commit -m "feat: add administrator user management interface"
```

---

### Task 10: 加入健康检查、安全响应头、容器、CI 与腾讯云运行手册

**Files:**
- Create: `src/app/api/health/live/route.ts`
- Create: `src/app/api/health/ready/route.ts`
- Create: `src/app/api/health/health-routes.integration.test.ts`
- Create: `src/server/logging/logger.ts`
- Create: `src/server/logging/redaction.ts`
- Create: `src/server/logging/redaction.test.ts`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `compose.production.example.yaml`
- Create: `deploy/Caddyfile.example`
- Create: `.github/workflows/ci.yml`
- Create: `docs/runbooks/deploy-tencent-cloud.md`
- Create: `docs/runbooks/backup-and-restore.md`
- Create: `docs/runbooks/incident-response.md`
- Modify: `next.config.ts`
- Create: `README.md`
- Modify: `package.json`

- [ ] **Step 1: 写健康检查和日志脱敏测试**

```ts
it("redacts secrets recursively", () => {
  expect(
    redact({
      password: "secret",
      token: "raw-token",
      nested: { passwordHash: "argon", authorization: "Bearer abc" },
      phone: "13800138000",
    }),
  ).toEqual({
    password: "[REDACTED]",
    token: "[REDACTED]",
    nested: { passwordHash: "[REDACTED]", authorization: "[REDACTED]" },
    phone: "13800138000",
  });
});
```

健康检查测试：

- `/api/health/live` 不访问数据库并返回 200 `{ status: "ok" }`；
- `/api/health/ready` 执行 `SELECT 1`，成功返回 200；
- 数据库不可用时 ready 返回 503，响应不泄漏连接串。

- [ ] **Step 2: 确认测试失败**

```powershell
npm run test:unit -- src/server/logging/redaction.test.ts
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
npm run test:integration -- src/app/api/health/health-routes.integration.test.ts
```

- [ ] **Step 3: 实现运行期安全配置**

`next.config.ts` 设置 `output: "standalone"`，并为所有页面设置：

- `Content-Security-Policy`（至少限制 `default-src 'self'`、`frame-ancestors 'none'`、对象源为 none）；
- `Referrer-Policy: strict-origin-when-cross-origin`；
- `X-Content-Type-Options: nosniff`；
- `Permissions-Policy` 禁用摄像头、麦克风和地理位置。

日志使用结构化 JSON，字段至少包含 timestamp、level、message、requestId；脱敏键不区分大小写，包括 password、passwordHash、token、tokenHash、cookie、authorization、databaseUrl。生产环境不记录完整请求体。

- [ ] **Step 4: 建立非 root 多阶段镜像和部署样例**

Dockerfile 阶段：

1. `deps`：`npm ci`
2. `builder`：`prisma generate && npm run build`
3. `runner`：复制 standalone 输出，以非 root `nextjs` 用户运行

镜像启动前不得自动执行破坏性迁移；生产发布流程明确先运行：

```powershell
npx prisma migrate deploy
```

`compose.production.example.yaml` 只包含应用和 Caddy，不包含生产数据库；数据库使用腾讯云 PostgreSQL 私网 TLS 地址和外部 Secret/环境注入。Caddy 示例覆盖 `X-Forwarded-For`，强制 HTTPS，并代理 live/ready。

- [ ] **Step 5: 编写 CI**

`.github/workflows/ci.yml` 使用 Ubuntu、Node 22 和 PostgreSQL 17 service，在 job 级设置测试用 `APP_ORIGIN` 和 `DATABASE_URL`，并按顺序运行：

```yaml
- run: npm ci
- run: npm run lint
- run: npm run typecheck
- run: npm run prisma:validate
- run: npx prisma migrate deploy
  env:
    DATABASE_URL: postgresql://postgres:postgres@localhost:5432/fenshi_test
- run: npm run test:unit
- run: npm run test:integration
  env:
    DATABASE_URL: postgresql://postgres:postgres@localhost:5432/fenshi_test
- run: npx playwright install --with-deps chromium
- run: npm run test:e2e
  env:
    DATABASE_URL: postgresql://postgres:postgres@localhost:5432/fenshi_test
- run: npm run build
- run: npm audit --omit=dev --audit-level=high
```

CI 为 Playwright 设置 `E2E_ADMIN_PHONE`、`E2E_ADMIN_PASSWORD`、`E2E_USER_PHONE` 和 `E2E_USER_PASSWORD` 仓库级测试 Secret；`e2e/global-setup.ts` 创建测试管理员和普通用户，不得打印密码。

- [ ] **Step 6: 编写可执行运行手册**

部署手册明确：

- 腾讯云服务器、VPC、安全组、Caddy HTTPS、Node 容器和托管 PostgreSQL TLS 连接；
- Secret 注入、首次 `npm run admin:create`、迁移顺序、健康检查和回滚到上一镜像；
- 发布前禁止导入真实客户数据；
- 数据库每日自动备份、保留 14 天；
- 首次上线验收前，在隔离数据库完成一次恢复演练并记录恢复时长、备份时间点、校验结果；
- 事件响应包括禁用账户、撤销 Session、数据库凭据轮换、日志取证和用户通知判断。

- [ ] **Step 7: 运行全量质量门禁**

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/fenshi_test'
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

预期：所有命令退出码为 0。若 `npm audit` 报告生产依赖高危漏洞，不得通过忽略规则绕过；升级或替换依赖后重新运行全量门禁。

- [ ] **Step 8: 执行上线前恢复演练**

在隔离测试实例：

1. 创建管理员和普通用户；
2. 生成托管 PostgreSQL 备份；
3. 恢复到新的隔离数据库；
4. 运行迁移状态检查、用户计数和登录烟测；
5. 将日期、备份标识、RPO、RTO、校验结果记录到 `docs/runbooks/backup-and-restore.md` 的演练记录表。

预期：恢复后的数据计数一致，管理员和普通用户均可登录，原数据库不受影响。

- [ ] **Step 9: 提交**

```powershell
git add src/app/api/health src/server/logging Dockerfile .dockerignore compose.production.example.yaml deploy .github docs/runbooks next.config.ts README.md package.json package-lock.json
git commit -m "chore: add production operations and quality gates"
```

---

## Phase 1 Acceptance Checklist

- [ ] 新环境从空数据库执行 `prisma migrate deploy` 成功。
- [ ] 首个管理员只能通过交互式 CLI 创建，密码不回显、不进入日志。
- [ ] ACTIVE 和 PAUSED 用户可以登录，DISABLED 用户不能登录且旧 Session 立即失效。
- [ ] 临时密码用户在改密前无法访问普通业务页面。
- [ ] 管理员能搜索、新增、编辑、暂停、禁用和重置普通用户密码。
- [ ] Web 管理端无法创建或编辑 ADMIN。
- [ ] 并发编辑使用 `version` 检出冲突，不发生静默覆盖。
- [ ] 所有写 API 具备 Origin、Session、角色、状态和输入校验。
- [ ] 审计记录覆盖管理员创建、用户创建、用户修改、禁用、重置密码和密码修改，且不含敏感字段。
- [ ] 登录限流同时按手机号和 IP 生效。
- [ ] 单元、PostgreSQL 集成、Playwright E2E、构建和生产依赖审计全部通过。
- [ ] Docker 容器以非 root 用户运行，live/ready 健康检查语义正确。
- [ ] 腾讯云部署、回滚、备份和事件响应手册可由未参与开发的人照章执行。
- [ ] 已完成一次隔离环境数据库恢复演练并留下记录。

## Deferred Roadmap

以下内容不属于本计划，第一阶段验收后再分别设计和实施：

1. 物料库、别名、基础价格和客户专属价格（金额使用整数分）。
2. 用户下单、服务端可信计价、订单编辑/取消和 Excel 可粘贴格式。
3. 管理员核对、确认、锁单、日程查询和并发审计。
4. 每日任务、焚烧时间、总表复制和 Asia/Shanghai 业务日期规则。
5. 通知、监控告警、容量压测与正式生产安全审计。
