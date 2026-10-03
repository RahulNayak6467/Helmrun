# 002: Progress per phase, one file per decision (2026-10-03)

Phase: 0
Status: Accepted

## Decision
- `docs/progress/README.md` holds the current phase, phase status, schedule,
  and checkpoints. `docs/progress/phase-N.md` holds each phase's detail.
- `docs/decisions/NNN-title.md` holds one decision each, with
  `docs/decisions/README.md` as the index.
- The SessionStart hook loads only the two READMEs plus the current phase's
  progress file.

## Why
Single `PROGRESS.md` / `DECISIONS.md` files grow every session; by phase 6 the
hook would load dozens of decisions into every session. Progress naturally
belongs to a phase. Decisions don't: one made in phase 0 shapes phases 3–6 and
may be superseded later, which is easier to follow with numbered files than
per-phase folders.

## Alternatives considered
- Single files: simplest, but context cost grows without bound.
- Per-phase decision folders: splits a decision's history across phases.
