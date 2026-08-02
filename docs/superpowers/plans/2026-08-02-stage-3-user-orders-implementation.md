# Stage 3 User Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the authenticated user flow for trusted material browsing, order submission, pending-order editing/cancellation, history and TSV copying.

**Architecture:** Persist immutable line snapshots and a transactional daily sequence, expose only customer-owned DTOs, and let the UI consume server-calculated totals. State changes always create OrderEvent and AuditLog records atomically.

**Tech Stack:** Next.js Route Handlers, React, TypeScript, Zod, Prisma/PostgreSQL transactions, Vitest, Playwright.

## Global Constraints

- Business dates use `Asia/Shanghai`; database timestamps use UTC.
- Order number is `yyyyMMdd-NNN` from submission date and never changes.
- Quantity is a positive integer; empty quantity on Add becomes `1`.
- The server ignores client prices and recalculates current effective prices on create and user edit.
- Order lines snapshot material name, unit, unit price cents, quantity and subtotal cents.
- Users may edit/cancel only their own `PENDING_CONFIRMATION` orders; `PAUSED` users cannot write orders.
- Cancellation requires a non-empty reason and never deletes the order.
- Every mutation requires `version` and atomically writes Order, OrderLine, OrderEvent and AuditLog.

---

### Task 1: Order, Event, Notification and Daily Sequence Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_user_orders/migration.sql`
- Modify: `src/server/db/schema.integration.test.ts`

**Interfaces:**
- Produces enums `OrderStatus` and `OrderEventType`.
- Produces models `Order`, `OrderLine`, `OrderEvent`, `OrderNumberSequence`, and `Notification` with unique `businessKey`, recipient User, optional Order, title/body/read timestamps.

- [ ] **Step 1: Add failing schema tests** for unique order number, unique sequence business date, positive quantity, non-negative money, required cancellation tuple consistency, unique notification business key, recipient ownership, and restrictive history relations.

- [ ] **Step 2: Run Prisma validation/migration tests and verify failure.**

- [ ] **Step 3: Add models and SQL CHECK constraints.** Store requested/final dates as PostgreSQL `date`, totals as `Int`, snapshots on OrderLine, and `version Int @default(1)`.

- [ ] **Step 4: Regenerate Prisma and prove constraints on a fresh PostgreSQL test database.**

- [ ] **Step 5: Commit.**

```bash
git add prisma src/server/db/schema.integration.test.ts src/generated/prisma
git commit -m "feat: add durable order schema"
```

### Task 2: Order Number, Pricing Snapshot and State Domain

**Files:**
- Create: `src/modules/orders/order.types.ts`
- Create: `src/modules/orders/order.schemas.ts`
- Create: `src/modules/orders/order-number.service.ts`
- Create: `src/modules/orders/order-number.integration.test.ts`
- Create: `src/modules/orders/order.service.ts`
- Create: `src/modules/orders/order.service.integration.test.ts`

**Interfaces:**
- Produces: `nextOrderNumber(tx, submittedAt): Promise<string>`.
- Produces: `createOrderForUser(userId, input, context): Promise<PublicOrder>`.
- Produces: `updatePendingOrderForUser(userId, orderId, input, context): Promise<PublicOrder>`.
- Produces: `cancelPendingOrderForUser(userId, orderId, { reason, version }, context)`.

- [ ] **Step 1: Write failing tests** for Shanghai date rollover, 20 concurrent unique numbers, sequence 999 success/1000 `ORDER_DAILY_LIMIT_REACHED`, stable number after edit, trusted effective pricing, disabled material rejection, unlinked customer error, ownership, PAUSED write rejection, stale version and cancellation history.

- [ ] **Step 2: Run focused PostgreSQL tests and verify failure.**

- [ ] **Step 3: Implement the sequence using atomic PostgreSQL upsert/returning or row lock, then build line snapshots exclusively from database materials and Task 2 pricing service.**

```ts
export type OrderLineInput = { materialId: string; quantity: number };
export type UserOrderWriteInput = { contactName: string; ritualName: string; requestedDate: string; lines: OrderLineInput[]; version?: number };
```

- [ ] **Step 4: Implement ownership/status/version checks and transactional event/audit writes; run all focused and full integration tests.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/orders
git commit -m "feat: add trusted user order domain"
```

### Task 3: User Material Catalogue API

**Files:**
- Create: `src/app/api/materials/route.ts`
- Create: `src/app/api/materials/material-routes.integration.test.ts`
- Modify: `src/modules/materials/material.service.ts`

**Interfaces:**
- `GET /api/materials?query=` returns enabled materials with `effectivePriceCents` and `priceSource`; it never returns prices for another customer.

- [ ] **Step 1: Write failing route tests** for linked user default/override prices, alias search, archived exclusion, unlinked-user `409 CUSTOMER_PROFILE_REQUIRED`, and no cross-customer leakage.

- [ ] **Step 2: Run focused route tests and verify failure.**

- [ ] **Step 3: Add a customer-scoped catalogue query and thin authenticated GET route.** Require `ACTIVE` or read-capable `PAUSED` account, but never admin impersonation.

- [ ] **Step 4: Run route, permission, and pricing tests.**

- [ ] **Step 5: Commit.**

```bash
git add src/app/api/materials src/modules/materials
git commit -m "feat: expose customer priced material catalogue"
```

### Task 4: User Order APIs and TSV Builder

**Files:**
- Create: `src/modules/orders/order-copy.ts`
- Create: `src/modules/orders/order-copy.test.ts`
- Create: `src/app/api/orders/route.ts`
- Create: `src/app/api/orders/[id]/route.ts`
- Create: `src/app/api/orders/[id]/cancel/route.ts`
- Create: `src/app/api/orders/[id]/copy/route.ts`
- Create: `src/app/api/orders/order-routes.integration.test.ts`

**Interfaces:**
- `POST /api/orders`, `GET /api/orders`, `GET/PATCH /api/orders/:id`, `POST /api/orders/:id/cancel`.
- `GET /api/orders/:id/copy` returns `{ text }` only for `SCHEDULED`/`BURNED`; Stage 3 tests fixture access while Stage 4 activates confirmation.
- Produces: `buildOrderTsv(order): string` with no header and one material per row.

- [ ] **Step 1: Write failing unit/API tests** for strict contact/ritual/date/line DTOs, server repricing, pagination, ownership-as-404, illegal state, versions, cancellation reason and exact `20260730\t祭祖送钱\t金元宝\t5` output.

- [ ] **Step 2: Run focused tests and verify failure.**

- [ ] **Step 3: Implement exact TSV escaping policy:** reject tabs/newlines in ritual/material names at validation time, format final date as `yyyyMMdd`, join columns with tab and lines with `\n`.

- [ ] **Step 4: Add thin routes using shared guards and services; run route and domain tests.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/orders src/app/api/orders
git commit -m "feat: add customer owned order APIs"
```

### Task 5: User Order Interface

**Files:**
- Modify: `src/app/(protected)/home/page.tsx`
- Create: `src/app/(protected)/orders/new/page.tsx`
- Create: `src/app/(protected)/orders/[id]/page.tsx`
- Create: `src/components/orders/new-order-form.tsx`
- Create: `src/components/orders/order-list.tsx`
- Create: `src/components/orders/order-detail.tsx`
- Create: `src/components/orders/order-components.test.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/lib/api-client.ts`

**Interfaces:**
- Components use API DTOs only and send material ID/quantity, never trusted price.

- [ ] **Step 1: Write failing component tests** for contact name, ritual name, material search, quantity prefill, empty-to-one, invalid quantities, total display, submit, pending edit, cancel reason, version conflict refresh, unlinked-customer explanation and read-only confirmed state.

- [ ] **Step 2: Run component tests and verify failure.**

- [ ] **Step 3: Port approved interactions from prototype `NewOrder.tsx`, `UserHome.tsx` and `OrderDetail.tsx`; replace localStorage with API calls and accessible loading/error states.**

- [ ] **Step 4: Run component tests, lint, typecheck and build; inspect 1440px and 390px views.**

- [ ] **Step 5: Commit.**

```bash
git add src/app src/components/orders src/lib/api-client.ts
git commit -m "feat: add user ordering interface"
```

### Task 6: Stage 3 End-to-End Acceptance

**Files:**
- Create: `e2e/user-orders.spec.ts`
- Modify: `e2e/global-setup.ts`
- Create: `docs/reviews/stage-3-user-orders.md`

**Interfaces:**
- Seed links the E2E user to a customer and creates enabled, archived, default-price and override-price materials.

- [ ] **Step 1: Write failing E2E flows** for default quantity, explicit quantity, trusted total, order number, pending edit, cancel/history, unlinked-account block and cross-user access denial.

- [ ] **Step 2: Run the focused E2E file and verify failure, then complete missing wiring only.**

- [ ] **Step 3: Run full unit/integration/E2E, lint, typecheck, migration and build.**

- [ ] **Step 4: Record evidence, request review, fix Critical/Important findings and rerun full verification.**

- [ ] **Step 5: Commit.**

```bash
git add e2e docs/reviews/stage-3-user-orders.md
git commit -m "test: verify user order lifecycle"
```
