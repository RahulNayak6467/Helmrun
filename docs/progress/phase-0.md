# Phase 0 — Foundation

Spec: `docs/phases/phase-0-foundation.md`

## Status
Workflow and docs set up; no code yet. Next is creating the phase 0 folders.

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

## Next step
Create the phase 0 folders from decision 005 ("Phase 0 layout"), then run
`/problem` to start the first workstream.

## Before closing phase 0
- Add `gitleaks` secret scanning to CI, once the foundation files are imported from LLM-Gateway and adapted (CI workstream P).
- Extract the proven foundation into a separate starter repo (GitHub template, e.g. `ts-monorepo-starter`): root configs, `packages/`, `apps/api` bootstrap + http layers, compose files, CI. Swap the `@helmrun` scope, strip Helmrun-specific parts. ~2–3h.

## Rules during phase 0
- Foundation packages (`config`, `logger`, `shared`, most of `database`) stay generic: no runs/agents/tenants logic, no Helmrun names in env defaults or log fields.
- `@helmrun/*` must stay a single find-and-replace away from another scope.

## Open questions
- How much of the LLM-Gateway foundation to reuse, and what changes for the
  monorepo (function-level adaptation happens per workstream).
- Error model: who maps errors to HTTP status, given `AppError` lives in
  `shared` (decision 005 → Open).
- Redis client: inside `apps/api` for phase 0, or a package now (decision
  005 → Open).
- Pre-commit hook: husky + lint-staged vs simple-git-hooks, or skip (spec
  says optional; CI is the real gate).

## Interview weak spots
- (filled by /drill)
