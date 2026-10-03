# 001: Name the project Helmrun everywhere (2026-10-03)

Phase: 0
Status: Accepted

## Decision
The project is Helmrun everywhere: `@helmrun/*` workspace packages, the
`helmrun` CLI, `@helmrun/sdk`, `HELMRUN_*` environment variables,
`helmrun_live_…` API-key prefix, `helmrun-runs` / `helmrun-runs-dlq` queues.

## Why
The docs mixed "AEC" (Agent Execution Cloud) and "Helmrun". Workspace package
names are imported everywhere, so fixing the name in phase 0 avoids a
repo-wide rename later.

## Alternatives considered
- Keep AEC for code, Helmrun for branding: two names for one thing confuses
  docs, logs, and interviews.
