# Progress

Current phase: 0

## Phase status

| Phase | Status | Target | Budget (h) |
|---|---|---|---|
| 0 — Foundation | In progress | Mid-Oct 2026 | 8 (study pack + drill left) |
| 1 — Control plane | Not started | Early Nov 2026 | 52.5 |
| 2 — Agent runtime | Not started | Dec 2026 | 57.5 |
| 3 — Distributed execution | Not started | Dec 2026 | 62.5 |
| 4 — Durable execution | Not started | Dec 2026 – Jan 2027 | 80 |
| 5 — Isolation & security | Not started | Jan 2027 | 57.5 |
| 6 — Streaming & observability | Not started | Jan 2027 | 52.5 |
| 7 — AWS infrastructure | Not started | Feb 2027 | 67.5 |
| 8 — DX, hardening, finalization | Not started | Mid-Mar 2027 | 62.5 |

Budget = middle of the spec's estimate + 5 h (`docs/guides/workflow.md` §4).
Per session, finish at least session length × (middle ÷ budget) in planned
tasks.

## Schedule

Hard deadline: early April 2027. Plan to finish by mid-March; the rest is buffer.

| Period | Hours/week | Notes |
|---|---|---|
| Oct 3 – Nov 5, 2026 | ~20 | Regular semester |
| Nov 6 – Nov 27, 2026 | ~5 | Exam-week mode (end-sems Nov 20–27) |
| Dec 2026 – mid-Jan 2027 | 35–40 | Winter break — phase 4 must land here |
| Mid-Jan – mid-Mar 2027 | ~20 | Regular semester (4th-sem exam dates TBD) |

## Checkpoints

If a checkpoint is missed by more than a week, cut optional scope immediately.

- **Nov 5, 2026:** phases 0–1 done, phase 2 started.
- **Mid-Jan 2027:** phases 2–5 done, phase 6 started.
- **End of Feb 2027:** phases 6–7 done.
- **Mid-Mar 2027:** phase 8 done. Helmrun finished.

## Deferred items

Things deliberately postponed to a later phase. When a phase starts, `/problem`
and `/wrap` must surface the items listed for it.

| Phase | Item | Source |
|---|---|---|
| 1 | Run phase 1 with the agreed workflow (`docs/guides/workflow.md`, 2026-10-07): learn/ship labels at `/problem`, the 8-step loop with `/spar`, session plans against the 52.5 h budget, "robust but plain" code. `/problem` drafts the phase 1 task list with estimates summing to 47.5 h | Workflow discussion |
| 1 | Transaction helper in `packages/database` (user writes it). Don't introduce it upfront: the user writes transactions inline first; once that passes review, show the helper as the production practice and refactor (user's call, 2026-10-07) | Decision 010 |
| 1 | Decide branching: one branch per workstream merged into `main`; add the rule to `CLAUDE.md` (`/review` defaults to `git diff main...HEAD`) | Phase 0 discussion |
| 1 | Log-level polish (review queue 36): one level for 4xx between `request_failed` and the request logger; no stacks for expected 4xx; DB readiness failures logged on transitions only | Phase 0 exit review |
| 1 | Decision 015 open notes (review queue 29): library messages carrying values (pg `22P02`); only boundary parsing counts as `invalid_input` | Phase 0 step 13 review |
| 1 | Repeat the load baseline (`docs/baselines/phase-0-load.md`) once DB-backed endpoints exist | Phase 0 spec §21 |
| 3 | Add top-level `tests/e2e/` for cross-app tests (API → SQS → worker) | Decision 004 |
| 3 | Decide where run-state transition logic lives (shared by API, scheduler, worker, recovery) | Decision 005 |
| 3 | Worker needs `AGENT_PAYLOAD_REDACT_PATHS` (now in `apps/api/src/dependencies.ts`; apps can't import apps): move it to a Helmrun-specific package | Phase 0 shells |
| 5 | Create `apps/runtime` (sandbox entrypoint, helmrun-runtime image) | Decision 005 |
| 7 | Create `infrastructure/terraform/` | Decision 004 |
| 7 | `pino-pretty` is a devDependency and only `production` forbids `LOG_PRETTY`: keep it off in deployed non-production environments | Decision 011 review |
| 7 | Confirm RDS Postgres and ElastiCache Valkey versions; align local images | Decision 007 |
| 8 | Create `apps/dashboard` and `apps/cli` | Decision 004 |

## Per-phase detail

Each phase has its own file here (`phase-0.md`, `phase-1.md`, …) with what's
done, the next step, and open questions. The phase specs live in `docs/phases/`.
