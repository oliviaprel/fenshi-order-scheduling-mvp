# Production Hardening and Business MVP Roadmap

**Design:** `docs/superpowers/specs/2026-08-02-production-hardening-business-mvp-design.md`

This umbrella roadmap is intentionally split into five implementation plans. Execute them in order; each stage must be merged and accepted before the next starts.

1. `2026-08-02-stage-1-production-hardening-implementation.md`
2. `2026-08-02-stage-2-customers-materials-pricing-implementation.md`
3. `2026-08-02-stage-3-user-orders-implementation.md`
4. `2026-08-02-stage-4-admin-scheduling-implementation.md`
5. `2026-08-02-stage-5-daily-tasks-notifications-implementation.md`

For every stage:

- Create an isolated `codex/` worktree at execution time.
- Use TDD and commit after every reviewer-sized task.
- Run unit, PostgreSQL integration, Playwright E2E, lint, typecheck and production build before stage review.
- Request a code review, fix all Critical and Important findings, and re-run scoped tests before integration.
- Keep `master` releasable; do not start the next stage on an unreviewed predecessor.
- Never import real customer data until the TencentDB restore drill is complete and recorded.

