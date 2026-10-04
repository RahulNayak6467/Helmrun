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
| 006 | [Workspace packages resolve to source in dev, dist in production](006-workspace-package-resolution.md) | 0 | Accepted |
| 007 | [Local service images: Postgres 18 and Valkey](007-local-service-images.md) | 0 | Accepted |
| 008 | [Local stacks: dev persists, test starts empty; Valkey requires auth](008-local-stack-policy.md) | 0 | Accepted |
| 009 | [Env config split: shared pieces, app-owned combine, fail-closed parsing](009-env-config-split.md) | 0 | Accepted |
| 010 | [Database package: typed pool, own logger interface, two query deadlines](010-database-package.md) | 0 | Accepted |
| 011 | [Logging, request IDs, and the API entry point](011-logging-request-ids-entrypoint.md) | 0 | Accepted |
