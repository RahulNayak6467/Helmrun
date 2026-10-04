# Phase 0 — Foundation

Spec: `docs/phases/phase-0-foundation.md`

## Status
Spec steps 1–6 done: monorepo, config scaffolding, local stacks, and
environment validation (ported, reviewed fresh, all findings fixed). 147 unit
tests pass; lint, typecheck, format clean.

## Done
- Docs imported; AEC renamed to Helmrun across all docs (2026-10-03)
- Monorepo layout and test placement decided (decision 004, 2026-10-03)
- Target folder structure + phase 0 layout decided (decision 005, 2026-10-03)
- Claude Code workflow: `CLAUDE.md`, Mentor style, `reviewer` + `tester`
  agents, `/problem` `/review` `/wrap` `/drill`, review rubric, hooks
  (2026-10-03)
- `.gitignore` covering all phases; `/wrap` commit safety check (2026-10-03)
- Worked example of the feature workflow: `docs/guides/workflow-walkthrough.md`
  (2026-10-03)
- Phase 0 folders, root + workspace config (decisions 005, 006), local images
  and compose stacks (decisions 007, 008) (2026-10-03 – 2026-10-04)
- Env validation (step 5): `packages/config` pieces + `integerEnv`,
  `apps/api/src/config.ts` combine-then-refine, tests ported from
  LLM-Gateway and split per workspace; fresh review fixed (NODE_ENV required,
  bounded durations, strict digits, zod catalog) (decision 009, 2026-10-04)
- Root scripts use `pnpm -r run …` (pnpm 11's built-in `clean` shadowed the
  script) (2026-10-04)
- Zed project settings: hide `node_modules`, use the project's TypeScript
  (`.zed/settings.json`) (2026-10-04)
- Phase exit sequence added to `CLAUDE.md`: fresh review → failure
  experiments → study pack → `/drill` (2026-10-04)

## Next step
Settle branching (one branch per workstream?), then step 7: port the
database pool into `packages/database` with a typed `DatabaseOptions`
(decision 009), then migrations (step 8).

## Porting plan (LLM-Gateway → Helmrun)
One piece at a time, in spec order; `/review` after each; tests move with
their code. Split pieces (errors, graceful shutdown) get a design check first.
- ~~5 env validation~~ done
- 7–8 pool, migrations → `packages/database`
- 9 Redis lifecycle → `apps/api/src/redis.ts` (new; see open question)
- 10 app/server split → `apps/api/src/app.ts`, `main.ts`
- 11–12 request IDs, logging → `apps/api/src/http/` + `packages/logger`
- 13 errors → `packages/shared` + `apps/api/src/http/error.middleware.ts` (split)
- 14 health/readiness → `apps/api/src/health/`
- 15 graceful shutdown → `packages/shared` helper + each `main.ts` (split)

## Before closing phase 0
- Phase exit sequence (CLAUDE.md): `/review fresh` → failure experiments →
  study pack (concepts, theory questions, interview questions) → `/drill`.
- Remove `passWithNoTests` from `vitest.config.ts` (real tests exist now).
- Write `.github/workflows/ci.yml` (currently empty) running `pnpm validate`
  with the test stack (CI workstream P).
- Add `gitleaks` secret scanning to CI, once the foundation files are imported
  from LLM-Gateway and adapted.
- Extract the proven foundation into a separate starter repo (GitHub template,
  e.g. `ts-monorepo-starter`): root configs, `packages/`, `apps/api` bootstrap
  + http layers, compose files, CI. Swap the `@helmrun` scope, strip
  Helmrun-specific parts. ~2–3h.

## Rules during phase 0
- Foundation packages (`config`, `logger`, `shared`, most of `database`) stay
  generic: no runs/agents/tenants logic, no Helmrun names in env defaults or
  log fields.
- `@helmrun/*` must stay a single find-and-replace away from another scope.

## Open questions
- Branching: one branch per workstream (`p0/database`, …) merged into `main`?
  `/review` and `reviewer` default to `git diff main...HEAD`, which is empty on
  `main`. Settle before step 7; then add the rule to `CLAUDE.md`.
- Error model: who maps errors to HTTP status, given `AppError` lives in
  `shared` (decision 005 → Open).
- Redis client: inside `apps/api` for phase 0, or a package now (decision
  005 → Open).
- Pre-commit hook: husky + lint-staged vs simple-git-hooks, or skip (spec
  says optional; CI is the real gate).
- One script that starts the test stack and runs test migrations together.
- Integration tests (step 7+): `.env.test` defines `TEST_DATABASE_URL`, not
  `DATABASE_URL`, and `process.loadEnvFile` doesn't override variables already
  set in the shell. When tests build an app config, make sure a `DATABASE_URL`
  exported in the shell can't point them at the dev database.

## Interview weak spots
- (filled by /drill)
