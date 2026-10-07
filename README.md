# Helmrun

Helmrun is a distributed platform for running AI agents reliably. A developer
defines an agent and starts a run; Helmrun queues it, schedules it onto a
worker, executes it in an isolated sandbox, recovers it after crashes, and
records everything that happened.

```text
API → scheduler → queue → workers → per-run sandboxes → agent runtime
```

## Status

Helmrun is under active development, built in phases. **Phase 0 (foundation)**
is in its exit review: configuration, PostgreSQL and migrations, Valkey,
structured logging, request IDs, health checks, graceful shutdown, a stable
error format, an OpenAPI contract, scheduler and worker process shells, tests,
and CI. Product features
(tenants, agents, runs) start in phase 1. See
[`docs/progress/`](docs/progress/README.md) for the current state.

## Tech stack

TypeScript on Node.js, Express, Zod, PostgreSQL (raw SQL via `pg`),
Redis-compatible Valkey, Pino, Vitest, pnpm workspaces. Details and reasoning:
[`docs/tech-stack.md`](docs/tech-stack.md).

## Prerequisites

- Node.js `24.21.0` (see `.nvmrc`)
- pnpm `11.27.1`
- Docker with Docker Compose

## Getting started

```sh
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --wait   # PostgreSQL + Valkey for development
pnpm db:migrate
pnpm dev                      # API in watch mode on http://127.0.0.1:8010
```

Check it's up:

```sh
curl http://127.0.0.1:8010/health/live    # process is running
curl http://127.0.0.1:8010/health/ready   # ready for traffic (PostgreSQL reachable)
```

Valkey is optional at runtime: PostgreSQL is the source of truth and Redis only
speeds things up. The API starts and stays ready without it, logs when it's
unavailable or recovers, and requests fall back to PostgreSQL.

The scheduler and worker are shells until phase 3: they start, log, stay
alive, and shut down cleanly.

```sh
pnpm --filter @helmrun/scheduler dev
pnpm --filter @helmrun/worker dev
```

Stop with `Ctrl+C`, then `docker compose down`. Development data persists in
named volumes; `docker compose down --volumes` deletes it.

## Tests

Integration tests run against a separate test stack (its own ports and
databases, empty on every start):

```sh
cp .env.test.example .env.test
pnpm test:stack   # start test PostgreSQL + Valkey, then run test migrations
```

| Command | Runs |
| --- | --- |
| `pnpm test:unit` | Unit and HTTP tests (no services needed) |
| `pnpm test:integration` | Tests against the test PostgreSQL and Valkey |
| `pnpm test` | Both |
| `pnpm validate` | Format check, lint, typecheck, all tests, build (what CI runs) |

## Database migrations

Migrations are plain SQL in `packages/database/migrations/`, applied in order
inside a transaction. The application never runs them on startup.

```sh
pnpm db:migrate:create <name>   # new migration file
pnpm db:migrate                 # apply to the development database
pnpm db:migrate:test            # apply to the test database
```

## Errors

Every error response has the same JSON shape:

```json
{
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "Route not found",
    "requestId": "e9d9d13a-e2f4-4b28-a079-15691186af5a"
  }
}
```

- `code` is stable and meant for client code; codes are added, never renamed.
- `message` is safe to show. Unexpected errors always return 500
  `INTERNAL_ERROR` with a generic message; the details go only to the logs.
- `requestId` matches the `x-request-id` response header. Quote it when
  reporting a problem: it finds the matching log line.
- Validation errors (400 `INVALID_INPUT`) add up to 10 `issues`, each a field
  `path` and a `message`, never the rejected value.

Errors are thrown as `AppError` (`packages/shared`) with a kind such as
`not_found` or `unavailable`; only the API maps kinds to HTTP statuses. Design:
[decision 015](docs/decisions/015-error-model.md).

## API contract

`apps/api/openapi.json` is generated from the API's Zod schemas
(`apps/api/src/http/openapi/document.ts`) and committed. After changing a route
or schema, regenerate it and commit the result; CI fails if it's stale.

```sh
pnpm openapi:generate   # rewrite apps/api/openapi.json
pnpm openapi:check      # what CI runs
```

## Configuration

Each app validates its environment once at startup and refuses to start if
anything is missing or invalid, naming the variable but never its value.
`.env.example` lists every variable with a working local value; each app's
`src/config.ts` is the source of truth for names, defaults, and limits.

| Group | Variables |
| --- | --- |
| Runtime | `NODE_ENV`, `LOG_LEVEL`, `LOG_PRETTY` |
| API server | `PORT`, `HTTP_REQUEST_TIMEOUT_MS`, `HTTP_HEADERS_TIMEOUT_MS`, `HTTP_KEEP_ALIVE_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS` |
| PostgreSQL | `DATABASE_URL`, `DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_READINESS_TIMEOUT_MS` |
| Valkey | `REDIS_URL`, `REDIS_COMMAND_TIMEOUT_MS`, `REDIS_CONNECT_TIMEOUT_MS` |
| Scheduler, worker | `NODE_ENV`, `LOG_LEVEL`, `LOG_PRETTY`, `SHUTDOWN_TIMEOUT_MS` (until phase 3) |

Some values are checked together. For example, `SHUTDOWN_TIMEOUT_MS` must
exceed `DB_STATEMENT_TIMEOUT_MS`, so a request in the middle of a query can
finish during shutdown.

## Repository layout

```text
apps/
  api/          HTTP API (control plane)
  scheduler/    schedules queued runs (later phases)
  worker/       executes runs (later phases)
packages/
  config/       environment parsing helpers
  database/     PostgreSQL pool, health query, migrations
  logger/       structured logging with redaction
  redis/        Redis/Valkey client: fail-fast settings, connection logging, bounded close
  shared/       dependency-free building blocks (errors, clock, lifecycle, shutdown)
docs/           overview, phase specs, decisions, progress, guides, study packs
```

Apps depend on packages, never on each other. `packages/shared` depends on
nothing.

## Documentation

- [Overview and scope](docs/OVERVIEW.md)
- [Phase specs](docs/phases/)
- [Architecture decisions](docs/decisions/README.md)
- [Progress](docs/progress/README.md)
