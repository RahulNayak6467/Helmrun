# 011: Logging, request IDs, and the API entry point (2026-10-04)

Phase: 0
Status: Accepted

## Decision

**Logger package (`packages/logger`)**
- `createLogger(options)` takes typed options (level, pretty, service,
  environment, optional `extraRedactPaths`), never an app config object.
- A generic base redaction list (secrets, auth headers, datastore URLs incl.
  Redis/Valkey, whole request/response bodies, plus one-level wildcards for the
  most sensitive names) lives in the package. Apps add domain-specific paths:
  the API passes agent prompt/message/model-output paths.
- Structured mode writes an uppercase `severity` field; pretty mode keeps the
  standard `level` field so pino-pretty can label and colour lines.
- Re-exports the `Logger` type so apps don't depend on `pino` directly.

**Clock (`packages/shared`)**
- `Clock` has `nowMs()` (wall clock, for timestamps) and `monotonicMs()`
  (for durations). Durations never subtract wall-clock readings.

**Request IDs**
- The API always generates the request ID (UUID) and returns it in
  `x-request-id`. It is the only correlation key.
- A client-sent `x-request-id` that passes validation (≤128 chars,
  `[A-Za-z0-9._-]`) is recorded as `clientRequestId` in the request context
  and log bindings. Invalid values are dropped.
- Trusting upstream IDs from our own infrastructure (e.g. the phase 7 load
  balancer) is a later, explicit decision.

**App and entry point**
- `createApp(deps)` builds the Express app without listening; `main.ts` owns
  the process. `dependencies.ts` is the composition root (logger, pool, clock
  built once, injected).
- `main.ts` starts only when run directly, detected by comparing
  `realpath(argv[1])` with `import.meta.filename` (`import.meta.main` is
  undefined under tsx). Since 2026-10-07 this is the shared `isEntryPoint`
  (`packages/shared`), used by the API, worker and scheduler, and it also
  tries `argv[1]` plus the module's extension: Node starts `node dist/main`
  without `.js`, and the old check silently exited 0 there.
- Invalid config: one structured stderr line with field names and reasons
  (never values), exit 1.
- Server startup errors (e.g. `EADDRINUSE`): fatal log, close the pool, and a
  guaranteed exit. After `listening`, errors are runtime errors: logged, the
  process keeps serving, with a permanent listener.
- The request log captures the path from `originalUrl` (no query string) at
  request start, so mounted routers can't rewrite it.

## Why
- Generic packages stay reusable (starter repo) and testable.
- A client-chosen ID can be reused or copied from someone else's ticket, so
  it can't be the key that identifies one request; the phase 0 spec requires
  an explicit policy before accepting upstream IDs.
- Wall-clock time jumps (NTP) distort durations.
- Startup failures must not leave a half-started process; runtime errors
  must not crash a working one.

## Alternatives considered
- AI-specific redaction paths in the logger package: breaks "foundation
  packages stay generic".
- Accepting a valid client `x-request-id` as the request ID (LLM-Gateway's
  behaviour): spoofable correlation key.
- Clock in `apps/api`: the worker needs it for lease timing in phase 4.
- `import.meta.main` guard: never fires under tsx (`pnpm dev`).
