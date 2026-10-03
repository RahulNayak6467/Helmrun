# Helmrun Phase 8 — Developer Experience, Hardening & Finalization

## Phase Status

Phase 8 is the final v1 phase for Helmrun.

By the end of Phase 7, Helmrun should already be a functioning cloud-deployed distributed agent execution platform with:

- a modular control plane,
- API-key authentication and tenant isolation,
- immutable agent versions,
- distributed scheduling through SQS,
- worker fleets,
- durable execution,
- leases and heartbeats,
- checkpoint recovery,
- stale-worker fencing,
- Docker sandbox isolation,
- resource controls,
- scoped secrets,
- SSE streaming,
- structured logs,
- metrics,
- traces,
- AWS deployment,
- Terraform,
- CI/CD.

Phase 8 does **not** exist to add another large subsystem.

The objective is:

> Turn Helmrun from a technically impressive engineering prototype into a coherent, testable, usable, documented, resume-ready platform.

This phase focuses on:

- TypeScript SDK,
- CLI,
- minimal dashboard,
- developer onboarding,
- public API ergonomics,
- integration polish,
- systematic load testing,
- systematic failure testing,
- security review,
- performance profiling,
- query/index review,
- capacity characterization,
- operational runbooks,
- documentation,
- architecture diagrams,
- final demo scenarios,
- release/versioning,
- final refactoring,
- resume/project presentation.

No major architectural feature should enter v1 during this phase.

---

# 1. Phase Goal

At the end of Phase 8, a new developer should be able to:

```text
install SDK / CLI
      ↓
create/configure agent
      ↓
start a run
      ↓
watch events
      ↓
inspect result
      ↓
cancel when needed
```

without understanding Helmrun's internal architecture.

At the same time, an engineer reviewing the repository should be able to understand:

```text
architecture
execution flow
failure model
deployment
testing strategy
tradeoffs
```

without reverse-engineering the codebase.

---

# 2. Estimated Duration

Recommended:

```text
3 weeks
```

Approximate effort:

```text
50–65 hours
```

Suggested split:

| Area | Approx. hours |
|---|---:|
| TypeScript SDK | 8–10 h |
| CLI | 6–8 h |
| Minimal dashboard | 7–9 h |
| Load/performance testing | 8–10 h |
| Failure/chaos regression | 6–8 h |
| Security/final review | 4–6 h |
| Documentation/demo/release | 8–10 h |
| Refactoring/buffer | 4–6 h |

---

# 3. Core Rule for Phase 8

The most important rule:

> **Stop adding major features.**

Phase 8 is not the time to add:

- Kafka,
- Kubernetes,
- gRPC,
- vector search,
- RAG,
- billing,
- multi-region,
- agent workflow DAGs,
- multi-agent systems,
- GPU scheduling.

If a feature is not necessary to make existing Helmrun capabilities usable, reliable, measurable, or understandable, it should probably wait.

---

# 4. Frozen vs Conceptual

## Frozen direction

Phase 8 should deliver:

- TypeScript SDK,
- CLI,
- minimal web dashboard,
- stable v1 API surface,
- final integration tests,
- load testing,
- failure regression suite,
- security review,
- final architecture documentation,
- deployment documentation,
- runbooks,
- demo environment,
- release/versioning process.

## Conceptual / flexible

The following remain flexible:

- exact SDK method names,
- exact CLI syntax,
- exact dashboard layout,
- exact load targets,
- exact release version,
- exact documentation site format,
- exact benchmark numbers,
- exact demo workload.

These should reflect the actual system rather than forcing arbitrary targets.

---

# 5. What Phase 8 Should Feel Like

Before Phase 8:

```text
powerful system
but engineer-operated
```

After Phase 8:

```text
powerful system
+
developer-friendly interface
+
measured reliability
+
clear documentation
+
credible demo
```

---

# 6. Developer Experience Surfaces

Helmrun v1 should have four primary interfaces:

```text
REST API
TypeScript SDK
CLI
Minimal Dashboard
```

Priority:

```text
REST API
   ↓
SDK
   ↓
CLI
   ↓
Dashboard
```

The dashboard is secondary.

Helmrun remains an infrastructure/developer platform, not a frontend-heavy product.

---

# 7. Theory Module A — SDK Design

Study:

- API client design,
- retries,
- timeouts,
- pagination,
- streaming,
- typed errors,
- resource clients,
- versioning,
- authentication configuration.

A good SDK should hide HTTP details without hiding Helmrun semantics.

---

# 8. SDK Principle

Bad:

```ts
client.request("POST", "/v1/runs", body);
```

Better:

```ts
const run = await helmrun.runs.create({
  agentId,
  version,
  input,
});
```

The SDK should expose product concepts.

---

# 9. SDK Structure

Conceptually:

```text
packages/sdk/
├── client.ts
├── agents.ts
├── runs.ts
├── api-keys.ts
├── errors.ts
├── streaming.ts
└── types.ts
```

Exact structure is flexible.

---

# 10. SDK Initialization

Example:

```ts
import { Helmrun } from "@helmrun/sdk";

const helmrun = new Helmrun({
  apiKey: process.env.HELMRUN_API_KEY!,
  baseUrl: "https://api.example.com",
});
```

Defaults should be sensible.

---

# 11. SDK Agent APIs

Conceptually:

```ts
await helmrun.agents.create(...);
await helmrun.agents.get(...);
await helmrun.agents.list(...);
await helmrun.agents.createVersion(...);
```

The SDK should preserve server-side semantics rather than inventing alternate abstractions.

---

# 12. SDK Run APIs

Conceptually:

```ts
const run = await helmrun.runs.create(...);

const current = await helmrun.runs.get(run.id);

await helmrun.runs.cancel(run.id);
```

---

# 13. SDK Streaming

High-value interface:

```ts
for await (const event of helmrun.runs.stream(run.id)) {
  console.log(event);
}
```

SDK should handle:

- SSE parsing,
- reconnect,
- terminal event,
- authorization errors,
- connection cleanup.

---

# 14. SDK Error Model

Map API errors into typed SDK errors.

Conceptually:

```text
AuthenticationError
AuthorizationError
ValidationError
RateLimitError
NotFoundError
RunFailedError
NetworkError
```

Do not expose raw Axios/fetch error structures as the public API.

---

# 15. SDK Timeout and Retry

Retry should be conservative.

Potentially safe:

```text
GET
some idempotent operations
```

Careful with:

```text
POST /runs
```

unless an idempotency key is attached.

The SDK should reuse Helmrun's idempotency mechanisms.

---

# 16. SDK Idempotency

For run creation:

```ts
await helmrun.runs.create(input, {
  idempotencyKey: crypto.randomUUID(),
});
```

or SDK-generated idempotency where safe.

Do not create silent duplicate runs because of network retry.

---

# 17. SDK Pagination

Provide ergonomic pagination.

Conceptually:

```ts
for await (const run of helmrun.runs.listAll()) {
  ...
}
```

or explicit page API.

Do not hide large data retrieval costs unintentionally.

---

# 18. SDK Type Safety

SDK should export:

- request types,
- response types,
- event types,
- error types.

Where possible, derive types from shared API contracts without tightly coupling server internals.

---

# 19. SDK Package Quality

Final SDK should include:

- README,
- examples,
- semantic version,
- build,
- type declarations,
- tests.

Publishing to npm is optional but useful if namespace is available.

---

# 20. Theory Module B — CLI Design

CLI should optimize common developer workflows.

Commands should be predictable and composable.

Avoid building a giant interactive TUI.

---

# 21. CLI Core Commands

Potential commands:

```text
helmrun auth login
helmrun agents create
helmrun agents list
helmrun agents get
helmrun agents deploy
helmrun runs create
helmrun runs list
helmrun runs get
helmrun runs logs
helmrun runs watch
helmrun runs cancel
```

Exact syntax can be refined.

---

# 22. Commander.js

Use Commander.js for:

- command hierarchy,
- flags,
- help,
- validation,
- version command.

Do not build CLI parsing from scratch.

---

# 23. CLI Configuration

Store only appropriate local configuration.

Example:

```text
~/.config/helmrun/config.json
```

Potential fields:

```text
baseUrl
active profile
```

Be careful with API keys.

Prefer OS-level secure storage if practical, or document file permissions.

For v1, simple secure-enough storage with warnings is acceptable.

---

# 24. CLI Profiles

Useful:

```text
local
dev
production-like
```

Commands:

```text
helmrun config use dev
```

This is optional but useful.

---

# 25. CLI Output Modes

Human:

```text
helmrun runs list
```

Machine-readable:

```text
helmrun runs list --json
```

This improves scripting.

---

# 26. CLI Run Watch

One of the strongest commands:

```text
helmrun runs watch run_123
```

Output:

```text
[12:30:02] run started
[12:30:03] model call started
[12:30:05] tool search started
[12:30:06] tool search completed
[12:30:08] checkpoint created
[12:30:10] run completed
```

This uses SSE.

---

# 27. CLI Error UX

Bad:

```text
Request failed with status code 403
```

Better:

```text
Authorization failed:
API key does not have access to this run.
```

CLI should preserve technical detail when useful without dumping internals.

---

# 28. Theory Module C — Minimal Dashboard

Dashboard is for:

- demonstrating Helmrun,
- viewing runs,
- viewing agents,
- showing runtime history,
- showing system health.

It is not the main project.

---

# 29. Dashboard Scope

Recommended pages:

```text
Overview
Agents
Runs
Run Detail
System Health
```

No need for:

- drag-and-drop workflow builder,
- visual agent editor,
- billing portal,
- enterprise admin console.

---

# 30. Dashboard — Overview

Show:

```text
queued runs
active runs
completed runs
failed runs
active workers
queue backlog
```

Small operational summary.

---

# 31. Dashboard — Agents

Show:

```text
agent
latest version
provider/model
allowed tools
created at
```

Allow basic creation/versioning if useful.

---

# 32. Dashboard — Runs

Show:

```text
run ID
agent
version
status
attempts
duration
created time
```

Filters can remain simple.

---

# 33. Dashboard — Run Detail

Most important page.

Show:

```text
status
input metadata
agent version
attempt history
worker
sandbox
timeline
model calls
tool calls
checkpoints
recovery events
result
failure
usage
```

Do not expose secrets.

---

# 34. Live Run Timeline

Use Phase 6 SSE.

Example:

```text
12:30:01 Run queued
12:30:02 Dispatched
12:30:03 Worker claimed
12:30:04 Sandbox started
12:30:05 Model call
12:30:08 Tool: search
12:30:10 Checkpoint
12:30:12 Completed
```

This is an excellent demo surface.

---

# 35. Dashboard — System Health

Show a simplified view of:

```text
API
scheduler
workers
queue
database
Redis
```

Detailed Grafana remains the operator interface.

Do not reproduce Grafana.

---

# 36. Dashboard Auth

Reuse Helmrun auth semantics.

For a portfolio v1, dashboard can use a developer API key/session bridge.

Do not build a large consumer login system.

---

# 37. Phase 8 Principle — Stable API Surface

Before finalizing SDK/CLI, review REST API consistency.

Check:

- naming,
- pagination,
- errors,
- versioning,
- idempotency,
- resource shapes,
- status codes.

Make breaking cleanup changes now rather than after SDK release.

---

# 38. API Consistency Audit

Review endpoints:

```text
agents
agent versions
runs
run cancellation
run events
API keys
```

Questions:

- Are IDs named consistently?
- Are timestamps ISO 8601?
- Are errors consistent?
- Do list endpoints paginate consistently?
- Are async operations clearly represented?
- Are status transitions understandable?

---

# 39. OpenAPI Finalization

OpenAPI should be close to release quality.

Include:

- schemas,
- examples,
- error responses,
- authentication,
- idempotency header,
- SSE endpoint documentation,
- pagination.

Generated docs should match actual behavior.

---

# 40. Theory Module D — Load Testing

Load testing should answer:

```text
Where does Helmrun saturate?
How does it degrade?
What is the bottleneck?
```

not:

```text
Can I claim 100k RPS?
```

---

# 41. Load-Test Layers

Test separately:

```text
API
scheduler
queue
workers
sandbox startup
SSE
full end-to-end
```

This isolates bottlenecks.

---

# 42. API Load Test

Use k6.

Scenarios:

```text
GET agents
GET runs
POST runs
```

Measure:

```text
throughput
p50
p95
p99
error rate
DB pool
CPU
memory
```

---

# 43. Run-Creation Load Test

Example progression:

```text
10 req/s
25 req/s
50 req/s
100 req/s
```

Numbers depend on deployed resource size.

Find:

```text
stable region
degradation point
failure behavior
```

---

# 44. Queue Backlog Test

Submit faster than worker throughput.

Observe:

```text
queue depth
oldest message age
worker utilization
run latency
```

Expected:

- API remains responsive,
- workers remain bounded,
- queue absorbs pressure,
- no memory explosion.

---

# 45. Worker Throughput Test

Use deterministic fake provider/tool workload.

Measure:

```text
runs/min
sandbox startup overhead
active slots
CPU
memory
DB pool
```

---

# 46. Real LLM Tests

Do not use live expensive providers for high-volume load testing.

Use:

```text
fake provider
local deterministic provider simulator
```

for platform load.

Use small real-provider tests only for integration validation.

---

# 47. Sandbox Startup Benchmark

Measure:

```text
container creation
runtime handshake
total sandbox startup
```

This may be a major component of short-run latency.

---

# 48. SSE Load Test

Test:

```text
100
500
1000
```

or resource-appropriate concurrent streams.

Measure:

```text
memory
event-loop lag
event-delivery latency
disconnects
```

---

# 49. Recovery Load Test

Create many active fake runs.

Terminate workers.

Observe:

```text
lease expiry rate
recovery scan
requeue
checkpoint restore
worker capacity
DB load
```

This validates Phase 4 under scale.

---

# 50. Database Performance Review

Review real query metrics.

Use:

```text
EXPLAIN ANALYZE
```

on:

- run lists,
- scheduler queries,
- expired lease scans,
- latest checkpoint lookup,
- agent/version lookup.

Add or remove indexes based on evidence.

---

# 51. Index Audit

For every important index ask:

```text
Which query uses it?
Does EXPLAIN prove it?
What write cost does it add?
```

Remove obviously unused speculative indexes if practical.

---

# 52. Connection Pool Review

Measure:

```text
API pool waiting
scheduler pool
worker pool
total RDS connections
```

Tune pool sizes based on deployed concurrency.

Do not blindly increase pool sizes.

---

# 53. Redis Review

Measure:

- cache hit rate,
- latency,
- Pub/Sub load,
- rate-limit usage.

Ask:

```text
Is each Redis feature justified?
```

Remove accidental caching if it adds complexity without benefit.

---

# 54. SQS Review

Measure:

```text
queue wait
receive count
DLQ count
message age
duplicate-delivery behavior
```

Tune:

- visibility timeout,
- long-poll settings,
- receive batch,
- retry policy.

---

# 55. Worker Concurrency Review

Test concurrency values.

Example:

```text
2
4
8
16
```

Measure:

- throughput,
- memory,
- DB pressure,
- sandbox capacity.

Choose a defensible default.

---

# 56. Resource-Class Review

Validate sandbox resource tiers.

Example:

```text
small
medium
large
```

If v1 only needs one or two classes, keep it simple.

Do not create fake product tiers just for complexity.

---

# 57. Theory Module E — Failure Regression

Every major failure case from previous phases should now become a repeatable regression scenario.

Helmrun's strongest quality signal is not feature count.

It is:

> The same failure scenarios continue to behave correctly after all phases are integrated.

---

# 58. Failure Regression Matrix

At minimum include:

| Failure | Expected behavior |
|---|---|
| API process dies | ALB reroutes/reconnect |
| Scheduler dies | dispatch resumes later |
| Worker dies | lease expires + recovery |
| Worker freezes | fencing prevents stale writes |
| Redis dies | degraded cache/events |
| PostgreSQL unavailable | authoritative work pauses safely |
| SQS send fails | run remains dispatchable |
| S3 checkpoint fails | no false checkpoint |
| Provider times out | bounded retry/failure |
| Tool hangs | timeout |
| Sandbox OOM | isolated failure |
| Sandbox hangs | killed by timeout |
| SSE disconnect | run continues |
| Telemetry backend fails | execution continues |

---

# 59. Automated Failure Suite

Where possible create scripts/tests that can intentionally:

```text
kill worker
pause worker
stop Redis
delay DB
duplicate SQS
corrupt checkpoint
kill sandbox
trigger OOM
disconnect SSE
```

Not every chaos test needs to run in normal PR CI.

Some can be:

```text
scheduled/manual regression suite
```

---

# 60. Final Concurrency Tests

Re-run critical invariants:

```text
many workers claim one run
many schedulers dispatch
cancel vs complete
cancel vs recover
complete vs lease expiry
stale worker vs new owner
duplicate SQS messages
concurrent agent version creation
```

These are more important than high unit-test percentages.

---

# 61. Final Security Review

Review:

- auth,
- tenant isolation,
- API keys,
- secrets,
- IAM,
- sandbox isolation,
- SSRF,
- Docker socket,
- metadata service,
- logs/telemetry,
- tool permissions,
- rate limiting,
- input size limits.

---

# 62. Security Review — API Keys

Verify:

- plaintext never stored,
- revoked keys fail,
- keys never logged,
- tenant context correct,
- rotation documented.

---

# 63. Security Review — Tenant Isolation

Repeat cross-tenant tests for:

- agent,
- version,
- run,
- SSE,
- artifact,
- checkpoint metadata,
- secrets.

---

# 64. Security Review — Sandbox

Verify:

- non-root,
- no privileged mode,
- no host network,
- no Docker socket,
- no host filesystem,
- PID/memory/CPU limits,
- metadata service unavailable.

---

# 65. Security Review — Secrets

Search repository/logs/test artifacts for fake known secrets.

Verify no leakage into:

- logs,
- traces,
- SSE,
- errors,
- SQS,
- checkpoint payload unintentionally.

---

# 66. Security Review — Dependency Audit

Run ecosystem tooling for known dependency vulnerabilities.

Do not chase every low-risk advisory blindly.

Classify based on actual exposure.

---

# 67. Performance Profiling

Profile only where metrics show a bottleneck.

Potential targets:

- API CPU,
- JSON serialization,
- scheduler query,
- worker DB queries,
- checkpoint serialization,
- sandbox startup.

Do not prematurely optimize random code.

---

# 68. Node Event-Loop Review

Watch:

```text
event loop lag
heap
GC
```

especially under:

- SSE load,
- many worker events,
- high API concurrency.

If blocking code appears, fix the actual hotspot.

---

# 69. Memory-Leak Test

Run a prolonged synthetic workload.

Observe:

```text
API memory
worker memory
SSE subscriptions
Redis listeners
container cleanup
```

Memory should stabilize.

---

# 70. Orphan Resource Audit

After load/failure suite, verify no accumulation of:

```text
orphan Docker containers
stale temp files
stale leases
stuck RUNNING runs
unused Redis subscriptions
dangling checkpoint metadata
```

---

# 71. Data Retention Review

Define retention for:

```text
runs
events
logs
checkpoints
artifacts
```

Do not implement elaborate archival if unnecessary.

Document current policy.

---

# 72. SDK Testing

Test:

- auth,
- agent CRUD,
- version creation,
- run creation,
- idempotency,
- run get/list,
- cancellation,
- streaming,
- reconnect,
- typed errors,
- pagination.

---

# 73. CLI Testing

Test:

- config/profile,
- auth,
- agent commands,
- run commands,
- JSON output,
- streaming,
- failure messages,
- exit codes.

---

# 74. CLI Exit Codes

Scripts should be able to distinguish:

```text
success
usage error
authentication failure
run failure
network failure
```

Exact mapping can remain small.

---

# 75. Dashboard Testing

Test:

- tenant isolation,
- live timeline,
- run terminal state,
- reconnect,
- failure display,
- large event volume,
- no secret exposure.

---

# 76. Theory Module F — Documentation Architecture

Final docs should answer three audiences:

```text
developer using Helmrun
engineer studying Helmrun
operator deploying Helmrun
```

Do not mix everything into one giant README.

---

# 77. Root README

README should contain:

- what Helmrun is,
- architecture snapshot,
- key features,
- quick start,
- basic example,
- major technologies,
- links to deeper docs,
- demo screenshots/diagram if available.

---

# 78. README Opening

A concise positioning line:

> Helmrun is a distributed agent execution platform for running AI agents with durable state, isolated runtimes, crash recovery, multi-provider LLM support, tool execution, and production-oriented observability.

Then quickly show:

```text
API → Scheduler → SQS → Workers → Sandboxes
```

---

# 79. Architecture Documentation

Keep final architecture docs aligned with actual implementation.

Must cover:

```text
control plane
execution plane
data plane
scheduling
durable execution
sandboxing
observability
AWS deployment
```

---

# 80. ADR Review

Useful final ADRs may include:

- modular monolith vs microservices,
- SQS vs BullMQ,
- Postgres as source of truth,
- immutable agent versions,
- leases/fencing,
- Docker sandbox choice,
- SSE vs WebSockets,
- dedicated EC2 worker hosts,
- Terraform deployment.

Do not create ADRs for trivial choices.

---

# 81. Failure Model Documentation

This is one of Helmrun's strongest differentiators.

Document:

```text
what happens if:
worker dies
Redis dies
DB dies
SQS duplicates
tool times out
LLM times out
checkpoint fails
sandbox OOMs
```

This shows engineering maturity.

---

# 82. Run Lifecycle Documentation

Document state machine and attempt lifecycle as actually implemented.

Include diagrams.

Do not leave conceptual Phase 1/2 states if implementation evolved.

---

# 83. Local Development Guide

A new contributor should be able to:

```text
clone
install
start dependencies
run migrations
start API
start scheduler
start workers
submit test run
```

without guessing.

---

# 84. AWS Deployment Guide

Document:

```text
prerequisites
Terraform
GitHub OIDC
secrets
deployment
rollback
destroy/dev cleanup
```

Do not expose real credentials.

---

# 85. Operational Runbooks

Create concise runbooks for:

```text
queue backlog
worker fleet down
database unavailable
Redis unavailable
failed deployment
checkpoint failures
DLQ messages
```

Each runbook should answer:

```text
symptoms
how to verify
likely causes
safe actions
```

---

# 86. Theory Module G — Release Management

Create a v1 release process.

Use semantic versioning conceptually:

```text
0.x during development
1.0.0 for first frozen public v1
```

Exact version is flexible.

---

# 87. Release Checklist

Before release:

```text
tests pass
failure suite pass
security review complete
docs current
OpenAPI current
Terraform plan clean
deployment tested
rollback tested
demo tested
```

---

# 88. Changelog

Maintain a concise changelog/release notes.

Not essential during every early commit, but useful by final release.

---

# 89. Final Repository Cleanup

Remove:

- dead code,
- abandoned experiments,
- unused dependencies,
- outdated docs,
- debug logs,
- commented-out blocks,
- stale env variables.

Do not aggressively refactor working code merely for aesthetics.

---

# 90. Dependency Audit

For every major dependency ask:

```text
Do we still use it?
Why is it here?
```

Remove obsolete packages.

---

# 91. Configuration Audit

Review all environment variables.

Group/document them.

Remove stale config.

Provide:

```text
.env.example
```

with no secrets.

---

# 92. Error-Code Audit

Review domain/API error codes.

Ensure:

- names consistent,
- user-facing messages useful,
- internal details not leaked,
- SDK mapping complete.

---

# 93. Log Audit

Review representative logs from a full run.

Ask:

```text
Can I understand what happened?
Is important context missing?
Is there too much noise?
Are secrets absent?
```

---

# 94. Metric Audit

Review Prometheus metrics.

Remove:

- unused,
- redundant,
- high-cardinality metrics.

Keep those that drive:

- dashboards,
- debugging,
- capacity,
- reliability.

---

# 95. Trace Audit

Review full traces.

Ensure spans represent meaningful boundaries.

Avoid tracing every tiny helper function.

---

# 96. Dashboard Audit

Every panel should answer a question.

If no one knows why a panel exists:

```text
remove it
```

---

# 97. Final Code-Quality Standard

By the end of Phase 8, Helmrun should have:

- strict TypeScript,
- clear module boundaries,
- explicit SQL,
- parameterized queries,
- validated config,
- domain errors,
- structured logs,
- migrations,
- risk-based tests,
- documented invariants,
- secure defaults,
- graceful shutdown,
- reproducible deployment.

---

# 98. What We Do Not Require

We do not require:

```text
100% unit-test coverage
zero abstractions changed during development
enterprise bureaucracy
perfect benchmarks
internet-scale capacity
formal verification
```

The goal is credible engineering quality.

---

# 99. Test Pyramid for Final v1

Conceptually:

```text
Many focused unit tests
      ↓
Strong integration tests
      ↓
Targeted concurrency/failure tests
      ↓
A few end-to-end cloud tests
```

Do not put everything into slow E2E tests.

---

# 100. Final Test Suites

A useful organization:

```text
tests/
├── unit/
├── integration/
├── concurrency/
├── failure/
├── load/
└── e2e/
```

Exact structure is flexible.

---

# 101. Smoke Test

Post-deployment smoke test:

```text
health
 ↓
authenticate
 ↓
create agent
 ↓
create version
 ↓
create simple run
 ↓
wait/stream
 ↓
verify result
```

Use a cheap deterministic/fake provider path if appropriate.

---

# 102. Synthetic Monitoring

Optional:

Run a lightweight periodic synthetic execution.

This can detect:

```text
API works
scheduler works
queue works
worker works
sandbox works
```

Do not build full uptime-monitoring infrastructure if unnecessary.

---

# 103. Final Performance Report

Document measured behavior, not marketing claims.

Example sections:

```text
test environment
workload
API throughput
queue latency
worker throughput
sandbox startup
recovery time
SSE capacity
known bottlenecks
```

Avoid claiming numbers without context.

---

# 104. Capacity Envelope

Document something like:

```text
On deployment profile X:
- API remained stable up to ...
- worker host handled ...
- recovery of ... runs completed in ...
```

Exact numbers come from tests.

---

# 105. Known Limitations

This is important.

Document limitations such as:

- single AWS region,
- Docker rather than microVM isolation,
- no Kubernetes,
- no global scheduler,
- no arbitrary exactly-once side-effect guarantee,
- no advanced billing,
- no workflow DAG engine.

A good engineering project states its boundaries.

---

# 106. Resume-Facing Architecture Summary

A concise internal summary should support resume bullets like:

```text
Built a distributed agent execution platform with SQS-backed scheduling,
durable execution using leases/checkpoints, Docker-isolated runtimes,
multi-provider LLM/tool execution, AWS/Terraform deployment, and
OpenTelemetry-based observability.
```

Do not inflate claims beyond what is actually implemented.

---

# 107. Demo Strategy

Prepare 3 demos.

## Demo A — Normal Run

```text
submit
 ↓
queue
 ↓
worker
 ↓
sandbox
 ↓
model/tool
 ↓
complete
```

## Demo B — Worker Crash Recovery

```text
kill worker
 ↓
lease expires
 ↓
checkpoint recovery
 ↓
new worker
 ↓
complete
```

## Demo C — Resource Isolation

```text
bad sandbox workload
 ↓
OOM/timeout
 ↓
worker survives
 ↓
other runs continue
```

These three demos show more engineering value than a fancy dashboard.

---

# 108. Demo Observability

During demos, show:

```text
CLI/SSE timeline
+
Grafana
+
trace
+
logs
```

This makes the distributed behavior visible.

---

# 109. Final Architecture Diagram

Update the architecture diagram to match the deployed system.

Include:

```text
Developer interfaces
ALB/API
Postgres
Redis
Scheduler
SQS
Worker ASG
Docker sandboxes
LLM providers
MCP/tools
S3
Secrets Manager
Observability
Terraform/CI/CD
```

---

# 110. Final Data-Flow Diagram

Document:

```text
agent creation
run creation
dispatch
claim
sandbox
model/tool loop
checkpoint
completion
recovery
SSE
```

This is useful for interviews.

---

# 111. Final Failure-Flow Diagram

Show:

```text
worker dies
 ↓
heartbeat stops
 ↓
lease expires
 ↓
recovery
 ↓
new attempt
 ↓
checkpoint restore
```

This is one of the strongest interview discussion points.

---

# 112. Interview Preparation Notes

Create internal notes for yourself:

```text
Why SQS?
Why not Kafka?
Why modular monolith?
Why leases?
Why fencing token?
Why checkpoint?
Why SSE?
Why Docker?
Why EC2 workers?
Why Postgres source of truth?
Why Redis not source of truth?
```

The project becomes much more valuable if you can defend the decisions.

---

# 113. Phase 0–7 Living Infrastructure Updates

## Database

- final index/query review,
- migration cleanup,
- retention policy,
- production-safe migration docs.

## Configuration

- remove stale variables,
- document all production config,
- validate final defaults.

## Logging

- noise reduction,
- final context consistency,
- secret audit.

## Error model

- normalize public/internal errors,
- SDK/CLI mappings.

## Tests

- complete regression suites,
- load tests,
- failure tests,
- cloud E2E tests.

## CI

- release workflow,
- smoke tests,
- artifact/image versioning.

## Docker/local development

- simplify onboarding,
- validate one-command-ish startup where practical.

## Health/readiness

- verify actual production behavior.

## OpenAPI

- freeze/document v1 API.

## Documentation

- consolidate and update all architecture/runbooks.

## Shared packages

- remove accidental coupling and unused abstractions.

## Graceful shutdown

- regression test across API/scheduler/worker/SSE/sandbox.

## Failure testing

- convert major scenarios into repeatable final regression suite.

---

# 114. Suggested Week 1

Focus:

```text
SDK
CLI
API consistency review
OpenAPI cleanup
```

Target:

> Helmrun feels usable as a developer platform.

---

# 115. Suggested Week 2

Focus:

```text
minimal dashboard
load testing
query/index review
worker capacity tuning
SSE testing
```

Target:

> Helmrun has measured performance and a clear developer-facing interface.

---

# 116. Suggested Week 3

Focus:

```text
failure regression
security audit
documentation
runbooks
architecture diagrams
release
demo
resume polish
```

Target:

> Helmrun v1 is finished, documented, deployable, and demonstrable.

---

# 117. Final End-to-End Acceptance Test

A full acceptance test should:

```text
1. Authenticate.
2. Create agent.
3. Create immutable version.
4. Start run.
5. Observe SSE.
6. Scheduler dispatches.
7. Worker claims.
8. Sandbox starts.
9. Model/tool loop runs.
10. Checkpoint written.
11. Result completes.
12. SDK retrieves result.
13. CLI displays execution timeline.
14. Dashboard shows run.
15. Grafana/trace/logs correlate execution.
```

---

# 118. Final Recovery Acceptance Test

```text
1. Start long fake run.
2. Produce checkpoint.
3. Kill worker host/process.
4. Verify heartbeat stops.
5. Verify lease expires.
6. Verify stale owner fenced.
7. Verify new attempt created.
8. Verify checkpoint restored.
9. Verify run completes.
10. Verify telemetry shows recovery.
```

---

# 119. Final Isolation Acceptance Test

```text
1. Start memory-abusive run.
2. Sandbox exceeds memory.
3. Sandbox is OOM-killed.
4. Worker remains healthy.
5. Other runs continue.
6. Run receives controlled failure.
7. Sandbox cleanup succeeds.
```

---

# 120. Final Tenant-Isolation Acceptance Test

Create:

```text
Tenant A
Tenant B
```

Verify Tenant A cannot access Tenant B:

- agents,
- versions,
- runs,
- SSE,
- artifacts,
- secret references.

---

# 121. Final Deployment Acceptance Test

```text
git push
 ↓
CI
 ↓
tests
 ↓
image build
 ↓
ECR
 ↓
migration
 ↓
deployment
 ↓
smoke test
```

Then perform rollback.

---

# 122. Final Load Acceptance Test

Choose a documented workload and run it repeatedly.

Pass criteria should be based on:

- stable latency,
- bounded error rate,
- bounded memory,
- no stuck runs,
- no orphan sandboxes,
- no DB pool collapse,
- queue drains successfully.

Do not invent arbitrary internet-scale numbers.

---

# 123. Release Checklist

Before calling v1 complete:

## Product

- [ ] REST API stable.
- [ ] SDK usable.
- [ ] CLI usable.
- [ ] dashboard usable.
- [ ] SSE works.
- [ ] documentation coherent.

## Reliability

- [ ] duplicate message handling tested.
- [ ] worker crash recovery tested.
- [ ] stale worker fencing tested.
- [ ] checkpoint restore tested.
- [ ] Redis outage tested.
- [ ] DB outage behavior tested.
- [ ] sandbox OOM/timeout tested.
- [ ] deployment rollback tested.

## Security

- [ ] tenant isolation tested.
- [ ] API-key handling reviewed.
- [ ] secrets audit complete.
- [ ] IAM reviewed.
- [ ] sandbox privileges reviewed.
- [ ] metadata-service protection tested.
- [ ] SSRF/tool-policy checks reviewed.

## Performance

- [ ] API load test complete.
- [ ] queue backlog test complete.
- [ ] worker throughput test complete.
- [ ] SSE load test complete.
- [ ] DB/index review complete.
- [ ] connection pool review complete.

## Operations

- [ ] dashboards useful.
- [ ] alarms useful.
- [ ] runbooks available.
- [ ] architecture diagram current.
- [ ] cloud deployment reproducible.

## Repository

- [ ] no stale experimental code.
- [ ] no committed secrets.
- [ ] dependency audit complete.
- [ ] `.env.example` current.
- [ ] README current.
- [ ] license chosen if public.
- [ ] release tag created.

---

# 124. Explicitly Out of Scope

Do not add during Phase 8:

- Kubernetes,
- EKS,
- Helm,
- Kafka,
- gRPC,
- service mesh,
- multi-region,
- vector database,
- RAG subsystem,
- workflow DAG engine,
- multi-agent orchestration,
- self-hosted inference,
- GPU scheduling,
- advanced billing,
- enterprise SSO,
- custom observability backend,
- Firecracker/microVMs,
- complex plugin marketplace.

These can become future versions or separate projects.

---

# 125. Post-v1 Backlog

After v1 is frozen, possible extensions include:

```text
Kubernetes / EKS
Helm charts
worker scheduling on Kubernetes
more advanced autoscaling
Python SDK
additional tool integrations
advanced billing/usage controls
multi-region research
```

These are not part of v1 completion criteria.

---

# 126. Things We Should Resist

Do not turn final polish into endless refactoring.

Avoid:

```text
rewrite everything
change frameworks
replace Postgres
replace SQS
introduce microservices
redesign entire API
```

unless a demonstrated correctness issue requires it.

Phase 8 is about **finishing**.

---

# 127. Core Phase 8 Invariants

### Invariant 1 — No major feature creep

v1 scope is frozen.

### Invariant 2 — DX wraps real capabilities

SDK/CLI/dashboard do not invent alternate semantics.

### Invariant 3 — Benchmarks are contextual

Performance numbers always include environment/workload.

### Invariant 4 — Failure regressions matter more than coverage vanity

Critical distributed invariants stay tested.

### Invariant 5 — Documentation matches implementation

No stale conceptual diagrams presented as current reality.

### Invariant 6 — Security is reviewed end-to-end

Not only individual modules.

### Invariant 7 — Demoability does not compromise architecture

Do not bypass queue/sandbox/recovery just to make demos easier.

### Invariant 8 — v1 is allowed to have documented limitations

A bounded, finished system is better than an unfinished "everything platform."

---

# 128. Definition of Done

Phase 8 is successful when:

> Helmrun can be used through a stable API, TypeScript SDK, CLI, and minimal dashboard; its distributed execution behavior has been systematically load-tested and failure-tested; its database, queue, worker, sandbox, streaming, observability, AWS, and security configurations have been reviewed and tuned using evidence; its deployment and rollback paths are repeatable; its architecture, failure model, runbooks, and limitations are documented; and the complete system can be demonstrated clearly through normal execution, crash recovery, and resource-isolation scenarios.

At that point, Helmrun v1 should be considered **complete**.

The project should then move from:

```text
building mode
```

to:

```text
maintenance
interview preparation
post-v1 extensions only when intentionally chosen
```
