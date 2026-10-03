# Decisions

One file per decision: `NNN-short-title.md`. This index is loaded every
session; open the full file when a decision matters. Superseded decisions stay
listed and are marked.

Frozen architectural decisions from the phase specs (TypeScript, Express, pnpm
workspaces, `pg` + raw SQL, Redis, Zod, Pino, Vitest, OpenAPI, separate
API/scheduler/worker processes) are listed in
`docs/phases/phase-0-foundation.md` §2 and are not repeated here.

| # | Decision | Phase | Status |
|---|---|---|---|
| 001 | [Name the project Helmrun everywhere](001-helmrun-name.md) | 0 | Accepted |
| 002 | [Progress per phase, one file per decision](002-docs-layout.md) | 0 | Accepted |
| 003 | [Claude edits source only in folders the user unlocks](003-claude-edit-guard.md) | 0 | Accepted |
| 004 | [Monorepo layout and test placement](004-monorepo-layout.md) | 0 | Accepted |
| 005 | [Target folder structure, created per phase](005-target-folder-structure.md) | 0 | Accepted |
