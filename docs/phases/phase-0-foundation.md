# Helmrun Phase 0 --- Foundation & Engineering Baseline

> **Estimated duration:** \~1 week\
> **Target effort:** \~18--22 hours\
> **Primary outcome:** A production-oriented local foundation on which
> every later Helmrun phase can be built safely and consistently.

------------------------------------------------------------------------

## 1. Phase Goal

Phase 0 is **not** about implementing Helmrun product features.

The goal is to establish the engineering foundation, repository
boundaries, development infrastructure, configuration model, database
migration workflow, logging, error handling, testing baseline, and local
developer experience before feature development begins.

At the end of this phase, the following should work:

``` text
Clone repository
      ↓
Install dependencies
      ↓
Start local infrastructure
      ↓
Run database migrations
      ↓
Start API
      ↓
GET /health
      ↓
Healthy response
      ↓
Run tests
      ↓
Build/typecheck/lint successfully
```

Phase 0 should make later work **faster and safer**, not create an
elaborate framework that becomes a project by itself.

------------------------------------------------------------------------

# 2. Architectural Context

Helmrun v1 uses:

``` text
Modular Control Plane
        │
        ├── PostgreSQL
        ├── Redis
        └── S3 / SQS later

Separate Scheduler
        │
        ▼
       SQS
        │
        ▼
Distributed Workers
        │
        ▼
Docker Sandboxes
        │
        ▼
Agent Runtime
```

Phase 0 establishes only the pieces required to support this
architecture later.

### Frozen architectural decisions relevant to Phase 0

-   TypeScript + Node.js.
-   Express.js for the control-plane HTTP API.
-   pnpm Workspaces monorepo.
-   PostgreSQL using `pg` and raw SQL.
-   Redis.
-   Zod for runtime validation.
-   Pino for structured logging.
-   Vitest for testing.
-   OpenAPI will document the public REST API.
-   API, scheduler, and worker remain separate applications/processes.
-   Shared code belongs in focused packages rather than arbitrary
    cross-imports between applications.

### Not frozen yet

Phase 0 must **not prematurely freeze**:

-   final database schema
-   final run-state machine
-   scheduler algorithm
-   worker claiming implementation
-   checkpoint format
-   Redis key design for later features
-   exact AWS topology
-   exact retry policies
-   exact observability dashboards

Those are designed in the phases where their requirements become
concrete.

------------------------------------------------------------------------

# 3. Phase Deliverables

By the end of Phase 0, the repository should contain approximately:

``` text
helmrun/
├── apps/
│   ├── api/
│   ├── scheduler/
│   ├── worker/
│   ├── dashboard/
│   └── cli/
│
├── packages/
│   ├── database/
│   ├── config/
│   ├── logger/
│   └── shared/
│
├── infrastructure/
│   └── terraform/
│
├── docker/
├── tests/
├── docs/
├── docker-compose.yml
├── pnpm-workspace.yaml
├── tsconfig.json
└── package.json
```

Not every directory needs substantial implementation yet.

Empty application shells are acceptable where functionality belongs to
later phases.

------------------------------------------------------------------------

# 4. Workstream A --- Monorepo Foundation

## Goal

Create a repository that can support multiple independently runnable Helmrun
applications without turning the codebase into a collection of tightly
coupled folders.

## Learn first

Spend roughly **45--60 minutes** understanding:

-   monorepo vs monolith
-   workspace dependency management
-   package boundaries
-   application vs library/package
-   TypeScript project configuration
-   dependency direction

Do not spend time studying Nx/Turborepo internals for v1.

## Implementation

Use **pnpm Workspaces**.

Initial workspace:

``` text
apps/
packages/
```

Applications:

``` text
apps/api
apps/scheduler
apps/worker
apps/dashboard
apps/cli
```

Initially, only `api` needs meaningful runtime functionality.

Packages should be created **only when there is genuinely shared
infrastructure**.

Reasonable Phase 0 packages:

``` text
packages/config
packages/database
packages/logger
packages/shared
```

Avoid immediately creating:

``` text
packages/auth
packages/agents
packages/runs
packages/cache
packages/events
```

Those boundaries should emerge when their corresponding features are
implemented.

## Dependency rule

Prefer:

``` text
apps/api ───────► packages/database
         ├──────► packages/config
         └──────► packages/logger
```

Avoid:

``` text
apps/api ───────► apps/worker
apps/worker ────► apps/api
```

Applications should not import implementation details from one another.

## Exit check

``` bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

must run from the repository root.

------------------------------------------------------------------------

# 5. Workstream B --- TypeScript Engineering Baseline

## Goal

Establish strict TypeScript behavior early so later distributed-system
code does not accumulate unsafe assumptions.

## Configuration expectations

Use strict TypeScript settings.

Important options should include the equivalent of:

``` json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Exact configuration can be adjusted when libraries require it.

## Coding rules

Prefer:

-   explicit domain types
-   `unknown` instead of `any` at untrusted boundaries
-   runtime validation for external data
-   narrow interfaces
-   dependency injection where it improves testing
-   functions for stateless behavior
-   classes when state/lifecycle/dependency ownership makes them useful

Avoid:

-   pervasive `any`
-   `as SomeType` to silence validation problems
-   non-null assertions everywhere
-   giant utility modules
-   speculative generic abstractions

## Example boundary

Bad:

``` ts
const body = req.body as CreateAgentInput;
```

Preferred later:

``` ts
const input = createAgentSchema.parse(req.body);
```

Phase 0 only needs the validation infrastructure and conventions; agent
schemas belong to Phase 1.

------------------------------------------------------------------------

# 6. Workstream C --- Configuration & Environment Validation

## Goal

Helmrun should fail immediately at startup when configuration is invalid.

Do not scatter this throughout the project:

``` ts
process.env.DATABASE_URL!
process.env.REDIS_URL!
```

## Architecture

``` text
Environment
    ↓
Zod schema
    ↓
Validated Config
    ↓
Application
```

## Example

``` ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
});

export const env = envSchema.parse(process.env);
```

Exact fields will evolve.

## Requirements

-   `.env.example` exists.
-   Secrets are never committed.
-   Startup fails clearly for missing required variables.
-   Test configuration is isolated from development configuration.
-   Configuration is parsed once rather than repeatedly throughout
    business code.

## Failure experiment

Remove `DATABASE_URL` and start the API.

Expected behavior:

``` text
startup
  ↓
configuration validation fails
  ↓
clear error
  ↓
process exits
```

The application should not start in a partially configured state.

------------------------------------------------------------------------

# 7. Workstream D --- Local PostgreSQL Foundation

## Goal

Establish a correct local database workflow without designing the entire
Helmrun schema prematurely.

## Theory before implementation

Spend roughly **2--2.5 hours** on:

-   PostgreSQL process/database/schema/table distinction
-   primary keys
-   foreign keys
-   constraints
-   transactions at a basic level
-   indexes at a basic level
-   connection lifecycle
-   connection pooling concept
-   parameterized SQL
-   migrations

Deep MVCC, isolation, locking and concurrency belong primarily to later
phases.

## Local environment

Run PostgreSQL using Docker Compose.

``` text
Docker Compose
     │
     ▼
PostgreSQL
     │
     ▼
packages/database
     │
     ▼
pg Pool
```

## Database package responsibilities

`packages/database` should eventually own infrastructure such as:

``` text
connection pool
migration runner
transaction helper
shared DB types where appropriate
```

It should **not** become one enormous repository containing every domain
query.

## Connection pooling

Use `pg.Pool` rather than opening a new connection for every request.

Conceptually:

``` ts
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});
```

Production pool sizing is **not frozen in Phase 0**.

## Parameterized SQL

Never construct user-controlled SQL like:

``` ts
`SELECT * FROM users WHERE id = '${id}'`
```

Use parameters:

``` ts
await pool.query(
  "SELECT id FROM users WHERE id = $1",
  [id],
);
```

## Migration workflow

Helmrun must have a repeatable migration process.

Expected workflow:

``` text
new schema change
      ↓
new migration file
      ↓
run migration
      ↓
record migration version
```

Phase 0 can use a tiny bootstrap table or infrastructure migration
rather than designing agents/runs now.

## Failure experiments

### Database unavailable

Stop PostgreSQL and start the API.

Decide explicitly whether the API should:

-   refuse startup because PostgreSQL is a required dependency, or
-   start but report itself unready.

For Helmrun v1, prefer **not-ready / startup failure for critical DB
initialization**, depending on the final lifecycle implementation.

The exact mechanism is conceptual in Phase 0.

### Invalid credentials

Expected:

``` text
DB connection failure
      ↓
structured error
      ↓
service does not claim readiness
```

------------------------------------------------------------------------

# 8. Workstream E --- Local Redis Foundation

## Goal

Provide a local Redis dependency and client lifecycle without
prematurely implementing caching or coordination features.

Redis later supports:

-   caching
-   rate limiting
-   concurrency counters
-   ephemeral coordination
-   heartbeat information
-   Redis Pub/Sub for live execution events

## Theory

Spend roughly **1--1.5 hours** on:

-   Redis in-memory model
-   keys and TTLs
-   expiration
-   atomic commands
-   Pub/Sub basics
-   persistence vs ephemeral usage
-   why Redis is not Helmrun's durable source of truth

## Phase 0 implementation

-   Redis container in Docker Compose.
-   Redis client initialization.
-   Connection lifecycle.
-   Basic health check.
-   Error logging.

Do **not** implement the final cache abstraction yet unless Phase 1
creates a real caching requirement.

## Important invariant

``` text
PostgreSQL = durable truth
Redis      = disposable acceleration / ephemeral coordination
```

Helmrun must never depend on Redis as the only location of critical run
state.

------------------------------------------------------------------------

# 9. Workstream F --- Express Application Structure

## Goal

Build the minimum production-oriented HTTP skeleton that future
control-plane modules can use.

Suggested structure:

``` text
apps/api/src/
├── app.ts
├── server.ts
├── middleware/
├── errors/
├── health/
└── modules/
```

`app.ts` should construct/configure Express.

`server.ts` should own process startup and shutdown lifecycle.

This separation makes integration testing easier.

## Request pipeline

Conceptually:

``` text
Request
   ↓
Request ID / context
   ↓
HTTP logging
   ↓
Security/basic middleware
   ↓
Route
   ↓
Controller
   ↓
Service
   ↓
Repository / infrastructure
   ↓
Error boundary
   ↓
Response
```

Not every layer needs implementation in Phase 0.

------------------------------------------------------------------------

# 10. Workstream G --- Error Model

## Goal

Establish consistent error boundaries before domain complexity appears.

Do not use random response construction everywhere:

``` ts
res.status(500).json({ error: "something went wrong" });
```

Create a small application error model.

Conceptually:

``` ts
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
}
```

Later domain errors can become:

``` text
AgentNotFoundError
QuotaExceededError
RunConflictError
ProviderTimeoutError
```

Phase 0 only needs enough structure to demonstrate centralized mapping.

## Error response shape

A stable public error envelope could eventually resemble:

``` json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource was not found",
    "requestId": "req_..."
  }
}
```

Exact error codes are not frozen yet.

## Security rule

Never return raw stack traces or internal SQL/Redis errors to clients in
production.

------------------------------------------------------------------------

# 11. Workstream H --- Structured Logging

## Goal

Use structured logging from the beginning.

Use **Pino**.

Bad:

``` ts
console.log("database connected");
```

Preferred:

``` ts
logger.info(
  { component: "database" },
  "database connection established",
);
```

## Baseline log context

Where available, logs should eventually support:

``` text
requestId
traceId
tenantId
agentId
runId
workerId
```

Phase 0 should at least establish:

-   application/service name
-   environment
-   request ID
-   HTTP method/path/status
-   error object serialization

## Logging rules

Do not log:

-   passwords
-   API keys
-   provider credentials
-   authorization headers
-   secret environment variables

Do not log every trivial internal operation merely because structured
logging exists.

------------------------------------------------------------------------

# 12. Workstream I --- Request IDs

## Goal

Every HTTP request should have a correlation identifier.

``` text
Client
  ↓
API
  ↓
requestId = req_123
  ↓
all request logs include req_123
```

If a valid upstream request ID is accepted later, define that policy
explicitly.

For Phase 0, generating one at the API boundary is sufficient.

This becomes important later when a request causes:

``` text
API → Scheduler → SQS → Worker → Runtime
```

Full distributed trace propagation belongs to the observability phase.

------------------------------------------------------------------------

# 13. Workstream J --- Health and Readiness

## Goal

Expose health information without conflating "process exists" with
"service can serve traffic."

Recommended conceptual split:

``` text
GET /health/live
GET /health/ready
```

### Liveness

Answers:

> Is the process alive?

It should generally not perform expensive dependency checks.

### Readiness

Answers:

> Can this service currently perform its required role?

For the API, readiness may check critical dependencies such as
PostgreSQL.

Redis may be treated differently because many Redis-backed features
should degrade gracefully later.

Exact readiness semantics can evolve as features are introduced.

------------------------------------------------------------------------

# 14. Workstream K --- Graceful Shutdown

## Goal

Do not terminate the process abruptly when receiving `SIGTERM` or
`SIGINT`.

Conceptual API shutdown:

``` text
SIGTERM
   ↓
stop accepting new requests
   ↓
finish / bound active work
   ↓
close HTTP server
   ↓
close PostgreSQL pool
   ↓
close Redis connection
   ↓
flush logs/telemetry where needed
   ↓
exit
```

Example shape:

``` ts
async function shutdown(signal: string) {
  logger.info({ signal }, "shutdown started");

  server.close(async () => {
    await database.close();
    await redis.quit();
    process.exit(0);
  });
}
```

The final implementation needs timeout protection so shutdown cannot
hang forever.

Worker-specific graceful shutdown is substantially more complicated and
belongs to the distributed-execution phase.

## Experiment

Start the API and send `SIGTERM`.

Verify:

-   process logs shutdown
-   HTTP server closes
-   DB connections close
-   Redis connection closes
-   process exits successfully

------------------------------------------------------------------------

# 15. Workstream L --- Docker Compose Development Environment

## Goal

A developer should be able to start required local infrastructure
predictably.

Initial Compose services:

``` text
postgres
redis
```

Potential later additions:

``` text
prometheus
grafana
local observability services
```

Do not add everything in Phase 0.

Expected command:

``` bash
docker compose up -d
```

Then:

``` bash
pnpm db:migrate
pnpm dev
```

## Data volumes

PostgreSQL should use a persistent development volume unless
intentionally reset.

Document how to perform a clean reset.

------------------------------------------------------------------------

# 16. Workstream M --- Testing Baseline

## Goal

Establish testing conventions before important business logic appears.

Use **Vitest**.

Phase 0 should establish three conceptual categories:

``` text
Unit tests
Integration tests
System/failure tests
```

Not every category needs extensive tests yet.

## Initial tests

At minimum:

### Configuration

``` text
✓ valid configuration parses
✓ missing required configuration fails
```

### Health endpoint

``` text
✓ liveness returns success
✓ readiness succeeds when DB is available
✓ readiness fails appropriately when critical dependency is unavailable
```

### Error middleware

``` text
✓ known application error maps correctly
✓ unknown error becomes safe 500 response
✓ internal stack/error details are not exposed
```

### Database

``` text
✓ test database connection works
✓ migration can be applied
```

## Important principle

Helmrun does **not** target arbitrary code-coverage numbers.

Testing depth should follow risk.

Later:

``` text
utility function             → unit test
worker claiming              → concurrency/integration tests
lease recovery               → failure tests
SQS redelivery               → idempotency tests
sandbox resource exhaustion  → system test
```

------------------------------------------------------------------------

# 17. Workstream N --- API Documentation Baseline

## Goal

Establish an OpenAPI workflow before dozens of endpoints exist.

Phase 0 only needs:

-   OpenAPI configuration
-   API metadata
-   health endpoints or one sample endpoint documented
-   agreed approach for keeping schemas aligned with runtime validation

Do not spend days creating documentation tooling.

The public API becomes substantial in Phase 1.

------------------------------------------------------------------------

# 18. Workstream O --- Code Quality Tooling

## Goal

Make basic quality checks automatic.

Repository-level commands should include equivalents of:

``` bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Formatting should be deterministic.

Git hooks are optional; CI enforcement matters more than elaborate local
hooks.

## Quality standard

Phase 0 code should demonstrate:

-   strict TypeScript
-   small modules
-   explicit dependency ownership
-   parameterized SQL
-   structured logging
-   centralized configuration
-   centralized HTTP error boundary
-   tests for infrastructure behavior
-   no committed secrets

It should **not** demonstrate complexity for its own sake.

------------------------------------------------------------------------

# 19. Workstream P --- Minimal CI Baseline

## Goal

Catch broken repository state automatically.

A basic GitHub Actions workflow may run:

``` text
checkout
   ↓
install
   ↓
lint
   ↓
typecheck
   ↓
test
   ↓
build
```

Full deployment CI/CD belongs to the AWS/production phase.

Phase 0 CI is only a repository quality gate.

------------------------------------------------------------------------

# 20. Failure-Oriented Engineering in Phase 0

Even the foundation should be tested beyond the happy path.

Run these experiments manually or automatically where reasonable.

## Experiment 1 --- PostgreSQL unavailable

``` text
API
 ↓
Postgres ✕
```

Observe:

-   startup/readiness behavior
-   error message quality
-   no unhandled promise rejection
-   structured logs

## Experiment 2 --- Redis unavailable

``` text
API
 ↓
Redis ✕
```

At this stage there may be no Redis-dependent business feature.

Still verify:

-   client failure is observable
-   application lifecycle is controlled
-   no infinite noisy reconnect loop

Later phases define which Redis failures are degradable.

## Experiment 3 --- Invalid environment

``` text
missing DATABASE_URL
```

Expected: fail fast.

## Experiment 4 --- Port already occupied

Start another process on the API port.

Expected:

-   controlled startup failure
-   useful log
-   no mysterious hanging process

## Experiment 5 --- SIGTERM

Expected graceful shutdown.

## Experiment 6 --- malformed HTTP body

Expected:

-   safe 4xx response
-   no stack trace leakage
-   request ID available

------------------------------------------------------------------------

# 21. Concurrency and Load in Phase 0

Phase 0 is **not** the main load-testing phase.

However, perform one small baseline test to validate that the API and
database pool behave normally under concurrent requests.

Example:

``` text
100–500 concurrent health/simple DB requests
```

Measure only enough to catch obvious setup mistakes:

-   error rate
-   response latency
-   DB pool exhaustion
-   process stability

Do not optimize prematurely.

Record the result as a baseline for later comparison.

Full k6 load/failure testing belongs to Phase 8.

------------------------------------------------------------------------

# 22. Security Baseline

Phase 0 security is foundational rather than feature-specific.

Implement or establish rules for:

-   secrets excluded from source control
-   `.env.example` contains placeholders only
-   SQL always parameterized
-   safe HTTP error responses
-   request body size limits
-   sensible HTTP headers
-   dependency vulnerability awareness
-   no credentials in logs
-   production stack traces hidden from clients

Authentication, API keys, tenant isolation and RBAC belong to Phase 1.

Sandbox security belongs to Phase 5.

------------------------------------------------------------------------

# 23. Documentation Deliverables

Phase 0 should leave behind concise documentation for:

``` text
How to install dependencies
How to start local infrastructure
How to run migrations
How to start the API
How to run tests
How to reset local DB state
Repository structure
Environment variables
Basic engineering conventions
```

The repository should be usable without relying on memory of setup
commands.

------------------------------------------------------------------------

# 24. Suggested Implementation Order

Follow approximately this sequence:

``` text
1. Initialize repository
       ↓
2. Configure pnpm Workspaces
       ↓
3. Configure TypeScript
       ↓
4. Create app/package skeleton
       ↓
5. Add environment validation
       ↓
6. Add PostgreSQL + Redis Compose services
       ↓
7. Create database package + pool
       ↓
8. Establish migration workflow
       ↓
9. Create Redis client lifecycle
       ↓
10. Create Express app/server split
       ↓
11. Add request IDs
       ↓
12. Add Pino logging
       ↓
13. Add centralized errors
       ↓
14. Add liveness/readiness
       ↓
15. Add graceful shutdown
       ↓
16. Add Vitest baseline
       ↓
17. Add OpenAPI baseline
       ↓
18. Add lint/typecheck/build scripts
       ↓
19. Add basic CI
       ↓
20. Run failure experiments
       ↓
21. Document setup
```

Do not build Phase 1 product functionality while Phase 0 is still
unstable.

------------------------------------------------------------------------

# 25. Suggested Time Budget

Approximate only.

  Area                                      Learning   Implementation           Total
  ------------------------------------ ------------- ---------------- ---------------
  Monorepo + TypeScript conventions               1h             1.5h            2.5h
  Config/environment                            0.5h               1h            1.5h
  PostgreSQL foundation + migrations         2--2.5h          2--2.5h           4--5h
  Redis foundation                           1--1.5h               1h         2--2.5h
  Express/error/logging/request IDs               1h             2.5h            3.5h
  Health + graceful shutdown                    0.5h             1.5h              2h
  Testing + failure experiments                 0.5h               2h            2.5h
  OpenAPI + quality tooling + CI                0.5h             1.5h              2h
  Documentation/buffer                           ---          1--1.5h         1--1.5h
  **Total**                              **\~7--8h**    **\~14--15h**   **\~21--23h**

If some PostgreSQL/Redis/Express fundamentals are already comfortable,
the phase can finish closer to **18--20 hours**.

------------------------------------------------------------------------

# 26. Phase 0 Exit Criteria

Do **not** move to Phase 1 until these are true.

## Repository

-   [ ] pnpm workspace works from repository root.
-   [ ] API, scheduler and worker application boundaries exist.
-   [ ] Shared infrastructure packages have clear responsibilities.
-   [ ] Applications do not directly import implementation code from one
    another.

## TypeScript

-   [ ] Strict TypeScript configuration is enabled.
-   [ ] No casual use of `any` in foundation code.
-   [ ] Root typecheck passes.

## Configuration

-   [ ] Environment variables are validated with Zod.
-   [ ] Missing critical configuration fails clearly.
-   [ ] `.env.example` exists.
-   [ ] No secrets are committed.

## PostgreSQL

-   [ ] Local PostgreSQL starts predictably.
-   [ ] `pg.Pool` lifecycle is established.
-   [ ] Migration workflow works from a clean database.
-   [ ] SQL examples use parameterized queries.
-   [ ] DB shutdown is clean.

## Redis

-   [ ] Local Redis starts predictably.
-   [ ] Client lifecycle is established.
-   [ ] Redis failure is observable and controlled.
-   [ ] Redis is documented as non-authoritative state.

## API

-   [ ] Express application starts successfully.
-   [ ] `app` and process/server lifecycle are separated.
-   [ ] Request IDs exist.
-   [ ] Central error middleware exists.
-   [ ] Safe error responses exist.
-   [ ] Liveness endpoint exists.
-   [ ] Readiness endpoint exists.
-   [ ] Graceful shutdown works.

## Logging

-   [ ] Pino structured logging works.
-   [ ] Request logs contain correlation information.
-   [ ] Errors serialize correctly.
-   [ ] Secrets are not logged.

## Testing

-   [ ] Vitest works from root.
-   [ ] Foundation tests pass.
-   [ ] DB integration test works.
-   [ ] Error middleware is tested.
-   [ ] Readiness behavior is tested.

## Tooling

-   [ ] lint passes.
-   [ ] typecheck passes.
-   [ ] tests pass.
-   [ ] build passes.
-   [ ] basic GitHub Actions quality workflow passes.

## Failure behavior

-   [ ] Invalid config tested.
-   [ ] PostgreSQL unavailable behavior tested.
-   [ ] Redis unavailable behavior observed/tested.
-   [ ] Port collision tested.
-   [ ] SIGTERM graceful shutdown tested.
-   [ ] Malformed request handling tested.

## Documentation

-   [ ] README explains local setup.
-   [ ] Migration commands documented.
-   [ ] Environment variables documented.
-   [ ] Repository structure documented.

------------------------------------------------------------------------

# 27. Explicitly Out of Phase 0

Do **not** add these yet:

-   user registration/login flows
-   JWT implementation
-   API-key management
-   RBAC
-   tenant business logic
-   agent CRUD
-   agent versioning
-   run creation
-   caching strategy
-   rate limiting
-   SQS
-   S3
-   scheduler logic
-   worker execution
-   LLM providers
-   MCP
-   agent runtime
-   SSE
-   checkpoints
-   leases
-   heartbeats
-   Docker agent sandboxing
-   OpenTelemetry tracing implementation
-   Prometheus/Grafana deployment
-   Terraform infrastructure
-   AWS deployment
-   Kubernetes

The foundation should support these features later without trying to
implement them now.

------------------------------------------------------------------------

# 28. What Good Phase 0 Code Should Feel Like

At the end of the phase, the repository should **not** look impressive
because it contains many features.

It should look disciplined because:

``` text
configuration is explicit
        +
dependencies have owners
        +
errors have boundaries
        +
logs are structured
        +
database lifecycle is controlled
        +
shutdown is intentional
        +
tests can run reliably
        +
local setup is repeatable
```

This is the baseline on which the harder Helmrun engineering---distributed
execution, idempotency, recovery, sandboxing and cloud deployment---will
be built.

------------------------------------------------------------------------

# 29. Phase Completion Definition

Phase 0 is complete when a new developer can clone the repository and,
using only the repository documentation, reach this state:

``` text
PostgreSQL       healthy
Redis            healthy
API              healthy + ready
Migrations       applied
Tests            passing
Typecheck        passing
Build            passing
CI               passing
Shutdown         graceful
Failure behavior understood
```

Only then should Helmrun move into **Phase 1 --- Control Plane**.
