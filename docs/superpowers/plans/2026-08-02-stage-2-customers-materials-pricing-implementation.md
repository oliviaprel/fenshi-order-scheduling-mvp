# Stage 2 Customers, Materials and Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give administrators a persistent customer directory, material library, aliases, default prices, login-account links and customer-specific prices.

**Architecture:** Add normalized Prisma entities, then build server-only domain services and narrow admin APIs before adapting the approved prototype UI. Price resolution is a pure server-owned interface consumed later by orders.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Prisma/PostgreSQL, Vitest, Testing Library, Playwright.

## Global Constraints

- Money is integer RMB cents; zero is valid and negative values are invalid.
- Customer is independent and may link to at most one `USER`; a User may link to at most one Customer.
- Enabled material names are unique after trim/case normalization.
- Material deletion is soft deletion; history and customer prices remain.
- Alias input accepts Chinese and ASCII commas, trims and deduplicates values.
- Customer-specific price wins over default price; deleting it restores the default.
- Every admin write requires Origin, active admin Session, strict Zod DTO, `version`, transaction and AuditLog.

---

### Task 1: Customer, Material, Alias and Price Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_customers_materials_pricing/migration.sql`
- Modify: `src/server/db/schema.integration.test.ts`

**Interfaces:**
- Produces Prisma models `Customer`, `Material`, `MaterialAlias`, `CustomerMaterialPrice` and optional one-to-one `User.customer`.

- [ ] **Step 1: Add failing schema integration assertions** for unique `Customer.linkedUserId`, unique normalized customer/material names, unique alias normalization, unique `(customerId, materialId)`, non-negative price checks and indexes on active/search fields.

- [ ] **Step 2: Run `npm run prisma:validate` and the schema integration test; confirm failure before migration.**

- [ ] **Step 3: Add Prisma models and hand-written PostgreSQL CHECK constraints.** Store `defaultPriceCents` and `priceCents` as `Int`; add `version Int @default(1)`, `active`, timestamps and restrictive relations that prevent accidental historical deletion.

- [ ] **Step 4: Regenerate Prisma, deploy into an empty test database, and prove all constraints with integration tests.**

- [ ] **Step 5: Commit.**

```bash
git add prisma src/server/db/schema.integration.test.ts src/generated/prisma
git commit -m "feat: add customer material and pricing schema"
```

### Task 2: Customer Domain Service and Admin API

**Files:**
- Create: `src/modules/customers/customer.schemas.ts`
- Create: `src/modules/customers/customer.types.ts`
- Create: `src/modules/customers/customer.service.ts`
- Create: `src/modules/customers/customer.service.integration.test.ts`
- Create: `src/app/api/admin/customers/route.ts`
- Create: `src/app/api/admin/customers/[id]/route.ts`
- Create: `src/app/api/admin/customers/[id]/link-user/route.ts`
- Create: `src/app/api/admin/customers/customer-routes.integration.test.ts`

**Interfaces:**
- Produces: `listCustomers({ query, cursor, limit })`.
- Produces: `createCustomer({ displayName }, adminContext)`.
- Produces: `updateCustomer(id, { displayName, version }, adminContext)`.
- Produces: `setCustomerUserLink(id, { userId: string | null, version }, adminContext)`.

- [ ] **Step 1: Write failing service tests** for trim/unique names, search, rename preserving ID, link/unlink, duplicate-user conflict, stale version, admin-user rejection and safe audit before/after.

- [ ] **Step 2: Run focused integration tests and verify failure.**

- [ ] **Step 3: Implement normalization, cursor listing and transactional optimistic writes.** Map database uniqueness failures to stable `409 CUSTOMER_NAME_EXISTS` and `409 USER_ALREADY_LINKED` errors.

- [ ] **Step 4: Add strict admin routes using `routeHandler`, `assertAllowedOrigin`, `requireAdmin` and `parseJsonBody`; test 401/403/409/422 and success responses.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/customers src/app/api/admin/customers
git commit -m "feat: add customer management APIs"
```

### Task 3: Material, Alias and Effective Price Services

**Files:**
- Create: `src/modules/materials/material.schemas.ts`
- Create: `src/modules/materials/material.types.ts`
- Create: `src/modules/materials/material.service.ts`
- Create: `src/modules/materials/material.service.integration.test.ts`
- Create: `src/modules/pricing/pricing.service.ts`
- Create: `src/modules/pricing/pricing.service.integration.test.ts`

**Interfaces:**
- Produces: `normalizeAliases(input: string | string[]): string[]`.
- Produces CRUD functions `createMaterial`, `updateMaterial`, `archiveMaterial`, `restoreMaterial`, `listAdminMaterials`.
- Produces: `resolveEffectivePrice(tx, customerId, materialId): Promise<{ priceCents; source: "CUSTOMER" | "DEFAULT" }>`.
- Produces: `upsertCustomerPrice` and `deleteCustomerPrice` with versions/audit.

- [ ] **Step 1: Write failing tests** for alias split/trim/dedupe, enabled-name uniqueness, restore conflict, soft deletion, zero price, negative rejection, customer override and fallback after deletion.

- [ ] **Step 2: Run focused tests and verify failure.**

- [ ] **Step 3: Implement services with one transaction per mutation.** Persist aliases by replacing the material’s alias set in the same transaction; retain aliases and price records when archiving.

```ts
export type EffectivePrice = { priceCents: number; source: "CUSTOMER" | "DEFAULT" };
```

- [ ] **Step 4: Run focused tests plus full integration suite.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/materials src/modules/pricing
git commit -m "feat: add material library and effective pricing"
```

### Task 4: Material and Customer-Price Admin APIs

**Files:**
- Create: `src/app/api/admin/materials/route.ts`
- Create: `src/app/api/admin/materials/[id]/route.ts`
- Create: `src/app/api/admin/materials/[id]/archive/route.ts`
- Create: `src/app/api/admin/materials/[id]/restore/route.ts`
- Create: `src/app/api/admin/materials/[id]/prices/route.ts`
- Create: `src/app/api/admin/materials/[id]/prices/[customerId]/route.ts`
- Create: `src/app/api/admin/materials/material-routes.integration.test.ts`

**Interfaces:**
- JSON uses `defaultPriceCents`/`priceCents`; display formatting remains a UI concern.
- Material price rows include customer ID/name, effective source and current customer-price version.

- [ ] **Step 1: Write failing route tests** for listing, create/edit, archive/restore, alias validation, price upsert/delete, stale versions and all permission failures.

- [ ] **Step 2: Run the route tests and verify failure.**

- [ ] **Step 3: Add strict schemas and thin Route Handlers calling Task 3 services.** Do not expose Prisma objects directly.

- [ ] **Step 4: Run route tests, lint and typecheck.**

- [ ] **Step 5: Commit.**

```bash
git add src/app/api/admin/materials
git commit -m "feat: expose material and price admin APIs"
```

### Task 5: Admin Material Library and Customer Selection UI

**Files:**
- Modify: `src/components/app-shell.tsx`
- Create: `src/app/(protected)/admin/materials/page.tsx`
- Create: `src/components/admin/material-library.tsx`
- Create: `src/components/admin/material-form-dialog.tsx`
- Create: `src/components/admin/customer-price-dialog.tsx`
- Create: `src/components/admin/customer-selector.tsx`
- Create: `src/components/admin/material-library.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- UI calls only Stage 2 admin endpoints through typed helpers added to `src/lib/api-client.ts`.

- [ ] **Step 1: Write failing component tests** for navigation, add/edit, field errors, archive confirmation, restore, customer search/add/rename/link, per-customer price save/delete and mobile controls.

- [ ] **Step 2: Run the component tests and verify failure.**

- [ ] **Step 3: Port the approved prototype interaction from `D:\Projects\Codingproject\下单程序\app\features\admin\MaterialLibrary.tsx`, replacing local state with APIs and adding explicit customer/User linkage.** Preserve entered dialog values after server validation errors.

- [ ] **Step 4: Run component tests and production build; manually inspect desktop 1440px and mobile 390px layouts.**

- [ ] **Step 5: Commit.**

```bash
git add src/components src/app src/lib/api-client.ts
git commit -m "feat: add admin material and pricing interface"
```

### Task 6: Stage 2 End-to-End Acceptance

**Files:**
- Create: `e2e/admin-materials.spec.ts`
- Modify: `e2e/global-setup.ts`
- Create: `docs/reviews/stage-2-customers-materials-pricing.md`

**Interfaces:**
- E2E seed creates two ordinary users, one linked customer, one unlinked customer and no business orders.

- [ ] **Step 1: Write failing E2E flows** covering customer creation/linking, material creation and alias search, customer price override, archive/restore, duplicate conflict and mobile navigation.

- [ ] **Step 2: Run `npm run test:e2e -- e2e/admin-materials.spec.ts` and verify failure, then complete only the missing acceptance wiring.**

- [ ] **Step 3: Run all unit/integration/E2E, lint, typecheck, Prisma validation/migration and build.**

- [ ] **Step 4: Record commands and results, request code review, fix Critical/Important findings and rerun verification.**

- [ ] **Step 5: Commit.**

```bash
git add e2e docs/reviews/stage-2-customers-materials-pricing.md
git commit -m "test: verify customer material and pricing workflows"
```

