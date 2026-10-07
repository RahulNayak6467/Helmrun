# Phase 0 — Foundation

Spec: `docs/phases/phase-0-foundation.md`

## Status
All implementation steps done: 1–15, 17, 19, 21, CI extras, scheduler/worker
shells. Step 13 (errors) done 2026-10-07, reviewed fresh, all findings fixed.
Phase 0 tests done 2026-10-07 (commit 4be61af, 553 tests; reviewed fresh,
findings fixed incl. the extensionless `node dist/main` silent exit). Exit
sequence: phase-wide `/review fresh` done 2026-10-07 (all exit criteria met;
findings fixed: shared log serializer, nosniff, Dependabot + audit, load
baseline, app-import lint rule, CI smoke of built apps; log-level polish
deferred to phase 1); failure experiments done (user); README updated; study
pack in `docs/study/phase-0.md`. Left: the user works through the study pack,
then `/drill`, then `/wrap` marks phase 0 done.

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
- Step 9, Redis (user wrote `packages/redis` + the env schema; Claude wired
  the API, wrote fixes for its own review findings, tester wrote the tests):
  `packages/redis` client with fail-fast options, never-give-up backoff with
  jitter, transition-only logging state machine, safe error fields under
  `errorDetails`, idempotent bounded close; `REDIS_*` env piece in
  `packages/config` (database 0 only, no query string); API config,
  composition root, `redis` shutdown step after `database_pool`;
  `SHUTDOWN_TIMEOUT_MS` minimum 5 s; `pnpm test:stack`; README and
  `.env.example` updated. Unit + real-Valkey integration tests (dropped
  connection, wrong password, unreachable port). Two fresh reviews, all
  findings fixed (decision 013, 2026-10-07)
- Scheduler + worker shells (Claude wrote them at the user's request):
  `config.ts` (environment + logger + `SHUTDOWN_TIMEOUT_MS`, 10 s default) and
  `main.ts` each (`startWorker` / `startScheduler`); an `idle_loop` interval
  keeps the process alive (else Node exits 0 at once → crash loop) and is the
  only shutdown step; phase 3's poll loop replaces it. Extracted from the API
  into packages: `loadConfigOrExit` (`packages/config/src/load.ts`),
  `isEntryPoint` (`packages/shared/src/lifecycle/entry-point.ts`),
  `applyLoggerRules` (`packages/config/src/logging-rules.ts`; decision 009
  updated). Smoke-tested built shells (alive, SIGTERM → exit 0 at once, bad
  config → exit 1). Fresh review: no important issues, 2 small closed
  (2026-10-07)
- OpenAPI baseline, step 17 (Claude wrote it at the user's request; decision
  014): spec generated from Zod with `zod-openapi`; `health.schemas.ts`
  (named components), handlers typed `Response<z.infer<…>>` so a wrong body
  doesn't compile; pure `buildOpenApiDocument()` in
  `apps/api/src/http/openapi/document.ts` (contract version 0.1.0, shared
  `x-request-id` header, no-store on probes); `apps/api/scripts/generate-openapi.ts`
  writes the committed `apps/api/openapi.json` (Prettier-formatted,
  deterministic); `pnpm openapi:check` in CI fails on a stale or untracked
  file. Fresh review: no important issues, 4 small fixed (2026-10-07)
- Step 13, error boundary (decision 015; user ran the learning loop: notes,
  curl experiment, five questions, kind list, design check; user wrote
  `AppError` and most of the middleware, Claude wrote the rest at the user's
  request): `AppError` in `shared` (kind, code, message, cause, `retryable`
  from `RETRYABLE_BY_KIND`); `error.middleware.ts` (kind → status table,
  body-parser errors as a group, Zod → `INVALID_INPUT` + ≤10 capped issues,
  unknown → generic 500, allowlisted size-capped logging under
  `errorDetails`, 4xx info / 5xx error, `headersSent`, never-throw fallback);
  `not-found.middleware.ts`; wired after routes in `app.ts`; `ErrorResponse`
  schema in OpenAPI (500 on health routes). Tester found two real bugs
  (broken-JSON body text in logs via the SyntaxError cause; throwing getters
  broke the handler); fresh review found unbounded Zod log lines (~200 MB)
  and unrecognised body-parser client errors → 500; all fixed and tested.
  472 unit + 22 integration tests pass (2026-10-07)

## Next step
All build work and the exit review are done (last commit 94b0be8). The user
reads the theory in `docs/study/phase-0.md` (answers in `docs/notes/phase-0.md`,
from memory first), then `/drill`; weak spots go below. Then `/wrap` marks
phase 0 done and phase 1 starts with `/problem` (deferred items for phase 1
are listed in `docs/progress/README.md`).

Also pending from the user:
- Whether `docs/notes/` is committed (left untracked on purpose).
- Write the failure-experiment results (one line each) in the notes; they
  feed the study pack's section 10 and `/drill`.
- Optional extra tests proposed by `tester`: importing worker/scheduler
  `main.ts` doesn't start them; a fatal shutdown request reports exit 1.
- Something the user wants to tell Claude for after phase 1 (not yet said).
- Check the first CI run with the new smoke and audit steps (94b0be8).

User preferences (also in memory): no Claude watermark in proposed commit
messages; keep comments minimal (short "why" only); for code Claude writes,
Claude fixes its own review findings; for the user's code, the user fixes
important findings and Claude may do small ones when asked.

Local setup: `.env` must set `SHUTDOWN_TIMEOUT_MS` above
`DB_STATEMENT_TIMEOUT_MS` (e.g. 20000), or the API refuses to start.

## Order for the rest of phase 0 (changed 2026-10-04)
The user's call: first everything that ports from LLM-Gateway with small
changes, then the pieces that need a decision. `/review` after each piece.

Port first (small changes):
1. ~~CI workflow (step 19)~~ written 2026-10-04 (Claude, ported): job 1
   format, lint, typecheck, unit; job 2 starts `docker-compose.test.yml` with
   `.env.test.example`, test migrations, integration, build. Pinned action
   SHAs and toolchain; `push` only on `main` + `pull_request`; runs on `main`
   never cancel each other; stack logs on failure. `passWithNoTests` removed.
   Fresh review: no important issues, 4 small fixed. First GitHub run green
   (commit 069f982, 2026-10-04).
2. ~~README (step 21)~~ written 2026-10-04 (Claude, from scratch at the
   user's request, not ported): status, quickstart, tests, migrations,
   configuration, repo layout, doc links. Update it as phase 0 pieces land
   (Redis, error envelope, OpenAPI).

Then the pieces that need a decision. Order changed 2026-10-06 (user's call):
everything that doesn't depend on the error model first, step 13 last.
3. ~~Redis lifecycle (step 9)~~ done 2026-10-07 (decision 013; design and
   review details there and in `docs/REVIEW_QUEUE.md`).
4. ~~Scheduler + worker shells~~ written 2026-10-07 (see Done); tests pending.
5. ~~OpenAPI baseline (step 17)~~ written 2026-10-07 (see Done; decision
   014); tests pending. The error-response schema waits for step 13.
6. ~~CI extras~~ done 2026-10-07 (Claude): gitleaks job in CI (full history,
   image pinned by digest; history scanned clean); pre-commit hook
   (simple-git-hooks + lint-staged: Prettier + ESLint on staged files,
   installed by the root `prepare` script); `vitest.config.ts` refuses to run
   tests if `NODE_ENV` isn't `test` or a shell `DATABASE_URL` points at a
   database not ending in `_test`; `pnpm test:stack`.
7. ~~Step 13, errors~~ done 2026-10-07 (see Done; decision 015).

Done from the earlier porting plan: env validation (5), pool + migrations
(7–8, transaction helper deferred to phase 1), app/server split (10), request
IDs + logging (11–12), health/readiness (14), graceful shutdown (15).

## Before closing phase 0
- Phase exit sequence (CLAUDE.md): `/review fresh` → failure experiments →
  study pack (concepts, theory questions, interview questions) → `/drill`.
- After phase 0: discuss why CI starts `docker-compose.test.yml` instead of
  GitHub Actions `services:` (user asked; include in the study pack).
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
- OpenAPI, before phase 1 resources: Zod 4 emits `additionalProperties: false`
  for every response object, so a strict generated client treats any added
  field as an error (adding a field becomes breaking). `z.looseObject` fixes
  the spec but adds an index signature that kills the excess-property check
  on handlers. Decide how responses stay extensible.
- ~~Step 13 error logging, kinds, code location~~ settled 2026-10-07 in
  decision 015 (allowlist everywhere, never `detail`; 9 kinds; codes per
  feature).

## Interview weak spots
- (filled by /drill)
