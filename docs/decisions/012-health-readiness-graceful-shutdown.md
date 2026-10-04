# 012: Health, readiness, and graceful shutdown (2026-10-04)

Phase: 0
Status: Accepted

## Decision

**Shutdown helpers live in `packages/shared/src/lifecycle/`** (generic, reused
by scheduler and worker later)
- `createLifecycleState()`: running → draining, once. Readiness reads it;
  shutdown flips it synchronously before anything closes.
- `installProcessHandlers()`: SIGINT/SIGTERM → shutdown request (exit 0);
  the first `uncaughtException` / `unhandledRejection` → exit code 1, one
  fatal log, shutdown request. Later fatal events are logged
  (`process_fatal_error_during_shutdown`), never acted on. Non-Error rejection
  values are replaced, never logged. Nothing ever throws out of a listener.
- `createShutdownCoordinator()`: takes an ordered list of named steps
  (`{ name, close }`). Runs once however often it's requested; every step runs
  even if one fails; any failure → exit 1; a fatal request mid-shutdown
  upgrades the exit code. A deadline force-exits with 1 if a step hangs, and
  stays as an unref'd backstop afterwards, so a handle no step closes can't
  keep the process alive.
- `shared` depends on nothing: its own `LifecycleLogger` interface (same
  pattern as `DatabaseLogger`, decision 010).

**API wiring (`apps/api`)**
- Shutdown order: `http_server`, then `database_pool`.
- `http/server-closer.ts`: `server.close()` alone keeps serving requests on
  open keep-alive connections and waits a full `keepAliveTimeout`, so a busy
  client could push shutdown to the deadline. Once closing, every response
  not yet sent gets `Connection: close`, and each connection closes as soon as
  its response is done. Its `request` listener is prepended so it runs before
  the Express app's.
- Process-wide handlers are installed only in `main.ts`'s entry-point branch;
  `startServer(processTarget = process)` lets tests start a server without
  touching the test runner's process.
- `SHUTDOWN_TIMEOUT_MS` defaults to 20 s and must exceed
  `DB_STATEMENT_TIMEOUT_MS` (config rule), so a request mid-query can finish
  before the deadline.

**Health (`apps/api/src/health/`)**
- `/health/live`: 200 `{ status: 'ok' }`, touches no dependency.
- `/health/ready`: not draining and `SELECT 1` within
  `DB_READINESS_TIMEOUT_MS`. One public 503 shape (`{ status: 'not_ready' }`);
  the reason is logged, not returned. Overlapping probes share one in-flight
  database check. Never rejects. Both send `Cache-Control: no-store`.
- `createApp` takes an injected `checkReadiness` (readiness depends on process
  state, which `main.ts` owns).

## Why
Ported from LLM-Gateway, where the design was proven, then generalised so the
scheduler and worker can reuse the shutdown pieces. Two fresh reviews found
the keep-alive, fatal-path, and config gaps fixed above.

## Alternatives considered
- Coordinator hardcoding server + pool (LLM-Gateway): simpler, but every
  process would need its own copy.
- Coordinator in `apps/api` until a second process needs it: contradicts the
  recorded porting plan; generalising cost little.
- `server.closeAllConnections()` at the deadline: dropped, `process.exit(1)`
  follows immediately and tears sockets down anyway.
- Only raising the shutdown default: an env override could still recreate the
  forced exit; the rule makes that config fail at startup.

## Known gaps
- No delay between readiness turning 503 and closing HTTP (load-balancer drain
  delay): phase 7.
- A request running several slow queries can still outlast the deadline; that
  needs per-request deadlines (later phase).
