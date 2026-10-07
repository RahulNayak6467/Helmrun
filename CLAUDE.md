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

**The workflow is `docs/guides/workflow.md`** (from phase 1): learn/ship
labels, the 8-step feature loop, session plans and time budgets, code level
("robust but plain"), retention, and guardrails. Follow it. In short:

1. **`/problem`**: problem first; label each step learn or ship.
2. **Break** it in miniature, predicting first.
3. **Design check**: the user's bullets → the three-level table
   (child / target / enterprise) and a build checklist. No target code.
4. **Build**: the user writes learn-mode code (help ladder via `stuck:`).
   Unprompted, flag only blockers in one line. No full reviews mid-build.
5. **`/spar`**: edge cases one at a time; the user fixes them.
6. **`/review`** → fix → `/review next`. All findings live in one queue.
7. **Tests**: the user writes cases; `tester` implements them.
8. **Own**: re-break, compare with the target, drill, interview story;
   then `/wrap`.

Sessions start with a plan sized to the session length and the phase budget;
`/wrap` records actual time.

End of phase, in order:
1. `/review fresh` (independent `reviewer` pass) until no important issues remain.
2. The user runs the phase spec's failure experiments.
3. You prepare the phase study pack: concepts to read (with sources), theory
   questions, and likely interview questions, all grounded in what was built
   and decided in that phase. The user works through it.
4. `/drill` to check the study pack landed; weak spots go to the phase file.
5. Only then move to the next phase.

**What you may write:** root/package config scaffolding (`package.json`,
`tsconfig*.json`, `pnpm-workspace.yaml`), docs, tests (via `tester`), and
ship-mode code in folders the user unlocks. Learn-mode code is the user's:
decline once and offer a nudge; if the user overrides explicitly, log it in
the phase file as "handed over: X, revisit".

**Git:** one branch per feature from phase 1, merged into `main`; `/review`
defaults to `git diff main...HEAD`. No comments in code. Commit messages
carry no Claude attribution.

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
| `docs/guides/workflow.md` | **The workflow**: modes, feature loop, sessions, budgets, code level |
| `docs/guides/` | Worked examples (e.g. the feature workflow walkthrough) |
| `docs/study/phase-N.md` | Phase study packs |
| `docs/notes/` | The user's own notes and pattern cards (theirs; read, don't edit) |

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
- Skills (user-invoked): `/problem`, `/spar <files>`, `/review [next|all|fresh]`, `/wrap`, `/drill`.
- Agents: `reviewer` (read-only fresh review), `tester` (writes tests from the
  user's cases, proposes extra cases, never touches source).
- Review rubric (`.claude/review-rubric.md`): which lenses apply to which
  code, plus per-phase focus and "don't flag" lists. Used by `/review` and
  `reviewer`.
- Hooks: session-start context loader; edit guard (decision 003).
