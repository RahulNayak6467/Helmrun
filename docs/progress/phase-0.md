# Phase 0 — Foundation

Spec: `docs/phases/phase-0-foundation.md`

## Status
Spec steps 1–8, 10–12 and 14–15 done: monorepo, config, local stacks, env
validation, database pool, migrations, app/server split, request IDs, logging,
health/readiness, graceful shutdown. Each reviewed fresh, all findings fixed.
307 unit + 13 integration tests pass; lint, typecheck, format, build clean.
Left: step 13 (errors, design in progress), Redis (step 9, user), scheduler
and worker shells, OpenAPI, CI, README.

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
- Steps 14–15 (ported by Claude at the user's request, from LLM-Gateway):
  `packages/shared/src/lifecycle/` (lifecycle state, process handlers, generic
  shutdown coordinator with named steps + unref'd deadline backstop),
  `/health/live` + `/health/ready` (shared in-flight DB check, one public 503
  shape), keep-alive-aware HTTP closer (`apps/api/src/http/server-closer.ts`),
  `SHUTDOWN_TIMEOUT_MS` default 20 s and must exceed the statement timeout;
  readiness integration tests on real Postgres; child-process tests for
  SIGTERM and fatal errors (`test/support/fault-injection.ts`). Two fresh
  reviews, all findings fixed (decision 012, 2026-10-04)

## Next step
Step 13, error model: finish the design check. Agreed so far: `shared` stays
transport-neutral (no `statusCode` on `AppError`); the API's error middleware
maps errors to HTTP status. Pending (question 1b): instead of mapping each
error code, every `AppError` declares a kind from a small closed list, and the
API maps kind → status exhaustively. The user writes that list (each kind's
HTTP status and whether it's transient). Then: envelope, unknown-error
logging (pg `detail` leak), body-parser errors, not-found. Copyable from
LLM-Gateway: `not-found.middleware.ts`, the invalid-JSON / payload-too-large
checks.

Local setup after this chunk: `.env` must set `SHUTDOWN_TIMEOUT_MS` above
`DB_STATEMENT_TIMEOUT_MS` (e.g. 20000), or the API refuses to start.

## Porting plan (LLM-Gateway → Helmrun)
One piece at a time, in spec order; `/review` after each; tests move with
their code. Split pieces (errors, graceful shutdown) get a design check first.
- ~~5 env validation~~ done
- ~~7–8 pool, migrations~~ done (transaction helper deferred to phase 1)
- 9 Redis lifecycle → deferred; user writes it after the porting (location open)
- ~~10 app/server split~~ done
- ~~11–12 request IDs, logging~~ done
- 13 errors → `packages/shared` + `apps/api/src/http/error.middleware.ts` (split)
- ~~14 health/readiness~~ done
- ~~15 graceful shutdown~~ done (scheduler/worker wire it when their shells exist)

## Before closing phase 0
- Remaining spec work: Redis lifecycle (step 9, user; add to readiness and
  shutdown as one more step), scheduler + worker shells (`main.ts` +
  `config.ts`, start/log/shut down cleanly with the shared lifecycle helpers),
  OpenAPI baseline (step 17), README (step 21).
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
- Error model: list of error kinds, their HTTP statuses and transient flag
  (see Next step). Direction agreed: API maps, `shared` stays transport-neutral
  (decision 005 → Open, settle in step 13). Also: where domain error codes live,
  since a single closed catalog in `shared` would pull Helmrun codes into a
  generic package.
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
