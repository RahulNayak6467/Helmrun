# Phase 0 study pack

Everything here is grounded in what you built and decided in phase 0. Work
through it in order: read the source for a topic, then answer its questions
in `docs/notes/phase-0.md` **from memory first**, then check against the code
and decisions. `/drill` tests these afterwards.

For each topic: **What you built** (the files), **Read** (targeted sources),
**Theory questions** (understand it), and at the end, interview questions
(explain it out loud).

---

## 1. Monorepo, workspaces, package resolution

**What you built:** pnpm workspace, `apps/*` + `packages/*`, the "apps import
packages, never other apps" rule, packages resolving to `src/` in dev and
`dist/` in production via the `@helmrun/source` export condition (decisions
004, 005, 006).

**Read**
- pnpm docs, "Workspace" and "Catalogs".
- Node.js docs, "Modules: Packages" → "Conditional exports".

**Theory questions**
1. What breaks if `apps/worker` imports a file from `apps/api`? Give a concrete
   example from Helmrun's future (phase 3).
2. Why does dev resolve packages to `src/` but production to `dist/`? What
   would go wrong if production also used `src/`?
3. Why is `zod` a peer dependency of `@helmrun/config` instead of a normal
   dependency? What happens with two copies of Zod (hint: `instanceof ZodError`)?
4. When should code move into a package, and when should it stay duplicated?
   (Use `loadConfigOrExit` as your example.)

---

## 2. Configuration as a boundary

**What you built:** env pieces in `packages/config`, each app combines then
refines (`superRefine`), fail-closed parsing (`integerEnv`, required
`NODE_ENV`), frozen nested config, `loadConfigOrExit` (decision 009).

**Read**
- The Twelve-Factor App, "III. Config".
- Zod docs, "Refinements" (`superRefine`) and "Objects" (`.shape`).

**Theory questions**
1. Why must invalid config stop the process at startup instead of failing on
   the first request that needs it?
2. Why does a rule attached to a piece get lost when you spread `.shape`?
   Why must cross-field rules run after combining?
3. "Fail closed": why is `NODE_ENV` required with no default? What's the
   least strict default it could have fallen back to, and what would that
   silently allow?
4. Why does the startup error print field names and reasons but never the
   rejected values?
5. Why must `SHUTDOWN_TIMEOUT_MS` exceed `DB_STATEMENT_TIMEOUT_MS`? Tell the
   story of what happens if it doesn't.

---

## 3. PostgreSQL pool and migrations

**What you built:** one pool per process, typed options, connection timeout,
server-side `statement_timeout` plus a client query timeout, idle-error
listener, health query; SQL migrations run outside the app (decisions 010,
007, 008).

**Read**
- node-postgres docs, "Pooling" (and the `error` event on idle clients).
- PostgreSQL docs, "Client Connection Defaults" → `statement_timeout`.
- node-pg-migrate (or your migration tool's) docs on how it locks.

**Theory questions**
1. Explain a connection pool with an everyday picture. What do `max`,
   connection timeout, and idle timeout each protect against?
2. What happens to the whole API if a code path leaks a connection (never
   releases it) ten times with `max = 10`?
3. Why two query deadlines (server `statement_timeout` and a client timeout)?
   What does each catch that the other doesn't?
4. Why must the pool have an `error` listener for idle clients? What happens
   without it when Postgres restarts?
5. Why are migrations never run on app startup? What goes wrong with three
   instances starting at once?
6. Why does the test stack start empty while the dev stack persists?

---

## 4. Redis client: degrade, never fail

**What you built:** `packages/redis` with fail-fast command options,
reconnect backoff with jitter (never gives up), transition-only logging,
safe error fields, idempotent bounded close (decision 013).

**Read**
- ioredis README: `retryStrategy`, `enableOfflineQueue`, `maxRetriesPerRequest`.
- AWS Architecture Blog, "Exponential Backoff And Jitter".

**Theory questions**
1. Why is Redis allowed to be down while Postgres being down makes the API
   not ready? (Use the CLAUDE.md data rule.)
2. Why exponential backoff, and why add jitter? Tell the story of 50 API
   instances reconnecting at the same moment without jitter.
3. Why log only state transitions (connected → lost → reconnected) instead of
   every failed attempt?
4. Why disable the offline queue / fail commands fast while disconnected?
   What would happen to request latency otherwise?
5. Why is `close()` idempotent and bounded in time?

---

## 5. Logging and request IDs

**What you built:** Pino with redaction (generic + agent payload paths),
a child logger per request carrying `requestId`, always-generated IDs (the
client's kept separately as `clientRequestId`), request logger with
monotonic duration (decision 011).

**Read**
- Pino docs: "Redaction", "Child loggers".
- OWASP Logging Cheat Sheet, "Data to exclude".

**Theory questions**
1. Why generate the request ID on the server instead of trusting the client's
   `x-request-id`? What could a client do with a trusted one?
2. What does a child logger give you that passing `requestId` into every log
   call doesn't?
3. Why measure duration with a monotonic clock instead of `Date.now()`?
4. Why can't path-based redaction catch a secret inside a string (remember the
   broken-JSON leak in step 13)?
5. Why log under `errorDetails` instead of Pino's `err` key?

---

## 6. Health, readiness, graceful shutdown

**What you built:** `/health/live` (no dependencies) and `/health/ready`
(DB check, draining state, one public 503 shape), a shutdown coordinator
with ordered named steps and a deadline backstop, process handlers for
signals and fatal errors, a keep-alive-aware HTTP closer; the worker and
scheduler shells with an `idle_loop` handle (decision 012).

**Read**
- Kubernetes docs, "Configure Liveness, Readiness and Startup Probes".
- Kubernetes docs, "Pod Lifecycle" → "Termination of Pods".
- Node.js docs, `server.close()` and `server.closeIdleConnections()`.

**Theory questions**
1. Why must liveness not check the database? What happens to a fleet of API
   pods during a 2-minute database outage if it does?
2. Why does readiness return the same 503 body for every reason?
3. Walk through SIGTERM step by step: what happens to readiness, the HTTP
   server, in-flight requests, the pool, Redis, and the exit code.
4. Why is the deadline timer unref'd after the steps finish?
5. Why did keep-alive connections make shutdown hit the deadline, and how
   does the closer fix it?
6. Why would a worker shell with nothing to do exit 0 immediately, and why is
   that dangerous under an orchestrator?
7. Why must `node dist/main` (no `.js`) be treated as the entry point?

---

## 7. Error boundary

**What you built:** `AppError` (kind, code, message, cause, `retryable`) in
`shared`; the API maps kind → status; body-parser errors recognised as a
group; Zod → `INVALID_INPUT` with ≤10 capped issues; unknown → generic 500;
allowlisted, size-capped logging; never-throw fallback; not-found
(decision 015).

**Read**
- Express docs, "Error handling".
- body-parser README, "Errors".
- gRPC docs, "Status codes and their use in gRPC".
- Stripe API reference, "Errors".
- RFC 9110 (or MDN) on 400 vs 401 vs 403 vs 404 vs 409 vs 429 vs 503.

**Theory questions**
1. Why doesn't `AppError` carry an HTTP status? Who needs `retryable`, and
   why does it live in `shared`?
2. Known vs unknown errors: what goes to the client, what goes to the logs,
   and why are they different outputs?
3. Why is `err.message` from a library a leak? Give two examples from this
   phase (pg, JSON parse).
4. Why does an allowlist need size limits, not just field names? (The 200 MB
   Zod log line.)
5. Why must the error middleware never throw, and what happens if it does?
6. Why is "agent belongs to another tenant" a 404 and not a 403?
7. Why do 4xx log at info and 5xx at error?

---

## 8. API contract (OpenAPI)

**What you built:** spec generated from Zod with `zod-openapi`, committed
`openapi.json`, CI stale check, handlers typed with `Response<z.infer<…>>`,
strict contract test (decision 014).

**Read**
- zod-openapi README, "createDocument" and ".meta()".
- OpenAPI 3.1 spec, "Components Object" and "Response Object".

**Theory questions**
1. What is drift between docs and code, and which kind does generating from
   Zod remove? Which kind remains?
2. Why can't a union response type tie a body to its status code, and what
   catches that instead?
3. Why commit the generated file instead of building it at startup?
4. `additionalProperties: false`: why does it make adding a response field a
   breaking change for strict clients? (Open question for phase 1.)

---

## 9. Tooling and CI

**What you built:** CI jobs (format, lint, typecheck, unit; then the test
stack, migrations, integration, build), pinned action SHAs, gitleaks over
full history, pre-commit hook, test DB guard, `openapi:check`.

**Read**
- GitHub Actions docs, "About service containers".
- gitleaks README.

**Theory questions**
1. Why does CI start `docker-compose.test.yml` instead of using GitHub
   Actions `services:`? (You asked this in phase 0: answer it now. Think
   about parity with local runs, health-wait behaviour, and one file to
   maintain.)
2. Why pin actions by commit SHA instead of a tag like `v4`?
3. Why scan the full git history for secrets, not just the latest commit?
4. What does the test DB guard prevent? Tell the story of running the test
   suite against your dev database.

---

## 10. Your failure experiments

Write one line per experiment in your notes (what you saw, what surprised
you). These are your best interview stories:

1. Postgres unavailable: liveness vs readiness, logs, no unhandled rejection.
2. Redis unavailable: still serving? transition logs, no noisy reconnect loop.
3. Invalid environment: exit code, the `config_invalid` line.
4. Port already in use: controlled exit, useful log, no hanging process.
5. SIGTERM: step order, duration, exit code.
6. Malformed HTTP body: before (HTML + stack) vs after (JSON envelope).

---

## Interview questions

Answer each out loud in under two minutes, using Helmrun as the example.

1. Walk me through what happens in your API from the moment a request
   arrives until the response is sent, including when it fails.
2. How do you do graceful shutdown in Node.js behind a load balancer?
3. What's the difference between liveness and readiness probes? Give a bug
   that comes from getting them wrong.
4. How do you validate configuration, and why fail fast?
5. How do you design an API error format? What do you never return?
6. How do you keep secrets and personal data out of logs? What did you get
   wrong first?
7. How do you size and protect a database connection pool?
8. Your Redis goes down. What happens to your service, and why is that the
   right behaviour?
9. How do you keep API documentation in sync with code?
10. How do you trace one request across logs? How would you extend that
    across a queue to a worker (phase 3)?
11. What's exponential backoff with jitter and why does it matter at scale?
12. Monorepo: how do you stop apps from depending on each other?
13. Tell me about a bug your tests caught that code review missed.
    (The broken-JSON leak, or the 200 MB log line.)
14. Why did you choose an allowlist over a blocklist for logged error fields?
