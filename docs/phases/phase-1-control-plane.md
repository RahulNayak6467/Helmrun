# Helmrun Phase 1 — Control Plane Foundation

## Phase Status

This phase defines the **first real product layer** of Helmrun.

The goal is to build a production-oriented control plane that can:

- identify tenants and callers,
- manage API keys,
- define agents,
- create immutable agent versions,
- create and inspect runs,
- enforce ownership boundaries,
- expose clean external APIs,
- persist all authoritative state in PostgreSQL.

This phase **does not execute agents yet**.

The execution path begins in later phases.

---

# 1. Phase Goal

At the end of Phase 1, a developer should be able to:

```text
authenticate
    ↓
create tenant-scoped resources
    ↓
create an agent
    ↓
create immutable agent versions
    ↓
create a run record
    ↓
inspect the run through the API
```

Conceptually:

```text
Developer
   │
   │ HTTPS
   ▼
┌───────────────────────────────┐
│        Helmrun Control Plane      │
│                               │
│ Auth / API Keys               │
│ Tenants                       │
│ Agents                        │
│ Agent Versions                │
│ Runs                          │
│ Basic Quotas                  │
└──────────────┬────────────────┘
               │
               ▼
          PostgreSQL
```

The primary objective is:

> Build the durable management layer that later execution infrastructure can trust.

---

# 2. Estimated Duration

Recommended duration:

```text
2 to 2.5 weeks
```

Approximate effort:

```text
40–55 hours total
```

Suggested split:

| Area | Approx. hours |
|---|---:|
| Theory and focused experiments | 10–14 h |
| Database/schema design | 7–9 h |
| Auth/API key system | 6–8 h |
| Agent/version APIs | 6–8 h |
| Run APIs and state model | 5–7 h |
| Tests/failure/concurrency work | 5–7 h |
| Docs/refactoring | 3–4 h |

Do not treat these numbers as strict deadlines. Exit criteria matter more than exact hours.

---

# 3. What Phase 1 Adds to Helmrun

Phase 0 gave us engineering infrastructure.

Phase 1 adds actual Helmrun domain behavior.

```text
Phase 0
│
├── configuration
├── database connectivity
├── Redis connectivity
├── logging
├── errors
├── migrations
├── testing
├── Docker development
└── CI
        │
        ▼
Phase 1
│
├── tenants
├── API keys
├── agents
├── agent versions
├── runs
├── ownership boundaries
├── authorization
└── control-plane API contracts
```

---

# 4. Frozen vs Conceptual

## Frozen architectural direction

Phase 1 should preserve these decisions:

- PostgreSQL is the source of truth.
- The control plane remains a modular monolith.
- Data is tenant-scoped.
- External access is authenticated.
- API keys are supported as a first-class developer authentication mechanism.
- Agent versions are immutable after creation.
- A run references a specific agent version.
- Run creation persists durable intent before later execution machinery exists.
- SQL remains explicit/raw using `pg`.
- Zod validates application boundaries.
- OpenAPI documents public endpoints.
- Domain logic should not live directly in Express route handlers.

## Conceptual / not frozen yet

The following can change during implementation:

- exact table names,
- exact column names,
- exact API URLs,
- exact error code names,
- exact API-key prefix format,
- exact quota schema,
- exact run status enum names,
- whether users are modeled separately in v1,
- exact repository/service file layout,
- exact pagination format,
- exact audit record structure.

Do not optimize prematurely for later phases.

---

# 5. Core Domain Model

A useful conceptual model is:

```text
Tenant
  │
  ├── API Keys
  │
  ├── Agents
  │     │
  │     └── Agent Versions
  │
  └── Runs
        │
        └── references Agent Version
```

Potential relationships:

```text
tenants
   │
   ├──< api_keys
   │
   ├──< agents
   │      │
   │      └──< agent_versions
   │
   └──< runs
           │
           └── agent_version_id
```

---

# 6. Theory to Learn Before / During This Phase

Phase 1 is the point where PostgreSQL fundamentals must become more serious.

Do not study everything before writing code.

Use:

```text
theory
  ↓
small experiment
  ↓
Helmrun implementation
```

---

# 7. Theory Module A — Relational Data Modeling

Study:

- primary keys,
- foreign keys,
- unique constraints,
- check constraints,
- nullable vs non-nullable columns,
- one-to-many relationships,
- normalization,
- timestamps,
- UUIDs,
- enum vs check constraint tradeoffs,
- JSONB tradeoffs,
- ownership modeling.

Questions to understand:

- Why should `agent_versions.agent_id` be a foreign key?
- What does the database guarantee that TypeScript cannot?
- Which invariants should live in PostgreSQL?
- What happens if a tenant is deleted?
- Should deletion cascade?
- When is soft deletion justified?

### Experiment

Create a tiny schema with:

```text
tenants
agents
agent_versions
```

Attempt invalid operations:

- create agent for missing tenant,
- create duplicate agent version,
- delete parent row,
- insert invalid status,
- insert null into required column.

Observe which invariants PostgreSQL enforces automatically.

---

# 8. Theory Module B — Indexing

Study:

- B-tree indexes,
- primary-key indexes,
- unique indexes,
- composite indexes,
- leftmost-prefix behavior,
- index selectivity,
- partial indexes,
- index cost,
- write overhead.

Helmrun examples:

```sql
SELECT *
FROM agents
WHERE tenant_id = $1
  AND id = $2;
```

Potential composite access pattern:

```text
(tenant_id, id)
```

List agents:

```sql
SELECT *
FROM agents
WHERE tenant_id = $1
ORDER BY created_at DESC
LIMIT $2;
```

Possible index:

```text
(tenant_id, created_at DESC)
```

Do not add indexes just because columns exist.

Indexes should follow actual access patterns.

---

# 9. Theory Module C — EXPLAIN / EXPLAIN ANALYZE

Understand:

- sequential scan,
- index scan,
- bitmap scan at a conceptual level,
- query planning,
- estimated rows,
- actual rows,
- execution time.

Experiment with:

```sql
EXPLAIN ANALYZE
SELECT ...
```

before and after creating an index.

Goal:

> Learn to justify an index with evidence.

---

# 10. Theory Module D — Transactions

Study:

- BEGIN,
- COMMIT,
- ROLLBACK,
- atomicity,
- transaction boundaries,
- application-level failure during transaction.

Example:

Creating an agent and its first version may eventually need:

```text
BEGIN
  create agent
  create version
COMMIT
```

If version creation fails:

```text
ROLLBACK
```

and no half-created logical operation remains.

---

# 11. Theory Module E — Isolation and Concurrency

Learn at least:

- PostgreSQL default `READ COMMITTED`,
- concurrent transactions,
- lost update,
- non-repeatable read,
- row locking concept,
- conditional updates,
- optimistic concurrency concept.

Do not dive into deep Serializable internals yet.

We need enough foundation so later phases can build:

- worker claiming,
- leases,
- state transitions.

### Small experiment

Run two concurrent transactions that attempt to update the same row.

Observe:

- blocking,
- row locks,
- final values.

This experiment is more important than memorizing isolation definitions.

---

# 12. Theory Module F — Connection Pooling

Study:

- why opening one PostgreSQL connection per request is bad,
- pool size,
- waiting clients,
- connection exhaustion,
- connection timeout,
- transaction lifetime,
- why long transactions are dangerous.

Use the existing `pg.Pool`.

Understand this relationship:

```text
API instances × pool size
            ↓
potential DB connections
```

Example:

```text
5 API instances × 20 connections
            =
100 possible PostgreSQL connections
```

Pool sizing is a system-level decision.

---

# 13. Theory Module G — Authentication vs Authorization

Understand the distinction:

```text
Authentication
"Who are you?"

Authorization
"Are you allowed to do this?"
```

Helmrun example:

```text
API key
   ↓
authenticate
   ↓
tenant = tenant_123
   ↓
request agent_456
   ↓
authorize ownership
```

Authentication success must not imply access to every resource.

---

# 14. Theory Module H — API-Key Security

Understand:

- never store plaintext API keys,
- cryptographically secure generation,
- prefixes for identification,
- hashing,
- revocation,
- expiration if supported,
- last-used timestamps,
- key rotation concepts,
- secret display only once,
- logging rules.

Conceptual key:

```text
helmrun_live_abcd1234_<secret>
```

Database stores:

```text
key_id
prefix
hash
tenant_id
status
created_at
last_used_at
```

not the original secret.

---

# 15. Theory Module I — REST/API Design

Study only what Phase 1 requires:

- resource-oriented routes,
- HTTP methods,
- HTTP status codes,
- idempotency concepts,
- validation,
- pagination,
- consistent errors,
- API versioning.

Example:

```text
POST   /v1/agents
GET    /v1/agents
GET    /v1/agents/:agentId
POST   /v1/agents/:agentId/versions
GET    /v1/agents/:agentId/versions
POST   /v1/runs
GET    /v1/runs/:runId
```

Exact endpoints remain conceptual.

---

# 16. Phase 1 Implementation Sequence

Recommended order:

```text
1. domain/schema design
2. migrations
3. tenant model
4. API-key authentication
5. authorization context
6. agent CRUD
7. immutable agent versions
8. run creation/read model
9. basic quota model
10. OpenAPI
11. integration tests
12. concurrency/failure experiments
13. documentation/refactoring
```

Do not implement everything simultaneously.

---

# 17. Step 1 — Design the Schema

Create an initial schema for:

```text
tenants
api_keys
agents
agent_versions
runs
```

Optional if needed:

```text
audit_events
tenant_limits
```

Avoid creating later-phase tables such as:

```text
worker_leases
checkpoints
execution_attempts
```

until the relevant phase.

---

# 18. Tenant Table

Conceptual fields:

```text
tenants

id
name
status
created_at
updated_at
```

Potential invariants:

- `id` unique,
- name required,
- status constrained,
- timestamps required.

Tenant is the security boundary.

Almost every meaningful resource should have an unambiguous tenant owner.

---

# 19. API Keys Table

Conceptual fields:

```text
api_keys

id
tenant_id
name
key_prefix
key_hash
status
created_at
revoked_at
last_used_at
```

Possible statuses:

```text
ACTIVE
REVOKED
```

Do not store:

```text
plaintext_key
```

The full key is shown once at creation time.

---

# 20. Agents Table

Conceptual fields:

```text
agents

id
tenant_id
name
description
created_at
updated_at
```

Potential rules:

- agent belongs to exactly one tenant,
- agent identity remains stable across versions.

---

# 21. Agent Versions Table

Conceptual fields:

```text
agent_versions

id
tenant_id
agent_id
version
instructions
model_provider
model_name
tool_configuration
runtime_configuration
created_at
```

Important invariant:

> Agent versions should be immutable after creation.

Instead of:

```text
UPDATE version 3
```

create:

```text
version 4
```

Why?

Historical runs should be reproducible enough to identify:

```text
which exact configuration was used?
```

---

# 22. Runs Table

Phase 1 creates durable run intent even though no worker executes it yet.

Conceptual fields:

```text
runs

id
tenant_id
agent_id
agent_version_id
status
input
created_at
updated_at
```

Possible temporary Phase 1 lifecycle:

```text
QUEUED
```

The exact state machine is **not frozen**.

Later phases will extend the run record with execution-specific data.

---

# 23. Run Version Pinning

A run must not simply reference:

```text
agent_id
```

and later resolve "latest version".

Instead:

```text
run
 └── agent_version_id
```

This preserves:

```text
run_123
was created using
agent research-agent
version 7
```

even after versions 8 and 9 are deployed.

---

# 24. Step 2 — Migrations

Use the Phase 0 migration infrastructure.

Every schema change should be reproducible.

Example:

```text
001_create_tenants.sql
002_create_api_keys.sql
003_create_agents.sql
004_create_agent_versions.sql
005_create_runs.sql
```

Exact migration naming is flexible.

Requirements:

- clean database can migrate from zero,
- migration failure is visible,
- CI can execute migrations against test DB,
- schema is not created manually.

---

# 25. Step 3 — Tenant Context

Every authenticated request should eventually carry a verified tenant context.

Conceptually:

```ts
type AuthContext = {
  tenantId: string;
  apiKeyId: string;
};
```

Request flow:

```text
request
   ↓
request ID
   ↓
authentication
   ↓
AuthContext
   ↓
authorization
   ↓
route handler
```

Avoid repeatedly parsing/re-authenticating within each service.

---

# 26. Step 4 — API Key Creation

A management/bootstrap path must allow creation of a key.

Conceptually:

```text
generate random secret
       ↓
derive prefix
       ↓
hash secret
       ↓
store hash + metadata
       ↓
return full key once
```

Pseudo-code:

```ts
const secret = generateSecureSecret();
const key = buildApiKey(secret);

await repository.insert({
  prefix: key.prefix,
  hash: hashApiKey(secret),
  tenantId,
});

return key.fullValue;
```

Exact hashing approach should be selected deliberately.

---

# 27. API Key Authentication Flow

Incoming request:

```text
Authorization: Bearer <HELMRUN_API_KEY>
```

Flow:

```text
extract key
   ↓
validate basic format
   ↓
identify candidate key record
   ↓
verify secret against stored representation
   ↓
check ACTIVE status
   ↓
resolve tenant
   ↓
attach AuthContext
```

Failures:

```text
missing key
invalid format
unknown key
wrong secret
revoked key
disabled tenant
```

must map to controlled authentication errors.

---

# 28. Authorization Rule — Tenant Ownership

Every resource query should include tenant ownership.

Bad:

```sql
SELECT *
FROM agents
WHERE id = $1;
```

Better:

```sql
SELECT *
FROM agents
WHERE id = $1
  AND tenant_id = $2;
```

This reduces the chance of accidental cross-tenant access.

The service should not:

```text
load resource
   ↓
then remember to check tenant
```

when the database query itself can scope ownership.

---

# 29. Step 5 — Agent APIs

Minimum capabilities:

```text
create agent
list agents
get agent
update mutable agent metadata
```

Likely examples:

```text
POST   /v1/agents
GET    /v1/agents
GET    /v1/agents/:agentId
PATCH  /v1/agents/:agentId
```

Do not add complex search/filtering yet.

---

# 30. Agent Creation Flow

```text
Client
  ↓
POST /agents
  ↓
Authenticate
  ↓
Validate
  ↓
Authorize tenant
  ↓
AgentService
  ↓
AgentRepository
  ↓
PostgreSQL
  ↓
Response
```

Layer responsibilities:

```text
Route
  → HTTP wiring

Controller
  → transport-level mapping

Service
  → business behavior

Repository
  → PostgreSQL interaction
```

Do not create unnecessary interfaces solely for ceremony.

---

# 31. Step 6 — Agent Version APIs

Capabilities:

```text
create version
list versions
get version
```

Likely:

```text
POST /v1/agents/:agentId/versions
GET  /v1/agents/:agentId/versions
GET  /v1/agents/:agentId/versions/:version
```

Agent version creation should validate:

- tenant ownership,
- agent existence,
- supported model configuration shape,
- tool configuration shape,
- runtime configuration shape.

Actual LLM provider integration happens in Phase 2.

---

# 32. Version Number Concurrency

Suppose two requests simultaneously attempt:

```text
create next version
```

Naive logic:

```text
read MAX(version) = 5
request A → create 6
request B → create 6
```

This is a useful Phase 1 concurrency problem.

The database should have a uniqueness invariant such as conceptually:

```text
UNIQUE(agent_id, version)
```

The implementation must handle races correctly.

Possible designs:

- transaction + row lock,
- database-generated sequencing strategy,
- retry on unique conflict.

Do not rely purely on application memory.

This is one of the first deliberate concurrency exercises in Helmrun.

---

# 33. Step 7 — Run Creation

Minimum capabilities:

```text
create run
get run
list runs
```

Conceptually:

```text
POST /v1/runs
GET  /v1/runs/:runId
GET  /v1/runs
```

A run request might contain:

```json
{
  "agentId": "agt_...",
  "version": 3,
  "input": {
    "prompt": "..."
  }
}
```

or some equivalent shape.

Exact public contract remains conceptual.

---

# 34. Run Creation Transaction

Run creation should guarantee:

- tenant owns agent,
- version exists,
- version belongs to agent,
- version belongs to tenant,
- run references exact version,
- run intent persists atomically.

Conceptual transaction:

```text
BEGIN

validate/resolve agent version
create run(status = QUEUED)

COMMIT
```

Later phases will connect `QUEUED` runs to scheduling.

---

# 35. Idempotent Run Creation — Introduce Concept, Do Not Overbuild

Clients can retry requests after network failures.

Example:

```text
Client
  │
  │ POST /runs
  ▼
Helmrun creates run
  │
  X response lost

Client retries
```

Without idempotency:

```text
run_1
run_2
```

may both be created.

Phase 1 should at least design and, preferably, implement a basic idempotency-key mechanism for run creation.

Example:

```text
Idempotency-Key: request_abc
```

Conceptual storage:

```text
tenant_id
idempotency_key
operation
resource_id
created_at
```

This becomes valuable later when execution has side effects.

Do not build a huge generic idempotency framework if a scoped implementation is enough.

---

# 36. Step 8 — Basic Quotas

Phase 1 only needs **control-plane quotas** that help establish the data model.

Examples:

```text
max agents
max active API keys
max agent versions per agent
```

Execution concurrency quotas belong to later phases.

Potential model:

```text
tenant_limits
```

or code-based defaults initially.

Do not build billing.

---

# 37. Pagination

List endpoints should not return unlimited rows.

Use bounded pagination.

Options:

- offset pagination initially,
- cursor/keyset pagination if justified.

For Helmrun, a simple bounded implementation is acceptable in Phase 1.

Whatever approach is chosen should have:

```text
default limit
maximum limit
stable ordering
```

Do not spend excessive time building a universal pagination abstraction.

---

# 38. Validation

Use Zod at external boundaries.

Example conceptual schema:

```ts
const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
});
```

Rules:

- validate body,
- validate path params,
- validate query params,
- reject unexpected invalid input predictably.

Do not duplicate all PostgreSQL constraints in Zod unless useful for better client errors.

Database constraints remain the final integrity boundary.

---

# 39. Domain Errors

Phase 1 should extend the Phase 0 error model.

Possible domain errors:

```text
AuthenticationRequiredError
InvalidApiKeyError
ApiKeyRevokedError

TenantNotFoundError
TenantDisabledError

AgentNotFoundError
AgentVersionNotFoundError
AgentVersionConflictError

RunNotFoundError

QuotaExceededError

IdempotencyConflictError
```

Each error should have:

- stable internal code,
- appropriate HTTP status,
- safe external message,
- contextual structured logs where appropriate.

---

# 40. Error Response Contract

Conceptually:

```json
{
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "Agent not found",
    "requestId": "req_..."
  }
}
```

Do not expose:

```text
SQL queries
stack traces
database hosts
API-key hashes
internal secrets
```

---

# 41. Logging Updates from Phase 0

Phase 1 should extend logging context.

Existing Phase 0:

```text
requestId
method
path
status
duration
```

Add where available:

```text
tenantId
apiKeyId
agentId
agentVersionId
runId
```

Examples:

```ts
logger.info(
  {
    tenantId,
    agentId,
    version,
  },
  "agent version created"
);
```

Do not log:

```text
full API keys
authorization headers
raw secrets
sensitive request payloads by default
```

---

# 42. Database Package Updates

Phase 1 should evolve the database package with:

- transaction helper if justified,
- migration additions,
- repositories,
- test database support,
- query timing visibility if useful.

Potential transaction helper:

```ts
await withTransaction(pool, async (client) => {
  // operations
});
```

Do not build an ORM-like abstraction over raw SQL.

The SQL should remain visible and understandable.

---

# 43. Configuration Updates

Phase 1 may add configuration such as:

```text
API_KEY_HASH_SECRET
DEFAULT_PAGE_SIZE
MAX_PAGE_SIZE
API_KEY_PREFIX
```

Only add config when behavior actually needs to vary.

Avoid turning every numeric constant into an environment variable.

---

# 44. Redis Usage in Phase 1

Redis exists from Phase 0, but it should **not be forced into Phase 1 features**.

Possible legitimate use:

- rate limiting,
- limited cache experiment.

However, PostgreSQL remains authoritative.

Caching is optional at this stage unless measurements or API patterns justify it.

If a cache is introduced, use the reliability principles already agreed:

```text
Redis failure
   ↓
graceful DB fallback
```

where the cached data permits it.

---

# 45. Basic Rate Limiting

A small rate-limiting layer is appropriate.

Potential dimensions:

```text
per API key
per tenant
```

Start with simple policy.

Example:

```text
100 requests / minute
```

Exact numbers are not frozen.

Important behaviors:

- bounded resource abuse,
- predictable `429`,
- Redis failure strategy defined,
- rate-limit headers if useful.

Do not build sophisticated adaptive limits yet.

---

# 46. OpenAPI Updates

Phase 1 should document every public endpoint.

Document:

- path,
- method,
- auth requirement,
- request schema,
- response schema,
- error responses,
- pagination,
- idempotency key if supported.

The generated/spec documentation should match actual behavior.

---

# 47. Health / Readiness Updates

Phase 0 health checks continue.

Phase 1 readiness should at minimum consider:

```text
API initialized
PostgreSQL reachable
required migrations compatible
```

Redis should only make readiness fail if a Phase 1 feature truly requires Redis to function.

If Redis is used only for optional caching:

```text
Redis failure ≠ API unready
```

This is an important distinction.

---

# 48. Graceful Shutdown Updates

Phase 1 should ensure shutdown handles:

```text
stop accepting HTTP requests
allow active requests to finish within limit
close PostgreSQL pool
close Redis connections
flush logs/telemetry if applicable
exit
```

No scheduler/worker shutdown logic yet.

---

# 49. Testing Strategy

Do not optimize for a coverage percentage.

Focus on risk.

Use a combination of:

```text
unit tests
integration tests
database tests
API tests
concurrency tests
failure tests
```

---

# 50. Tenant Isolation Tests

These are high priority.

Create:

```text
Tenant A
Tenant B
```

Then prove:

```text
Tenant A cannot:
- read Tenant B agent
- update Tenant B agent
- list Tenant B versions
- create run using Tenant B version
- inspect Tenant B run
```

These should be integration tests, not only mocked unit tests.

---

# 51. API Key Tests

Test:

```text
valid key → success
missing key → 401
invalid key → 401
revoked key → 401
wrong secret → 401
key from Tenant A cannot access Tenant B
plaintext key is never persisted
secret is not logged
```

Potential concurrency test:

```text
revoke key
while requests are in flight
```

Observe and define expected semantics.

---

# 52. Agent Tests

Test:

```text
create agent
get agent
list agents
update metadata

invalid tenant
missing agent
invalid body
duplicate constraints if applicable
pagination bounds
```

---

# 53. Agent Version Tests

Test:

```text
create version
get version
list versions
version immutable after creation
version belongs to correct tenant
version belongs to correct agent
```

High-value concurrency test:

```text
20 concurrent "create next version" requests
```

Verify:

- no duplicate version numbers,
- no corrupted data,
- failure behavior is controlled.

---

# 54. Run Tests

Test:

```text
create run for valid version
run references exact version
run status initially valid
cannot run another tenant's agent
cannot use nonexistent version
get run
list runs
pagination
```

If idempotency is implemented:

```text
same tenant
same idempotency key
same request
    ↓
same run
```

and:

```text
same key
different request
    ↓
controlled conflict
```

---

# 55. Database Constraint Tests

Deliberately bypass service logic in integration tests and verify PostgreSQL rejects invalid state.

Examples:

```text
agent with missing tenant
version with missing agent
duplicate version number
run with invalid version
invalid status
```

This proves correctness does not depend solely on TypeScript code.

---

# 56. Transaction Failure Tests

Inject failure inside a multi-step operation.

Example:

```text
create agent
    ↓
create first version
    X simulated failure
```

Expected:

```text
no partially-created logical result
```

This verifies transaction boundaries.

---

# 57. PostgreSQL Failure Experiment

During local testing:

```text
API running
    ↓
stop PostgreSQL
    ↓
send requests
```

Verify:

- request fails predictably,
- no hanging forever,
- structured error logged,
- secrets absent from logs,
- readiness changes appropriately,
- API recovers when PostgreSQL returns.

---

# 58. Redis Failure Experiment

If Redis is used in Phase 1:

```text
API running
    ↓
stop Redis
```

Then verify behavior for:

- rate limiting,
- optional cache,
- normal PostgreSQL-backed resource access.

Document whether the system:

```text
fails closed
fails open
degrades gracefully
```

per feature.

Do not let this behavior remain accidental.

---

# 59. Connection Pool Experiment

Create enough concurrent requests to pressure the PostgreSQL pool.

Observe:

```text
pool total
pool idle
pool waiting
request latency
DB connection count
```

Goal:

> Understand what happens when application concurrency exceeds database connection capacity.

Do not simply increase pool size until tests pass.

---

# 60. Basic Load Test

Phase 1 does not need large-scale benchmarking.

A small k6 scenario is enough.

Example endpoints:

```text
GET /agents
GET /agents/:id
POST /runs
```

Measure:

```text
throughput
p50
p95
p99
error rate
DB pool pressure
CPU
memory
```

The objective is baseline understanding, not performance bragging.

---

# 61. Code Quality Standard

Phase 1 should produce code that looks production-oriented without becoming ceremonial.

Required:

- strict TypeScript,
- explicit schemas,
- parameterized SQL,
- clear module ownership,
- meaningful domain errors,
- structured logs,
- tests for critical invariants,
- migrations,
- documented API,
- tenant scoping,
- transaction correctness,
- secure API-key handling.

Avoid:

```text
10 layers for a CRUD endpoint
interface for every class
repository factories without need
DTO explosion
generic "BaseService" abstractions
magic decorators
ORM-like wrappers over raw SQL
```

---

# 62. Suggested Module Layout

Conceptually:

```text
apps/api/src/
│
├── auth/
│   ├── auth.middleware.ts
│   ├── auth.service.ts
│   ├── api-key.repository.ts
│   ├── api-key.schema.ts
│   └── auth.errors.ts
│
├── tenants/
│   ├── tenant.service.ts
│   ├── tenant.repository.ts
│   └── tenant.errors.ts
│
├── agents/
│   ├── agent.routes.ts
│   ├── agent.controller.ts
│   ├── agent.service.ts
│   ├── agent.repository.ts
│   ├── agent.schema.ts
│   └── agent.errors.ts
│
├── agent-versions/
│   ├── agent-version.routes.ts
│   ├── agent-version.service.ts
│   └── agent-version.repository.ts
│
├── runs/
│   ├── run.routes.ts
│   ├── run.service.ts
│   ├── run.repository.ts
│   └── run.errors.ts
│
└── shared/
```

This structure is conceptual.

If colocating agent versions inside `agents/` is cleaner, do that.

Architecture matters more than folder aesthetics.

---

# 63. Repository Rules

Repositories should:

- execute SQL,
- map rows,
- accept required query parameters,
- avoid business-policy decisions.

Example:

```text
AgentRepository
├── insert
├── findById
├── listByTenant
└── updateMetadata
```

Repository should not decide:

```text
whether tenant may exceed quota
whether version creation is allowed
whether API key is authorized
```

Those belong higher in the application/domain layer.

---

# 64. Service Rules

Services should coordinate business behavior.

Example:

```text
AgentVersionService.createVersion()
    │
    ├── verify agent ownership
    ├── check relevant quota
    ├── assign/resolve next version safely
    ├── persist version
    └── emit structured application log
```

Do not put HTTP-specific concerns such as `res.status()` inside services.

---

# 65. Controller / Route Rules

Controllers/routes handle transport concerns.

Examples:

- parse validated inputs,
- obtain auth context,
- call service,
- map result to HTTP response.

They should not contain raw SQL.

---

# 66. Security Checklist

Phase 1 security should include:

- parameterized SQL,
- no plaintext API-key persistence,
- no secret logging,
- tenant-scoped queries,
- safe external error responses,
- request body limits,
- Zod validation,
- rate limiting,
- API-key revocation,
- least-privilege DB account where practical,
- environment secrets excluded from Git,
- dependency security review at a basic level.

Do not attempt full sandbox/tool security yet.

That belongs later.

---

# 67. Observability Baseline

Full OpenTelemetry arrives later, but Phase 1 should already make control-plane behavior understandable.

Logs should answer:

```text
who?
which tenant?
which resource?
which request?
what happened?
how long?
did it fail?
```

Useful application events:

```text
api_key.created
api_key.revoked
agent.created
agent.updated
agent_version.created
run.created
quota.exceeded
auth.failed
```

Do not log entire request payloads by default.

---

# 68. Metrics to Consider

If Prometheus is not fully integrated yet, at least identify future metrics.

Possible Phase 1 metrics:

```text
http_requests_total
http_request_duration_seconds
auth_failures_total
runs_created_total
agent_versions_created_total
db_query_duration_seconds
db_pool_waiting
rate_limit_rejections_total
```

Full metrics implementation can be staged according to the observability plan.

---

# 69. Documentation Updates

Phase 1 should update:

```text
docs/
├── architecture.md
├── control-plane.md
├── database.md
├── authentication.md
└── api.md
```

At minimum document:

- resource model,
- tenant boundary,
- API-key lifecycle,
- agent/version semantics,
- run creation semantics,
- current state model,
- important database invariants.

---

# 70. Architecture Decision Records

Record only decisions worth remembering.

Examples:

```text
Why API keys are hashed
Why agent versions are immutable
Why runs pin exact versions
Why PostgreSQL owns authoritative state
Why tenant ID is included in resource queries
```

Avoid creating an ADR for every minor implementation choice.

---

# 71. Phase 0 Foundation Areas That Must Be Updated

This section is intentionally included because Phase 0 infrastructure is **living infrastructure**.

## Database

Update:

- migrations,
- repositories,
- constraints,
- indexes,
- transaction support,
- test DB fixtures.

## Configuration

Add only required Phase 1 settings.

## Logging

Add:

```text
tenantId
apiKeyId
agentId
agentVersionId
runId
```

where appropriate.

## Error model

Add domain-specific authentication, agent, version, run, quota and idempotency errors.

## Tests

Expand with:

- tenant isolation,
- API key security,
- DB constraints,
- transaction failures,
- concurrency,
- load baseline.

## CI

Add:

- PostgreSQL-backed integration test execution,
- migrations in CI,
- API integration tests.

## Docker/local development

Ensure local stack supports reproducible API + PostgreSQL + Redis testing.

## Health/readiness

Refine PostgreSQL dependency semantics.

## OpenAPI

Add all Phase 1 public endpoints.

## Documentation

Add control-plane and database documentation.

## Shared packages

Extend only if Phase 1 reveals a genuine reusable boundary.

## Graceful shutdown

Validate connection-pool and Redis cleanup.

## Failure testing

Add DB/Redis/pool/auth/concurrency experiments.

---

# 72. CI Changes

A Phase 1 CI pipeline should approximately become:

```text
install
  ↓
lint
  ↓
typecheck
  ↓
start test dependencies
  ↓
run migrations
  ↓
unit tests
  ↓
integration tests
  ↓
build
```

Potential test dependencies:

```text
PostgreSQL
Redis if required
```

CI should fail if migrations or schema assumptions fail.

---

# 73. Git / Commit Discipline

Prefer feature-sized commits.

Examples:

```text
feat(auth): add hashed API key authentication
feat(agents): create tenant-scoped agent endpoints
feat(agents): add immutable agent version creation
feat(runs): persist run intent
test(auth): verify revoked key behavior
test(agents): verify cross-tenant isolation
```

Avoid massive "Phase 1 complete" commits.

---

# 74. Suggested Weekly Breakdown

## Week 1

Focus:

```text
PostgreSQL theory
schema
migrations
tenants
API keys
authentication
authorization
```

Target end state:

```text
authenticated tenant-scoped API requests work
```

## Week 2

Focus:

```text
agents
agent versions
transactions
version concurrency
runs
idempotency
```

Target end state:

```text
developer can create agent/version/run through real API
```

## Optional extra 2–3 days

Focus:

```text
integration tests
failure experiments
load baseline
OpenAPI
documentation
refactoring
```

---

# 75. Phase 1 End-to-End Demo

By the end of Phase 1, this flow should work:

```text
1. Create tenant/bootstrap tenant
2. Create API key
3. Authenticate using API key
4. Create agent
5. Create version 1
6. Create version 2
7. List agent versions
8. Create run pinned to version 2
9. Fetch run
10. Verify another tenant cannot access it
```

Example:

```text
Developer
   │
   │ API key
   ▼
Helmrun API
   │
   ├── create research-agent
   │
   ├── create research-agent:v1
   │
   ├── create research-agent:v2
   │
   └── create run using v2
              │
              ▼
          PostgreSQL
```

The run will remain unexecuted/queued until later phases.

That is intentional.

---

# 76. Mandatory Failure Demo

Phase 1 should also demonstrate non-happy paths.

At minimum:

```text
Invalid API key
     ↓
401

Cross-tenant resource access
     ↓
404/403 according to chosen policy

Concurrent version creation
     ↓
no duplicate/corrupted versions

PostgreSQL unavailable
     ↓
controlled API failure

Duplicate idempotency request
     ↓
no duplicate run

Invalid request payload
     ↓
controlled validation error
```

---

# 77. Exit Criteria

Phase 1 is complete only when all critical criteria below are satisfied.

## Domain

- [ ] Tenant model exists.
- [ ] API-key model exists.
- [ ] Agent model exists.
- [ ] Immutable agent-version model exists.
- [ ] Run model exists.
- [ ] Runs pin an exact agent version.

## Authentication / Authorization

- [ ] API keys are securely generated.
- [ ] Plaintext API keys are not stored.
- [ ] Keys can be revoked.
- [ ] Auth context resolves tenant.
- [ ] Tenant ownership is enforced.
- [ ] Cross-tenant access tests pass.

## Database

- [ ] Schema is fully migration-driven.
- [ ] Foreign keys are enforced.
- [ ] Important uniqueness constraints exist.
- [ ] Relevant indexes are justified.
- [ ] Parameterized SQL is used.
- [ ] Multi-step logical operations use transactions.
- [ ] Connection pooling is understood and configured.

## Agents

- [ ] Create agent works.
- [ ] Get agent works.
- [ ] List agents works.
- [ ] Update allowed metadata works.

## Versions

- [ ] Create version works.
- [ ] List versions works.
- [ ] Get version works.
- [ ] Versions are immutable.
- [ ] Concurrent version creation is safe.

## Runs

- [ ] Create run works.
- [ ] Run references exact version.
- [ ] Get run works.
- [ ] List runs works.
- [ ] Basic idempotent run creation is implemented or explicitly designed with a documented reason for deferral.

## Reliability

- [ ] PostgreSQL failure behavior is tested.
- [ ] Redis failure behavior is defined if Redis is used.
- [ ] Pool pressure experiment performed.
- [ ] Transaction rollback behavior tested.
- [ ] Critical concurrency race tested.

## Engineering

- [ ] Structured logging contains relevant resource IDs.
- [ ] Domain error model is extended.
- [ ] OpenAPI matches public endpoints.
- [ ] Integration tests run in CI.
- [ ] No secrets appear in logs.
- [ ] Graceful shutdown still works.
- [ ] Documentation reflects actual implementation.

---

# 78. Explicitly Out of Scope

Do **not** add these in Phase 1:

- SQS execution dispatch,
- scheduler,
- workers,
- agent runtime,
- LLM provider calls,
- MCP execution,
- Docker agent sandboxing,
- heartbeats,
- leases,
- checkpoints,
- crash recovery,
- worker concurrency,
- SSE execution streaming,
- full OpenTelemetry tracing,
- AWS deployment,
- Terraform infrastructure,
- Kubernetes,
- billing,
- advanced usage metering,
- complex caching,
- distributed locks,
- Kafka,
- gRPC,
- RAG,
- vector database,
- OpenSearch.

These belong to later phases.

---

# 79. Things We Should Resist

Do not let Phase 1 become:

```text
"Build every SaaS feature before the execution engine."
```

Avoid:

- teams/org invitation systems,
- OAuth providers,
- password reset flows,
- sophisticated dashboard,
- billing UI,
- subscriptions,
- audit-log search,
- advanced RBAC role editor,
- custom policy language,
- dozens of agent metadata fields.

Helmrun's differentiation is the execution platform.

The control plane needs to be **correct and strong**, not bloated.

---

# 80. Definition of Done

Phase 1 is successful when:

> A developer can authenticate to Helmrun, create tenant-owned agents and immutable versions, create a durable run pinned to an exact version, retrieve those resources through a documented API, and the system enforces database integrity, tenant isolation, transactions, secure API-key handling, predictable errors, and tested concurrency/failure behavior.

At that point Helmrun has a trustworthy **control plane**.

The next phase can safely build the first real **agent runtime** on top of it.
