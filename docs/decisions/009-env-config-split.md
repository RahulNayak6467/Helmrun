# 009: Env config split: shared pieces, app-owned combine, fail-closed parsing (2026-10-04)

Phase: 0
Status: Accepted

## Decision
- **Shared env schema pieces live in `packages/config`**: `environment`
  (`NODE_ENV`), `logging` (`LOG_*`), `database` (`DB_*`, `DATABASE_URL`).
  A piece moves there only when two or more apps need it.
- **App-only settings stay in the app**: `PORT`, `HTTP_*`, `SHUTDOWN_TIMEOUT_MS`
  live in `apps/api/src/config.ts`.
- **Runtime packages never know env variable names.** `packages/database` and
  `packages/logger` take typed options objects; each app maps its parsed
  config onto them.
- **Each app combines, then refines.** Pieces are spread into one `z.object`
  with `.shape`, and cross-field rules run in a `superRefine` on the combined
  schema. A `.transform` builds the frozen nested config; its type is inferred
  (`z.output`), not hand-written.
- **Parsing fails closed.** `NODE_ENV` is required (no default). Every numeric
  value uses `integerEnv`: plain digits only and an explicit range (durations
  far below Node's 2^31-1 ms timer limit).
- `parseConfig(env)` is pure; `loadConfig()` is the only `process.env` read.
  `toConfigValidationIssues` reports field names and reasons, never values.
- `zod` is declared once (pnpm `catalog:`) and is a peer dependency of
  `@helmrun/config`, since apps build schemas from its pieces.

## Why
- One definition of `DB_*` validation for the API and the worker; no drift.
- Typed options keep runtime packages generic and testable without env vars.
- `.shape` copies fields only: a `superRefine` attached to a piece is silently
  dropped when spread, and some rules need fields from two pieces.
- A missing safety switch must not default to the least strict mode; a typo'd
  number must not become a valid setting.

## Alternatives considered
- Schemas inside `packages/database` / `packages/logger`: couples runtime
  packages to env variable names.
- One combined schema in `packages/config`: forces every app to provide every
  variable (the worker would need `PORT`).
- Rules attached to pieces: silently lost on spread.
- Shared rule helpers in `packages/config`: unnecessary until a second app
  needs the same rules (phase 3); revisit then.

## Update (2026-10-07)
- The worker and scheduler shells need the same logging rules, so
  `applyLoggerRules(env, context)` now lives in `packages/config`. Each app
  still combines first and calls it from its own `superRefine` (rules read two
  pieces, so they can't attach to either).
- `SHUTDOWN_TIMEOUT_MS` stays app-owned: the API's bounds already differ
  (minimum 5 s for Redis), and the worker's will follow its run drain time in
  phase 3.
