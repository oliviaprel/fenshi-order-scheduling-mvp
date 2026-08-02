# Stage 4 Admin Confirmation and Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the administrator workflow for pending review, confirmation, future schedule search, scheduled-order editing, cancellation and per-order Excel copying.

**Architecture:** Extend the order service with explicit administrator commands and read models, keeping status transitions transactional. Admin pages reuse one pending queue and one confirmed-order search model across list and calendar views.

**Tech Stack:** Next.js/React, TypeScript/Zod, Prisma/PostgreSQL, Vitest, Testing Library, Playwright.

## Global Constraints

- “待确认” directly reuses the homepage “微信核对队列 / 待确认订单” row component.
- “日程中心” is renamed everywhere to “已确认”.
- Admin may edit `PENDING_CONFIRMATION` and `SCHEDULED`; user cannot edit after confirmation.
- `BURNED` and `CANCELLED` are read-only.
- Confirm/edit/cancel requires current `version` and atomic Order/Line/Event/Audit writes.
- Order number never changes; per-order TSV uses the current final scheduled date.
- Cancellation preserves reason, operator, time and history; no delete endpoint exists.

---

### Task 1: Admin Order Read Models and Filters

**Files:**
- Create: `src/modules/scheduling/admin-order-query.service.ts`
- Create: `src/modules/scheduling/admin-order-query.integration.test.ts`
- Create: `src/modules/scheduling/schedule.types.ts`
- Create: `src/app/api/admin/orders/route.ts`
- Create: `src/app/api/admin/orders/admin-order-routes.integration.test.ts`

**Interfaces:**
- Produces: `listAdminOrders({ query, status, dateFrom, dateTo, overdue, cursor, limit, today })`.
- Produces: `getScheduleMonth({ year, month }): { date; scheduled; burned; cancelled }[]`.

- [ ] **Step 1: Write failing query tests** for name/ritual/order-number search, pending/today/future/burned/cancelled filters, overdue (`finalDate < today && status === SCHEDULED`), Shanghai date boundaries and cursor stability.

- [ ] **Step 2: Run focused integration tests and verify failure.**

- [ ] **Step 3: Implement DTO-focused Prisma queries and explicit `today` injection for deterministic tests.** Cancelled records remain searchable but are excluded from active counts.

- [ ] **Step 4: Add authenticated admin GET route with strict query parsing; run route/query tests.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/scheduling src/app/api/admin/orders
git commit -m "feat: add admin order schedule queries"
```

### Task 2: Pending Edit and Confirmation Commands

**Files:**
- Modify: `src/modules/orders/order.service.ts`
- Modify: `src/modules/orders/order.schemas.ts`
- Create: `src/modules/scheduling/admin-order-command.service.ts`
- Create: `src/modules/scheduling/admin-order-command.integration.test.ts`
- Create: `src/app/api/admin/orders/[id]/route.ts`
- Create: `src/app/api/admin/orders/[id]/confirm/route.ts`

**Interfaces:**
- Produces: `updateOrderAsAdmin(id, input, context)` for pending/scheduled states.
- Produces: `confirmOrder(id, { finalDate, version }, context)` transitioning pending to scheduled.

- [ ] **Step 1: Write failing tests** for pending edits with server repricing, confirmation, same-number preservation, `ORDER_CONFIRMED:<orderId>:<version>` customer notification plus event/audit creation, stale version, concurrent double confirm, and illegal burned/cancelled edits.

- [ ] **Step 2: Run focused tests and verify failure.**

- [ ] **Step 3: Implement explicit admin commands inside serializable or optimistic transactions.** Confirmation sets `finalDate`, increments version and writes `ORDER_CONFIRMED` event plus a linked-user notification in the same transaction; it never mutates `orderNumber`.

- [ ] **Step 4: Add PATCH and confirm routes; test permission, validation, state and concurrency responses.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/orders src/modules/scheduling src/app/api/admin/orders
git commit -m "feat: add admin review and confirmation commands"
```

### Task 3: Scheduled Edit and Admin Cancellation

**Files:**
- Modify: `src/modules/scheduling/admin-order-command.service.ts`
- Modify: `src/modules/scheduling/admin-order-command.integration.test.ts`
- Create: `src/app/api/admin/orders/[id]/cancel/route.ts`
- Modify: `src/app/api/admin/orders/admin-order-routes.integration.test.ts`

**Interfaces:**
- `updateOrderAsAdmin` accepts line/date/ritual changes for `SCHEDULED` and reprices changed lines.
- Produces: `cancelOrderAsAdmin(id, { reason, version }, context)` for pending/scheduled orders.

- [ ] **Step 1: Write failing tests** for schedule date/material/quantity changes, recalculated totals, task date movement, linked-user `ORDER_UPDATED_BY_ADMIN`/`ORDER_CANCELLED` notifications, cancellation tuple/history, empty reason, stale versions and immutable archived states.

- [ ] **Step 2: Run focused tests and verify failure.**

- [ ] **Step 3: Implement transactional scheduled edits and cancellation.** Scheduled edits notify the linked user using the resulting version in the business key. Cancellation sets status/details, increments version, creates `ORDER_CANCELLED` event, linked-user notification and audit record, and leaves lines intact.

- [ ] **Step 4: Add the cancel route and run service/route/full integration tests.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/scheduling src/app/api/admin/orders
git commit -m "feat: edit and cancel scheduled orders"
```

### Task 4: Admin Shell, Dashboard and Pending Queue

**Files:**
- Modify: `src/components/app-shell.tsx`
- Create: `src/app/(protected)/admin/page.tsx`
- Create: `src/app/(protected)/admin/pending/page.tsx`
- Create: `src/components/admin/admin-navigation.tsx`
- Create: `src/components/admin/pending-queue.tsx`
- Create: `src/components/admin/order-review-dialog.tsx`
- Create: `src/components/admin/pending-queue.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Dashboard and pending page render the same `PendingQueue` component with different page framing.

- [ ] **Step 1: Write failing component tests** proving the sidebar click navigates directly, dashboard/pending rows have identical fields/actions, search works, review edits persist, confirm handles conflict, and mobile navigation is usable.

- [ ] **Step 2: Run component tests and verify failure.**

- [ ] **Step 3: Port `PendingQueue.tsx`, `PendingOrders.tsx` and `OrderReview.tsx` from the approved prototype, replacing demo store calls with Stage 4 APIs.** Keep the label “微信核对队列 / 待确认订单”.

- [ ] **Step 4: Run component tests, lint/typecheck/build and inspect desktop/mobile.**

- [ ] **Step 5: Commit.**

```bash
git add src/app src/components/admin src/components/app-shell.tsx
git commit -m "feat: add admin pending review workflow"
```

### Task 5: Confirmed List, Calendar, Editing and TSV Copy

**Files:**
- Create: `src/app/(protected)/admin/confirmed/page.tsx`
- Create: `src/components/admin/confirmed-orders.tsx`
- Create: `src/components/admin/schedule-calendar.tsx`
- Create: `src/components/admin/admin-order-editor.tsx`
- Create: `src/components/admin/confirmed-orders.test.tsx`
- Modify: `src/lib/api-client.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- List/calendar share one filter state and `/api/admin/orders` read model.
- Copy uses the existing user-safe `/api/orders/:id/copy` only for owned users; admin gets an admin-authorized equivalent at `/api/admin/orders/:id/copy` calling the same `buildOrderTsv`.

- [ ] **Step 1: Write failing tests** for the “已确认” name, list/calendar switch, future/date/status/text filters, overdue deep-link, scheduled edit, cancelled history, immutable burned/cancelled rows, and copy success/fallback.

- [ ] **Step 2: Run component tests and verify failure.**

- [ ] **Step 3: Port the approved `ScheduleCenter.tsx` interactions, rename all visible/ARIA copy to “已确认”, and connect APIs.** Add the admin copy route as a thin permission wrapper over `buildOrderTsv`.

- [ ] **Step 4: Run component, route and build tests; inspect desktop/mobile calendar behavior.**

- [ ] **Step 5: Commit.**

```bash
git add src/app src/components/admin src/lib/api-client.ts
git commit -m "feat: add confirmed order schedule interface"
```

### Task 6: Stage 4 End-to-End Acceptance

**Files:**
- Create: `e2e/admin-scheduling.spec.ts`
- Modify: `e2e/global-setup.ts`
- Create: `docs/reviews/stage-4-admin-scheduling.md`

**Interfaces:**
- Fixtures include pending, scheduled future, overdue, burned and cancelled orders.

- [ ] **Step 1: Write failing E2E flows** for direct pending navigation, edit/confirm, future calendar lookup, scheduled edit, cancellation history, user read-only confirmation, per-order clipboard TSV and overdue filter.

- [ ] **Step 2: Run the focused E2E and verify failure, then complete missing wiring only.**

- [ ] **Step 3: Run complete unit/integration/E2E, lint, typecheck, migration and build.**

- [ ] **Step 4: Record evidence, request review, resolve Critical/Important findings and rerun verification.**

- [ ] **Step 5: Commit.**

```bash
git add e2e docs/reviews/stage-4-admin-scheduling.md
git commit -m "test: verify admin confirmation and scheduling"
```
