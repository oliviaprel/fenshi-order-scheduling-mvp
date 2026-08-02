# Stage 1 Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the confirmed production audit gaps without adding business-domain features.

**Architecture:** Harden the shared HTTP boundary first, then authentication concurrency, edge exposure, database privileges, maintenance, and image supply chain. Keep all behavior behind the existing Route Handler, Prisma, Docker, and Caddy boundaries.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript 5.9, Zod 4, Prisma 7/PostgreSQL 17, Vitest, Playwright, Docker, Caddy, GitHub Actions, GHCR, Trivy, Syft, Cosign/ GitHub artifact attestations.

## Global Constraints

- JSON request bodies are capped at exactly 32 KiB (32,768 bytes), including requests without `Content-Length`.
- Accepted client request IDs are UUIDs or 1–64 characters matching `[A-Za-z0-9._:-]+`; otherwise generate a UUID.
- Production cookie name is `__Host-fenshi_session`; development/test cookie name is `fenshi_session`.
- Public Caddy exposes `/api/health/live` and returns `404` for `/api/health/ready`.
- `MIGRATION_DATABASE_URL` is DDL-only; `DATABASE_URL` is runtime DML-only.
- Audit logs remain online for two years, are encrypted before deletion, and order history is not touched.
- CI targets `master`; production images are public GHCR images deployed by immutable digest.

---

### Task 1: Bounded JSON Parsing and Safe Request IDs

**Files:**
- Modify: `src/server/http/route-handler.ts`
- Modify: `src/server/http/request-id.ts`
- Modify: `src/server/http/api-error.ts`
- Test: `src/server/http/route-handler.integration.test.ts`
- Create: `src/server/http/request-id.test.ts`

**Interfaces:**
- Produces: `parseJsonBody<T>(request, schema, maxBytes?: number): Promise<T>` with default `32768`.
- Produces: `getRequestId(request: Request): string` returning only a validated ID or server UUID.

- [ ] **Step 1: Write failing tests** for a 32,768-byte JSON body, a 32,769-byte body, chunked/no-length oversized input, malformed JSON, 64-character safe ID, 65-character ID, unsafe ID, and UUID fallback.

```ts
expect((await response.json()).code).toBe("PAYLOAD_TOO_LARGE");
expect(response.status).toBe(413);
expect(getRequestId(new Request(url, { headers: { "x-request-id": "x".repeat(65) } }))).toMatch(uuidPattern);
```

- [ ] **Step 2: Run the focused tests and verify failure.**

Run: `npm run test:unit -- src/server/http/request-id.test.ts && npm run test:integration -- src/server/http/route-handler.integration.test.ts`

- [ ] **Step 3: Implement bounded reading before JSON parsing.** Read `request.body` with a reader, accumulate bytes only up to `maxBytes + 1`, cancel the reader on overflow, decode UTF-8, then call `JSON.parse`; reject oversized `Content-Length` before reading.

```ts
export const MAX_JSON_BODY_BYTES = 32 * 1024;
export function isAcceptedRequestId(value: string): boolean {
  return value.length <= 64 && /^[A-Za-z0-9._:-]+$/.test(value);
}
```

- [ ] **Step 4: Run focused tests, then `npm run test`, `npm run lint`, and `npm run typecheck`.**

- [ ] **Step 5: Commit.**

```bash
git add src/server/http
git commit -m "fix: bound request bodies and request ids"
```

### Task 2: Unknown Error Logging and Comprehensive Redaction

**Files:**
- Modify: `src/server/http/route-handler.ts`
- Modify: `src/server/logging/logger.ts`
- Modify: `src/server/logging/redaction.ts`
- Modify: `src/server/logging/redaction.test.ts`
- Modify: `src/server/http/route-handler.integration.test.ts`

**Interfaces:**
- Produces: `isSensitiveKey(key: string): boolean` using normalized substring matching.
- Route failures log only `requestId`, `method`, `pathname`, `errorName`, and a production-safe message.

- [ ] **Step 1: Write failing tests** proving `temporaryPassword`, `currentPassword`, `newPassword`, `sessionToken`, `setCookie`, `clientSecret`, `DATABASE_URL`, and nested values are redacted; prove an unknown thrown error creates one structured error log without request body.

- [ ] **Step 2: Run tests and verify the new assertions fail.**

Run: `npm run test:unit -- src/server/logging/redaction.test.ts && npm run test:integration -- src/server/http/route-handler.integration.test.ts`

- [ ] **Step 3: Implement normalized key matching and route logging.**

```ts
const fragments = ["password", "token", "cookie", "authorization", "secret", "databaseurl", "connectionstring"];
export const isSensitiveKey = (key: string) => fragments.some((item) => key.replace(/[^a-z]/gi, "").toLowerCase().includes(item));
```

Call `logger.error("Unhandled route error", { requestId, method, pathname, errorName })` only when the error is not an expected `ApiError`.

- [ ] **Step 4: Run focused and full unit/integration suites.**

- [ ] **Step 5: Commit.**

```bash
git add src/server/http src/server/logging
git commit -m "fix: log unknown errors with safe redaction"
```

### Task 3: Optimistic Password Reset and Complete User Audit Diffs

**Files:**
- Modify: `src/modules/users/admin-user.service.ts`
- Modify: `src/app/api/admin/users/[id]/reset-password/route.ts`
- Modify: `src/components/admin/reset-password-dialog.tsx`
- Modify: `src/modules/users/admin-user.service.integration.test.ts`
- Modify: `src/app/api/admin/users/admin-user-routes.integration.test.ts`

**Interfaces:**
- Changes: `resetManagedUserPassword(id, expectedVersion, context)`.
- Reset request DTO is exactly `{ version: number }`.

- [ ] **Step 1: Write failing service and route tests** for a successful versioned reset, stale `409 USER_VERSION_CONFLICT`, missing version `422`, and audit `beforeJson` containing the prior public user fields without secrets.

- [ ] **Step 2: Run focused tests and verify failure.**

- [ ] **Step 3: Fetch the prior public user inside the transaction, update with `where: { id, role: "USER", version }`, increment version, revoke sessions, and write safe before/after audit snapshots.** Update the dialog to submit the displayed user version and refresh on `409`.

- [ ] **Step 4: Run service, route and admin page tests; then lint/typecheck.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/users src/app/api/admin/users src/components/admin
git commit -m "fix: make admin user mutations concurrency safe"
```

### Task 4: Cookie, HSTS and Health-Check Exposure

**Files:**
- Modify: `src/modules/auth/session.service.ts`
- Modify: `src/app/api/auth/auth-routes.integration.test.ts`
- Modify: `next.config.ts`
- Modify: `src/next-config.test.ts`
- Modify: `deploy/Caddyfile.example`
- Modify: `compose.production.example.yaml`
- Modify: `docs/runbooks/deploy-tencent-cloud.md`

**Interfaces:**
- Produces: `getSessionCookieName(nodeEnv): "__Host-fenshi_session" | "fenshi_session"`.
- Public ready response is a Caddy-generated `404`; Docker calls `app:3000/api/health/ready` directly.

- [ ] **Step 1: Write failing tests** for environment-specific cookie names and the HSTS header `max-age=31536000`; add a configuration assertion that Caddy handles ready with `respond 404` before proxying live.

- [ ] **Step 2: Run focused tests and verify failure.**

- [ ] **Step 3: Centralize cookie naming for get/set/delete, add HSTS in Next headers, and replace the Caddy combined health matcher with explicit public live proxy and public ready denial.** Keep Compose healthcheck pointed directly at the app service.

- [ ] **Step 4: Run auth, health and config tests; validate Caddy with `docker run --rm -v ${PWD}/deploy/Caddyfile.example:/etc/caddy/Caddyfile:ro caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile`.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/auth src/app/api/auth next.config.ts src/next-config.test.ts deploy compose.production.example.yaml docs/runbooks
git commit -m "fix: harden cookies headers and health exposure"
```

### Task 5: Runtime and Migration Database Roles

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts`
- Modify: `.env.example`
- Modify: `prisma.config.ts`
- Modify: `compose.production.example.yaml`
- Modify: `docs/deployment-security.md`
- Modify: `docs/runbooks/deploy-tencent-cloud.md`
- Create: `docs/runbooks/postgresql-roles.sql`

**Interfaces:**
- Runtime code consumes only `DATABASE_URL`.
- Prisma deployment commands consume only `MIGRATION_DATABASE_URL` through `prisma.config.ts`.

- [ ] **Step 1: Write failing env tests** proving production migration configuration rejects a missing `MIGRATION_DATABASE_URL` while the web runtime still parses only `DATABASE_URL`.

- [ ] **Step 2: Run `npm run test:unit -- src/lib/env.test.ts` and verify failure.**

- [ ] **Step 3: Add the separate variable and an idempotent SQL runbook** creating `fenshi_migrator` and `fenshi_app`, granting schema DDL only to the migrator, table/sequence DML to the app, and setting default privileges for objects created by the migrator.

```ts
env("MIGRATION_DATABASE_URL")
```

- [ ] **Step 4: Test `prisma validate` and `prisma migrate deploy` against separate local roles, then prove an app-role `CREATE TABLE` fails and normal app queries pass.**

- [ ] **Step 5: Commit.**

```bash
git add .env.example prisma.config.ts src/lib compose.production.example.yaml docs
git commit -m "feat: separate runtime and migration database roles"
```

### Task 6: Idempotent Maintenance CLI and Retention

**Files:**
- Create: `src/modules/maintenance/maintenance.service.ts`
- Create: `src/modules/maintenance/maintenance.integration.test.ts`
- Create: `src/modules/maintenance/maintenance-cli.ts`
- Create: `scripts/run-maintenance.ts`
- Create: `src/modules/maintenance/encrypted-audit-archive.ts`
- Create: `src/modules/maintenance/encrypted-audit-archive.test.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Create: `docs/runbooks/maintenance.md`

**Interfaces:**
- Produces: `runMaintenance({ now, auditArchive }): Promise<MaintenanceResult>`.
- `AuditArchive.write(records)` must durably write an encrypted archive and return an archive ID before deletion occurs.
- CLI command: `npm run maintenance:daily`.

- [ ] **Step 1: Write failing PostgreSQL tests** seeding expired/live sessions, reservations, throttle rows and audit rows around the two-year boundary. Assert only eligible rows are removed, deletion does not occur when archive writing fails, and a second run returns zero additional removals.

- [ ] **Step 2: Run the focused integration test and verify failure.**

- [ ] **Step 3: Implement small transactional cleanup functions and the archive-before-delete boundary.**

```ts
export type MaintenanceResult = {
  expiredSessions: number;
  expiredReservations: number;
  staleThrottles: number;
  archivedAuditLogs: number;
  archiveId: string | null;
};
```

Implement the filesystem adapter as UTF-8 NDJSON compressed with gzip and encrypted using AES-256-GCM. Read a 32-byte base64 key from `AUDIT_ARCHIVE_KEY` and directory from `AUDIT_ARCHIVE_DIR`; write to a temporary file, fsync, atomically rename, and return a manifest containing filename, record count, IV, authentication tag and SHA-256 ciphertext digest. Never print records or the key to stdout.

- [ ] **Step 4: Add the CLI, JSON result output, non-zero failure exit, and systemd timer/cron examples; run twice against the test database.**

- [ ] **Step 5: Commit.**

```bash
git add src/modules/maintenance scripts package.json package-lock.json docs/runbooks/maintenance.md
git commit -m "feat: add idempotent daily maintenance"
```

### Task 7: Master CI, Container Scan, SBOM and GHCR Attestation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/publish-image.yml`
- Create: `.github/dependabot.yml`
- Create: `scripts/validate-workflows.mjs`
- Modify: `package.json`
- Modify: `docs/runbooks/deploy-tencent-cloud.md`
- Create: `docs/runbooks/github-ruleset.md`

**Interfaces:**
- PR workflow builds but never pushes `ghcr.io/oliviaprel/fenshi-order-scheduling-mvp`.
- Master workflow publishes `sha-<full commit>` and `latest`, creates SPDX JSON SBOM, scans High/Critical findings, and generates GitHub provenance attestation.

- [ ] **Step 1: Add `scripts/validate-workflows.mjs` and `npm run test:workflows`** to parse both YAML files as text and fail unless CI contains `branches: [master]`, Docker build/smoke, Trivy and SBOM steps, while `packages: write` and push behavior appear only in the master publish workflow.

- [ ] **Step 2: Run the static check and verify it fails on the current workflow.**

- [ ] **Step 3: Update CI and add publishing.** Use pinned major official actions, `docker/build-push-action`, `anchore/sbom-action`, `aquasecurity/trivy-action`, and `actions/attest-build-provenance`; grant `packages: write`, `id-token: write`, and `attestations: write` only to publishing.

- [ ] **Step 4: Run full local verification and push a test PR.** Confirm PR checks do not publish; after merge confirm the package is public, digest is recorded, SBOM downloads, scan passes, and attestation verifies.

- [ ] **Step 5: Apply the documented GitHub ruleset** requiring PRs and named checks on `master`, without mandatory approval, and record screenshots or API output in the deployment evidence folder.

- [ ] **Step 6: Commit.**

```bash
git add .github scripts/validate-workflows.mjs package.json package-lock.json docs/runbooks
git commit -m "ci: publish scanned attested GHCR images"
```

### Task 8: Stage 1 Verification and Audit Evidence

**Files:**
- Create: `docs/reviews/stage-1-production-hardening.md`
- Modify: `README.md`

**Interfaces:**
- Produces an evidence matrix mapping H1, H3–H5, M1–M7, L1–L2 to commits and commands; H2 remains explicitly external, and L3 remains deferred.

- [ ] **Step 1: Run the complete verification set.**

```bash
npm ci
npm run prisma:generate
npm run lint
npm run typecheck
npm run prisma:validate
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm audit --omit=dev --audit-level=high
docker build -t fenshi-stage1:test .
```

- [ ] **Step 2: Run the container as UID 1001, verify live and internal ready, and verify public ready is 404 through Caddy.**

- [ ] **Step 3: Write exact results, image digest, known external restore gate, and CSP deferral into the review document; update README production status.**

- [ ] **Step 4: Request code review, fix all Critical/Important findings, and rerun affected plus full verification.**

- [ ] **Step 5: Commit.**

```bash
git add docs/reviews/stage-1-production-hardening.md README.md
git commit -m "docs: record stage 1 hardening evidence"
```
