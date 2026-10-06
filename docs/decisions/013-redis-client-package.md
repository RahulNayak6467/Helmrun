# 013: Redis client package: degrade, never fail (2026-10-07)

Phase: 0
Status: Accepted

## Decision

**Location:** `packages/redis` (generic, like `packages/database`): typed
options, its own `RedisLogger` interface, an injectable clock, no Helmrun
names. `ioredis` lives there, not in `apps/api`. Settles decision 005's open
question. The second consumer comes in phase 3 (scheduler, worker).

**Failure policy: degrade, never fail.** PostgreSQL is the source of truth;
Valkey only accelerates.
- The API starts even if Valkey is down.
- Readiness stays PostgreSQL-only. Valkey is shared: failing readiness on it
  would take every instance out at once and turn a cache outage into a full
  outage.
- Requests that use Redis fall back to PostgreSQL. Whether a feature fails
  open or closed without Redis (e.g. rate limiting) is decided per feature
  in phase 1.

**Fail fast, recover by itself:**
- `enableOfflineQueue: false`: a disconnected client rejects commands at once
  instead of queueing them (with the default, a request waited ~10 s).
- `commandTimeout` from `REDIS_COMMAND_TIMEOUT_MS` (default 100 ms);
  `connectTimeout` from `REDIS_CONNECT_TIMEOUT_MS` (default 2 s);
  `maxRetriesPerRequest: 1`.
- Reconnect never gives up: 50 ms doubling, capped at 2 s, equal jitter.
- Slow commands are not retried (retry storm); PostgreSQL is the fallback.

**Logging: transitions only.** A per-client state machine (`connecting`,
`never_connected`, `connected`, `disconnected`, `closing`) logs
`redis_connected`, `redis_unavailable_at_startup`, `redis_connection_lost`
(on `error` or a clean `close`), `redis_connection_restored` with `downForMs`
(monotonic clock), `redis_closed`. A long outage produces two lines, not one
per retry. Error fields come from an allowlist (`type`, `message`, `code`,
`syscall`, `address`, `port`, `command` name) under `errorDetails`, never
`err` (the app logger's Pino serializer rewrites `err`), never `command.args`.

**Shutdown:** the `redis` step runs after `database_pool`. `close()` is
idempotent (every caller gets the same promise), marks the client `closing`
first, disconnects a non-ready client directly, otherwise races `quit()`
against 2 s and falls back to one guarded `disconnect()`; never throws.
`SHUTDOWN_TIMEOUT_MS` minimum raised to 5 s so the quit bound always fits.

**Config (`REDIS_URL`):** `redis://` or `rediss://`, a host, database 0 only
(no path, `/` or `/0`), no query string or fragment: ioredis turns query
parameters into options that override the ones set in code.

## Why
Redis is disposable acceleration (phase 0 invariant). A cache must never be
able to make the API unavailable or slow, and its outages must be visible
without flooding logs. Two fresh reviews found the clean-close, log-serializer,
test-leak and URL-override gaps fixed above.

## Alternatives considered
- Client inside `apps/api` until a second app needs it: same code either way,
  and the second consumer is certain.
- Redis in readiness: one shared outage removes every instance.
- ioredis defaults: offline queue and 20 retries made requests hang ~10 s.
- Logging every `error`/`reconnecting` event: ~600 lines per 20-minute outage.
- Allowing database numbers 0–15: nothing needs another database, and
  ElastiCache cluster mode supports only 0.

## Known gaps
- Closing a never-connected or reconnecting client doesn't log `redis_closed`
  (ioredis emits no `end`); shutdown still logs the step as completed.
- The client connects eagerly; tests must close it (in-process API tests run
  the real shutdown).
