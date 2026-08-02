# Stage 5 Daily Tasks and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the operational loop with burn completion, daily task/material summaries, copyable totals, idempotent reminders and user notifications.

**Architecture:** Build deterministic date-based summary functions over order read models, add a transactional burn command, then extend the Stage 1 maintenance runner with notification generation. Notification reads are recipient-scoped and writes use unique business keys.

**Tech Stack:** Next.js/React, TypeScript/Zod, Prisma/PostgreSQL, Vitest, Testing Library, Playwright, CVM maintenance CLI.

## Global Constraints

- Daily business date is `Asia/Shanghai`; burn timestamp is stored in UTC and displayed in Shanghai time.
- Only `SCHEDULED` orders count toward material preparation totals.
- Daily copied total includes that date’s `SCHEDULED` and `BURNED`, excludes `CANCELLED`.
- Daily copy contains customer name, ritual name, material quantities and burn time; pending work displays “待焚烧”.
- `BURNED` is terminal and immutable.
- Reminder generation is idempotent under repeated and concurrent maintenance runs.
- Users can read/mark only their own notifications; admins cannot impersonate recipients through public APIs.

---

### Task 1: Burn Completion Command

**Files:**
- Modify: `src/modules/scheduling/admin-order-command.service.ts`
- Modify: `src/modules/scheduling/admin-order-command.integration.test.ts`
- Create: `src/app/api/admin/orders/[id]/burn/route.ts`

**Interfaces:**
- Consumes the Stage 3 `Notification` model with unique `businessKey`.
- Produces: `markOrderBurned(id, { burnedAt, version }, context): Promise<AdminOrder>`.

- [ ] **Step 1: Write failing command tests** for scheduled-to-burned transition, exact timestamp, event/audit/notification atomicity, unique burn notification, stale version and terminal-state rejection.

- [ ] **Step 2: Run schema and command tests and verify failure.**

- [ ] **Step 3: Add the transactional burn command.** Use `ORDER_BURNED:<orderId>` as the completion notification key; skip user notification only when the customer has no linked user.

- [ ] **Step 4: Add strict admin burn route and run focused/full integration tests.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/scheduling src/app/api/admin/orders
git commit -m "feat: add burn completion and notification records"
```

### Task 2: Daily Summary and Copy Domain

**Files:**
- Create: `src/modules/scheduling/daily-summary.service.ts`
- Create: `src/modules/scheduling/daily-summary.integration.test.ts`
- Create: `src/modules/scheduling/daily-copy.ts`
- Create: `src/modules/scheduling/daily-copy.test.ts`
- Create: `src/app/api/admin/daily-tasks/route.ts`
- Create: `src/app/api/admin/daily-tasks/copy/route.ts`

**Interfaces:**
- Produces: `getDailySummary(date): { orders; preparationTotals; counts }`.
- Produces: `buildDailyCopyText(summary): string`.

- [ ] **Step 1: Write failing tests** for scheduled-only preparation totals, scheduled+burned copied orders, cancelled exclusion, actual Shanghai burn time, “待焚烧”, stable material first-seen ordering, empty date and exact Chinese output.

- [ ] **Step 2: Run focused tests and verify failure.**

- [ ] **Step 3: Implement one query/read model and pure formatter.** The formatter must include numbered orders and a final “物料合计” section; clipboard failure is handled by UI, not the domain.

- [ ] **Step 4: Add admin GET routes with `date=YYYY-MM-DD`, strict validation and authorization; run tests.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/scheduling src/app/api/admin/daily-tasks
git commit -m "feat: add daily task summaries and copy text"
```

### Task 3: Daily Task Interface

**Files:**
- Create: `src/app/(protected)/admin/daily-tasks/page.tsx`
- Create: `src/components/admin/daily-tasks.tsx`
- Create: `src/components/admin/daily-tasks.test.tsx`
- Modify: `src/components/admin/admin-navigation.tsx`
- Modify: `src/lib/api-client.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- UI consumes daily summary/copy routes and burn endpoint; it never computes authoritative totals locally.

- [ ] **Step 1: Write failing component tests** for date selection, order cards, preparation totals, burn confirmation/time, one-click all-table copy, disabled empty copy and manual text fallback.

- [ ] **Step 2: Run component tests and verify failure.**

- [ ] **Step 3: Port the approved `DailyTasks.tsx` structure, replace demo calculations with server read model, and refresh both task list and totals after burn completion.**

- [ ] **Step 4: Run component tests, lint/typecheck/build and inspect desktop/mobile layouts.**

- [ ] **Step 5: Commit.**

```bash
git add src/app src/components/admin src/lib/api-client.ts
git commit -m "feat: add daily burn task interface"
```

### Task 4: Recipient-Scoped Notification Service and API

**Files:**
- Create: `src/modules/notifications/notification.service.ts`
- Create: `src/modules/notifications/notification.service.integration.test.ts`
- Create: `src/app/api/notifications/route.ts`
- Create: `src/app/api/notifications/[id]/read/route.ts`
- Create: `src/app/api/notifications/notification-routes.integration.test.ts`

**Interfaces:**
- Produces: `listNotifications(userId, { cursor, limit })` with `unreadCount`.
- Produces: `markNotificationRead(userId, id): Promise<PublicNotification>`.

- [ ] **Step 1: Write failing tests** for recipient-only listing, unread count, idempotent read, cross-user 404, pagination and PAUSED-user read access.

- [ ] **Step 2: Run focused tests and verify failure.**

- [ ] **Step 3: Implement recipient-scoped queries and update; expose authenticated GET and Origin-protected read POST.**

- [ ] **Step 4: Run notification and permission tests.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/notifications src/app/api/notifications
git commit -m "feat: add recipient scoped notifications"
```

### Task 5: Idempotent Due-Today Notification Maintenance

**Files:**
- Modify: `src/modules/maintenance/maintenance.service.ts`
- Modify: `src/modules/maintenance/maintenance.integration.test.ts`
- Modify: `docs/runbooks/maintenance.md`

**Interfaces:**
- Adds `dueTodayNotifications` to `MaintenanceResult`.
- Notification key is `ORDER_DUE_TODAY:<orderId>:<YYYY-MM-DD>`.

- [ ] **Step 1: Write failing tests** for due-today scheduled orders, excluded burned/cancelled/future orders, customers without linked users, repeated run, and two concurrent runs producing one row.

- [ ] **Step 2: Run maintenance integration tests and verify failure.**

- [ ] **Step 3: Insert notifications with unique business keys and conflict-ignore semantics inside the daily maintenance flow.** Use the injected Shanghai business date, not server-local date.

- [ ] **Step 4: Run maintenance twice and concurrently; update the runbook’s expected JSON output and alert condition.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/maintenance docs/runbooks/maintenance.md
git commit -m "feat: generate idempotent due today reminders"
```

### Task 6: Notification UI and Final End-to-End Acceptance

**Files:**
- Create: `src/components/notifications/notification-menu.tsx`
- Create: `src/components/notifications/notification-menu.test.tsx`
- Modify: `src/components/app-shell.tsx`
- Create: `e2e/daily-tasks-notifications.spec.ts`
- Modify: `e2e/global-setup.ts`
- Create: `docs/reviews/stage-5-final-mvp.md`
- Modify: `README.md`

**Interfaces:**
- Header displays unread count; opening lists notifications; selecting one marks it read and navigates to its owned order when applicable.

- [ ] **Step 1: Write failing component and E2E tests** for unread badge, read action, due-today reminder, burn completion notification, daily total copy, actual burn time, terminal read-only order and mobile behavior.

- [ ] **Step 2: Run focused tests and verify failure.**

- [ ] **Step 3: Implement notification menu using Task 4 APIs and accessible live-region feedback.** Do not poll faster than once per minute; initial MVP may refresh on navigation/menu open.

- [ ] **Step 4: Run the full production verification set, Docker/Caddy smoke, maintenance replay and all desktop/mobile E2E.**

- [ ] **Step 5: Request final code and production-readiness review.** Fix all Critical/Important findings; record remaining external TencentDB restore drill as an open gate, not a passed test.

- [ ] **Step 6: Commit.**

```bash
git add src/components src/components/app-shell.tsx e2e docs/reviews README.md
git commit -m "feat: complete daily tasks and notification MVP"
```
