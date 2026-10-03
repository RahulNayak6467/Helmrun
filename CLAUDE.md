# Helmrun

Distributed platform for running AI agents reliably: API → scheduler → SQS →
workers → per-run Docker sandboxes → agent runtime, with durable recovery and
full observability. A learning and resume project: depth and correctness over
feature count.

## Working agreement

- **The user writes the code.** You explain problems, review, discuss
  architecture, and design tests. Don't hand over finished core code.
- **Help ladder when the user is stuck:** nudge (a question) → pattern (the
  approach and why, in words or pseudocode) → snippet (last resort, small).
  Start at nudge unless the user asks for more.
- **Problem before solution.** Explain what breaks and why the naive version
  fails before discussing the production approach.
- **Reviews drip-feed:** 2 important issues at a time, all small fixes at
  once, the rest queued in `docs/REVIEW_QUEUE.md`.
- **Never commit.** Propose commit messages; the user commits.
- The edit guard (decision 003) limits which files you can edit. **Never write
  or modify source files through Bash** (`sed -i`, heredocs, `cp`, scripts).
  If you need a source change, explain it or ask the user to unlock the folder
  in `.claude/unlocked-paths`. Never edit the guard, its settings, or the
  unlock list.

## How we work on a feature

Full worked example: `docs/guides/workflow-walkthrough.md`.

1. **`/problem`**: what the step solves, what breaks, the naive trap, reading,
   design questions.
2. **Design check**: required when the feature touches state, concurrency,
   security, or a boundary between apps. The user shares a few bullets; you
   check failure modes before any code exists. Skip it for simple pieces.
3. **Build**: the user writes the code. Answer what they ask (help ladder).
   Unprompted, flag only blockers in one line: a security hole, data loss,
   or an approach that fights the design. No full reviews mid-build.
4. **`/review`** → fix → `/review next`, until no important issues remain.
   Full reviews happen only through `/review`, so all findings live in one
   queue.
5. **Tests**: the user writes cases in plain English; the `tester` agent
   implements them and proposes extras; the user picks which to add.
6. **`/wrap`**: progress, decisions, commit message.

End of phase: `/review fresh` (independent `reviewer` pass), then `/drill`.

**What you may write:** root/package config scaffolding (`package.json`,
`tsconfig*.json`, `pnpm-workspace.yaml`), docs, tests (via `tester`), and
boilerplate in folders the user unlocks. Everything else, the user writes.

## Docs (read by path when relevant; don't load everything)

| Path | What |
|---|---|
| `docs/OVERVIEW.md` | What Helmrun is, V1 scope, **out-of-scope list**, goals |
| `docs/tech-stack.md` | Stack and why |
| `docs/phases/phase-N-*.md` | Phase specs: workstreams, learn-first, exit criteria |
| `docs/progress/README.md` | Current phase, schedule, checkpoints, deferred items |
| `docs/progress/phase-N.md` | Current phase detail: done, next step, open questions |
| `docs/decisions/` | One file per decision; `README.md` is the index |
| `docs/REVIEW_QUEUE.md` | Open review findings |
| `docs/guides/` | Worked examples (e.g. the feature workflow walkthrough) |

Progress and the decisions index are loaded at session start by a hook.
Recorded decisions are the baseline: don't silently contradict them. If you
think one is wrong, say so and explain why.

## Scope discipline

- Work only on the current phase. Don't pull in later-phase features or
  infrastructure; mention them in one line at most.
- Anything in `docs/OVERVIEW.md` §D (out of scope) stays out unless the user
  explicitly changes V1 scope.
- Don't freeze what the current phase spec says is "not frozen yet" (final
  schema, run-state machine, retry policies, etc.).
- When schedule pressure appears, cut optional features, never correctness,
  security, or reliability work.

## Repo layout

pnpm workspace. Full target and phase 0 layout: decision 005.

- `apps/`: runnable processes (`api`, `scheduler`, `worker`; later `runtime`,
  `dashboard`, `cli`).
- `packages/`: shared code (`config`, `database`, `logger`, `shared`; more
  added only when code is genuinely shared).
- Apps import packages, never other apps. Packages never import apps. No
  cycles. `shared` depends on nothing.
- Each app: `src/main.ts` owns the process lifecycle; the app is built
  separately so tests can construct it without starting the process.
- Migrations: `packages/database/migrations/`.
- Tests live in their workspace: `*.test.ts` next to the code, integration in
  `test/integration/`, helpers in `test/support/`. Cross-app e2e in `tests/e2e/`
  (from phase 3).

## Commands

All from the repo root. Workspace names are `@helmrun/<folder>`.

- `docker compose up -d`: local Postgres + Redis (`.env`)
- `pnpm dev`: run the API in watch mode (workspace packages from source)
- `pnpm db:migrate` / `pnpm db:migrate:create <name>` / `pnpm db:migrate:test`
- `pnpm test`: unit + integration · `pnpm test:unit` · `pnpm test:integration`
  (needs `docker compose -f docker-compose.test.yml --env-file .env.test up -d --wait`
  and `pnpm db:migrate:test`)
- `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm format:check`
- `pnpm validate`: format, lint, typecheck, test, build (what CI runs)
- One workspace: `pnpm --filter @helmrun/<name> <script>`
- Package resolution (source in dev, `dist/` in prod): decision 006.

## Engineering conventions

- **TypeScript:** strict, `noUncheckedIndexedAccess`. `unknown` at untrusted
  boundaries, never `any`. No `as` casts to silence validation; no scattered
  non-null assertions.
- **Validation:** parse external input with Zod at the boundary
  (`schema.parse(req.body)`), never cast it.
- **Config:** validated once at startup, fail fast; no `process.env` in
  business code. Each app owns its env schema.
- **SQL:** raw SQL through `pg` with parameters (`$1`), never string-built.
  Pool from `packages/database`; one pool per process.
- **Data:** PostgreSQL is the durable source of truth. Redis is ephemeral
  acceleration and coordination only; never the only home of critical state.
- **Errors:** centralized mapping to a stable error envelope
  (`{ error: { code, message, requestId } }`). Never leak stacks, SQL, or
  Redis errors to clients.
- **Logging:** Pino, structured, with request ID. No `console.log`. Never log
  passwords, API keys, credentials, auth headers, or secrets.
- **Dependencies:** build clients once in the composition root and inject
  them; no module-level singletons that tests can't replace.
- **Foundation packages stay generic:** no Helmrun domain logic or names in
  `config`, `logger`, `shared`, or the generic parts of `database`.
- **Testing follows risk**, not coverage numbers: normal → concurrency →
  failure tests for the systems that matter.

## Claude Code setup

- Output style `Mentor` (`.claude/output-styles/mentor.md`): how to talk.
- Skills (user-invoked): `/problem`, `/review [next|all|fresh]`, `/wrap`, `/drill`.
- Agents: `reviewer` (read-only fresh review), `tester` (writes tests from the
  user's cases, proposes extra cases, never touches source).
- Review rubric (`.claude/review-rubric.md`): which lenses apply to which
  code, plus per-phase focus and "don't flag" lists. Used by `/review` and
  `reviewer`.
- Hooks: session-start context loader; edit guard (decision 003).
