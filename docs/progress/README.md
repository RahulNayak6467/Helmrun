# Progress

Current phase: 0

## Phase status

| Phase | Status | Target |
|---|---|---|
| 0 — Foundation | In progress | Mid-Oct 2026 |
| 1 — Control plane | Not started | Early Nov 2026 |
| 2 — Agent runtime | Not started | Dec 2026 |
| 3 — Distributed execution | Not started | Dec 2026 |
| 4 — Durable execution | Not started | Dec 2026 – Jan 2027 |
| 5 — Isolation & security | Not started | Jan 2027 |
| 6 — Streaming & observability | Not started | Jan 2027 |
| 7 — AWS infrastructure | Not started | Feb 2027 |
| 8 — DX, hardening, finalization | Not started | Mid-Mar 2027 |

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
| 3 | Add top-level `tests/e2e/` for cross-app tests (API → SQS → worker) | Decision 004 |
| 3 | Decide where run-state transition logic lives (shared by API, scheduler, worker, recovery) | Decision 005 |
| 5 | Create `apps/runtime` (sandbox entrypoint, helmrun-runtime image) | Decision 005 |
| 7 | Create `infrastructure/terraform/` | Decision 004 |
| 7 | Confirm RDS Postgres and ElastiCache Valkey versions; align local images | Decision 007 |
| 8 | Create `apps/dashboard` and `apps/cli` | Decision 004 |

## Per-phase detail

Each phase has its own file here (`phase-0.md`, `phase-1.md`, …) with what's
done, the next step, and open questions. The phase specs live in `docs/phases/`.
