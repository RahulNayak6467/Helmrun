# 004: Monorepo layout and test placement (2026-10-03)

Phase: 0
Status: Accepted

## Decision
pnpm workspace with `apps/` (runnable processes) and `packages/` (shared code).

- Phase 0 apps: `api` (real), `scheduler` and `worker` (empty shells).
- Phase 0 packages: `config`, `database`, `logger`, `shared`. Packages are added
  only when code is genuinely shared.
- Dependency direction: apps → packages only. Packages never import apps. No
  cycles. `shared` depends on nothing.
- Migrations live in `packages/database/migrations/`.
- Tests live inside each app/package: unit and API tests next to the code
  (`*.test.ts`), integration tests in that package's `test/integration/`,
  helpers in `test/support/`.

Deferred (tracked in `docs/progress/README.md` → Deferred items):
- `apps/dashboard` and `apps/cli` → phase 8
- `infrastructure/terraform/` → phase 7
- top-level `tests/e2e/` for cross-app tests → phase 3

## Why
- Separate processes need shared config/DB/logging code without copy-paste
  (polyrepo) or blurred boundaries (single package).
- Per-package tests travel with their package and run with `pnpm --filter`.
- Empty shells for phase-8/phase-7 work would only be dependencies to maintain
  for months.

## Alternatives considered
- Spec's top-level `tests/` folder: separates tests from the code they cover;
  kept only for cross-app e2e tests from phase 3.
- Creating all five app shells in phase 0: allowed by the spec, but adds churn
  for no benefit until phase 8.
- Root-level `migrations/`: the database package owns the schema, so its
  migrations belong with it.
