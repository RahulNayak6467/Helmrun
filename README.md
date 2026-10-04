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
is in progress: configuration, PostgreSQL and migrations, structured logging,
request IDs, health checks, graceful shutdown, tests, and CI. Product features
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

Stop with `Ctrl+C`, then `docker compose down`. Development data persists in
named volumes; `docker compose down --volumes` deletes it.

## Tests

Integration tests run against a separate test stack (its own ports and
database, empty on every start):

```sh
cp .env.test.example .env.test
docker compose -f docker-compose.test.yml --env-file .env.test up -d --wait
pnpm db:migrate:test
```

| Command | Runs |
| --- | --- |
| `pnpm test:unit` | Unit and HTTP tests (no services needed) |
| `pnpm test:integration` | Tests against the test PostgreSQL |
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
| Valkey | `REDIS_URL` (read once the Redis client is added) |

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
  shared/       dependency-free building blocks (clock, lifecycle, shutdown)
docs/           overview, phase specs, decisions, progress
```

Apps depend on packages, never on each other. `packages/shared` depends on
nothing.

## Documentation

- [Overview and scope](docs/OVERVIEW.md)
- [Phase specs](docs/phases/)
- [Architecture decisions](docs/decisions/README.md)
- [Progress](docs/progress/README.md)
