# Review rubric

Shared by `/review` and the `reviewer` agent, so every review picks its checks
the same way. Two filters: what the code does picks the lenses; the current
phase sets the depth and what's premature.

## 1. Lenses by what the code does

Apply a lens only when the code under review matches its trigger.

| If the code… | Apply |
|---|---|
| takes external input (HTTP body/params/headers, queue messages, env, tool args, model output) | **Security**, **validation** |
| writes to the database | **Data integrity**: transactions, constraints, partial writes |
| reads, decides, then writes (check-then-act), or can receive the same request/message twice | **Concurrency**: races, duplicates, lost updates, idempotency |
| keeps state in process memory (maps, counters, caches, timers) | **Scalability**: does it break with 2+ instances? |
| runs long or in the background (loops, workers, schedulers) | **Crash**: process dies between two steps, what state is left? |
| calls something external (Postgres, Redis, SQS, LLM providers, Docker, HTTP) | **Failure**: errors, timeouts, retries, degraded mode |
| owns a lifecycle (connect/start/stop, signals) | **Lifecycle**: startup order, graceful shutdown, cleanup, timeouts |
| is on a hot path, loops over queries, or returns lists | **Performance**: N+1, indexes, unbounded results |
| crosses a package/app boundary or adds a module | **Design**: layering, dependency direction, coupling, decisions |
| is infrastructure config (compose files, env examples, CI workflows) | **Environment**: exposure, secrets, readiness, persistence, isolation |
| always | **Correctness**, **maintainability** (naming, size, clarity), **observability** (light: could you debug this failure from logs?), **tests** for risky behaviour |

What each lens asks:

- **Security**: injection, authz/ownership (once tenancy exists), sensitive
  data in responses or logs, unsafe defaults.
- **Data integrity**: multi-step writes atomic? Constraint violations mapped,
  not leaked? Can a failure leave half-written state?
- **Concurrency**: two at once, does it double-create, lose an update, or
  pass a check both should fail?
- **Scalability**: in-memory state that's wrong per instance; work that
  grows with total data instead of the request.
- **Crash**: no `catch` runs on a crash. What's left in Postgres, Redis, the
  queue, a container? Does restart recover it?
- **Failure**: every external call has a timeout and a deliberate failure
  path; Redis failures degrade gracefully, never take down a request.
- **Lifecycle**: resources opened once, closed in reverse order, with a
  shutdown deadline.
- **Observability**: failures logged once, structured, with request ID and
  context; nothing sensitive logged.
- **Maintainability**: mostly small fixes; important only when it will cause
  bugs (e.g. a 300-line function mixing layers).
- **Environment**: services bound to `127.0.0.1`, not all interfaces;
  credentials from env files, never hardcoded or committed; health checks so
  dependents and `--wait` start only when services are ready; named volumes
  where data should persist; test setup fully separate from dev (ports,
  databases, volumes); pinned image versions.

## 2. Phase focus

Filled in at the start of each phase from its spec (`/problem` drafts it, the
user confirms). **Focus** = go deep. **Don't flag** = premature for this
phase; at most a one-line "later" note, never a finding.

### Phase 0: Foundation

Focus:
- Config: validated once at startup, fails fast with a clear error, no
  `process.env` outside config, per-app schemas, test config isolated.
- Error boundary: stable envelope, unknown errors → safe 500, no stacks/SQL/
  Redis internals leaked.
- Lifecycle: graceful shutdown order (stop accepting → close server → pool →
  Redis → flush), shutdown timeout, no partially-started process.
- Liveness vs readiness: liveness cheap; readiness checks Postgres; Redis
  degradation handled deliberately.
- Database: one pool per process, parameterized SQL, repeatable migrations.
- Logging: structured, request ID on request logs, redaction of secrets/auth
  headers, errors serialized properly.
- Boundaries: apps → packages only, `shared` has no deps, foundation packages
  generic (no Helmrun domain logic or names).
- Tests: test DB isolated from dev, infra tests listed in the spec exist.
- Local environment: compose services localhost-only with health checks,
  env-driven credentials matching `.env.example` / `.env.test.example`, dev
  and test stacks fully separate, `pnpm validate` passes from a clean clone.

Don't flag:
- Auth, API keys, tenancy, RBAC, rate limiting, quotas → phase 1
- Final schema, run-state machine, pool sizing, retry policies → not frozen
- Queues, retries, DLQ, worker concurrency/shutdown complexity → phase 3
- Leases, heartbeats, checkpoints → phase 4
- Dockerfiles, sandboxing → phase 5
- Metrics, tracing, OpenTelemetry, SSE → phase 6 (logging + request IDs are
  in scope now)
- AWS, Terraform, deploy pipelines → phase 7
- Cache abstraction → only when a real caching need appears

## 3. Transparency

Every review starts with one line naming the lenses applied and the ones
skipped, with the reason. Example:

> Checked: failure, lifecycle, validation, observability. Skipped:
> concurrency (no shared writes), scalability (no in-memory state).
