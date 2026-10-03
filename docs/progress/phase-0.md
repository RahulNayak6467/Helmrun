# Phase 0 — Foundation

Spec: `docs/phases/phase-0-foundation.md`

## Status
Monorepo skeleton, config, and local stacks done (spec steps 1–4 and 6).
`pnpm lint`, `typecheck`, and `format:check` pass. No application code yet.

## Done
- Docs imported; AEC renamed to Helmrun across all docs (2026-10-03)
- Monorepo layout and test placement decided (decision 004, 2026-10-03)
- Target folder structure + phase 0 layout decided (decision 005, 2026-10-03)
- Claude Code workflow: `CLAUDE.md` (working agreement, feature workflow),
  Mentor output style, `reviewer` + `tester` agents, `/problem` `/review`
  `/wrap` `/drill`, review rubric with phase 0 entry, session-context and
  edit-guard hooks (2026-10-03)
- `.gitignore` covering all phases; `/wrap` commit safety check (2026-10-03)
- Worked example of the feature workflow: `docs/guides/workflow-walkthrough.md`
  (2026-10-03)
- Phase 0 folders created per decision 005 (2026-10-03)
- Root + workspace config: pnpm workspace, `tsconfig` base/build per
  workspace, Vitest projects (unit/integration), ESLint with dependency-
  direction rules, Prettier, `.nvmrc`, env examples (2026-10-03)
- Package resolution: source in dev, `dist/` in prod (decision 006), verified
  in a scratch copy (2026-10-03)
- Local images: Postgres 18.6, Valkey 9.1.2 (decision 007, 2026-10-03)
- Dev + test compose stacks written, reviewed, and running healthy; test stack
  starts empty, Valkey auth on (decision 008, 2026-10-04)

## Next step
Explain the monorepo setup back (workspaces, `exports` conditions, build vs
typecheck configs), then `/problem` on spec step 5: environment validation,
porting LLM-Gateway `src/config/` into `packages/config` + each app's
`src/config.ts`.

## Porting plan (LLM-Gateway → Helmrun)
One piece at a time, in spec order; `/review` after each; tests move with
their code. Split pieces (config, errors, graceful shutdown) get a design
check first.
- 5 env validation → `packages/config` + each app's `src/config.ts` (split)
- 7–8 pool, migrations → `packages/database`
- 9 Redis lifecycle → `apps/api/src/redis.ts` (new; see open question)
- 10 app/server split → `apps/api/src/app.ts`, `main.ts`
- 11–12 request IDs, logging → `apps/api/src/http/` + `packages/logger`
- 13 errors → `packages/shared` + `apps/api/src/http/error.middleware.ts` (split)
- 14 health/readiness → `apps/api/src/health/`
- 15 graceful shutdown → `packages/shared` helper + each `main.ts` (split)

## Before closing phase 0
- Remove `passWithNoTests` from `vitest.config.ts` once real tests exist.
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
- Error model: who maps errors to HTTP status, given `AppError` lives in
  `shared` (decision 005 → Open).
- Redis client: inside `apps/api` for phase 0, or a package now (decision
  005 → Open).
- Pre-commit hook: husky + lint-staged vs simple-git-hooks, or skip (spec
  says optional; CI is the real gate).
- One script that starts the test stack and runs test migrations together.

## Interview weak spots
- (filled by /drill)
