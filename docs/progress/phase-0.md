# Phase 0 — Foundation

Spec: `docs/phases/phase-0-foundation.md`

## Status
Spec steps 1–8 and 10–12 done (chunks 1 and 3): monorepo, config, local
stacks, env validation, database pool, migrations, app/server split, request
IDs, logging. Each reviewed fresh, all findings fixed. 241 unit + 9
integration tests pass; lint, typecheck, format clean. Redis (step 9)
deferred to the user.

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
- Chunk 1 (steps 7–8): `packages/database` pool with typed options, own
  logger interface, server + client query deadlines, idle-error listener,
  health query; UTC bootstrap migration; ported unit tests; integration tests
  for migrations (rerun no-op, failed-migration rollback, concurrent runners,
  real migrations on a throwaway DB) and the pool (application name,
  statement timeout, idle connection killed); fresh review fixed
  (decision 010, 2026-10-04)
- Chunk 3 (steps 10–12): `packages/logger` (typed options, generic redaction
  + app extras, wildcards), `Clock` with `monotonicMs` in `packages/shared`,
  API `app.ts` / `dependencies.ts` / `main.ts`, request ID middleware (always
  generated, client ID kept as `clientRequestId`), request logger (original
  path, monotonic duration); invalid-config exit, startup vs runtime server
  errors, realpath entry check (tsx-safe); fresh review fixed (decision 011,
  2026-10-04)

## Next step
Chunk 4, step 13: error model. Design decision first: `AppError` base lives in
`packages/shared` (generic), so who maps errors to HTTP status and the
`{ error: { code, message, requestId } }` envelope? Then error + not-found
middleware. Redis (step 9) stays deferred until the porting is done; the user
writes it then (location decision still open) and adds it to readiness and
shutdown.

## Porting plan (LLM-Gateway → Helmrun)
One piece at a time, in spec order; `/review` after each; tests move with
their code. Split pieces (errors, graceful shutdown) get a design check first.
- ~~5 env validation~~ done
- ~~7–8 pool, migrations~~ done (transaction helper deferred to phase 1)
- 9 Redis lifecycle → deferred; user writes it after the porting (location open)
- ~~10 app/server split~~ done
- ~~11–12 request IDs, logging~~ done
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
- Repo initialization happens on `main` (branching deferred to phase 1). Run
  `/review` before committing each chunk: on `main` it only sees uncommitted
  changes.
- Foundation packages (`config`, `logger`, `shared`, most of `database`) stay
  generic: no runs/agents/tenants logic, no Helmrun names in env defaults or
  log fields.
- `@helmrun/*` must stay a single find-and-replace away from another scope.

## Open questions
- Step 13 (errors): `pino.stdSerializers.err` copies pg error fields like
  `detail` (`Key (email)=(...)`) into logs; redaction doesn't cover `err.*`.
  Decide how error logging strips them.
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
