# Helmrun Phase 6 — Streaming, Observability & Operability

## Phase Status

Phase 6 makes Helmrun understandable while it is running.

By the end of Phase 5, Helmrun has:

- a modular control plane,
- a custom agent runtime,
- SQS-based distributed execution,
- workers and schedulers,
- durable leases and heartbeats,
- checkpoint-based crash recovery,
- stale-worker fencing,
- Docker sandbox isolation,
- resource limits,
- scoped secrets,
- controlled tool execution.

The next problem is operational visibility.

Without strong observability, a run may fail somewhere inside:

```text
API
 ↓
PostgreSQL
 ↓
Scheduler
 ↓
SQS
 ↓
Worker
 ↓
Sandbox
 ↓
Agent Runtime
 ↓
LLM / MCP / Tool
```

and the developer or operator may have no idea:

```text
where it failed
why it failed
how long each stage took
whether it is stuck
whether it was retried
which worker owned it
whether recovery happened
```

Phase 6 introduces:

- live run-event streaming with SSE,
- Redis Pub/Sub for internal ephemeral event fan-out,
- a normalized execution-event model,
- structured logging with Pino,
- OpenTelemetry instrumentation,
- distributed traces,
- Prometheus metrics,
- Grafana dashboards,
- correlation IDs,
- queue latency metrics,
- worker/sandbox/runtime metrics,
- recovery/checkpoint metrics,
- reconnect semantics,
- observability failure testing,
- basic operational diagnostics.

The goal is:

> **A developer should be able to watch a run live, while an operator should be able to trace that same run across the complete distributed execution path and diagnose failures without guessing.**

---

# 1. Phase Goal

At the end of Phase 6, Helmrun should support:

```text
Developer
   │
   │ GET /v1/runs/:runId/events
   ▼
SSE Connection
   │
   ▼
run.created
run.queued
run.dispatched
run.started
model.call.started
tool.call.started
tool.call.completed
checkpoint.created
run.recovered
run.completed
```

At the same time, operators should be able to inspect:

```text
Logs
Metrics
Traces
Dashboards
```

for the same run.

The full observability path becomes:

```text
API ─────────┐
Scheduler ───┤
Worker ──────┼──→ OpenTelemetry
Sandbox ─────┤
Runtime ─────┤
Tools ───────┘
                 │
        ┌────────┼────────┐
        ▼        ▼        ▼
      Logs     Metrics   Traces
      Pino    Prometheus   OTel
                 │
                 ▼
              Grafana
```

---

# 2. Estimated Duration

Recommended:

```text
2 to 2.5 weeks
```

Approximate effort:

```text
40–55 hours
```

Suggested split:

| Area | Approx. hours |
|---|---:|
| SSE/event-streaming theory | 4–6 h |
| Event model + internal fan-out | 6–8 h |
| SSE implementation/reconnect | 6–8 h |
| OpenTelemetry instrumentation | 8–10 h |
| Prometheus metrics | 5–7 h |
| Grafana dashboards | 4–6 h |
| Failure/load testing | 5–7 h |
| Documentation/refactoring | 3–4 h |

---

# 3. What Changes from Phase 5

Before Phase 6:

```text
Run executes correctly
```

but visibility is fragmented across:

```text
logs
database rows
worker processes
container output
```

After Phase 6:

```text
Run
 │
 ├── live events → SSE → developer
 │
 ├── logs → structured diagnostics
 │
 ├── metrics → system health
 │
 └── traces → distributed request/execution path
```

---

# 4. Frozen vs Conceptual

## Frozen architectural direction

The following are part of Helmrun v1:

- SSE is the primary client-facing live execution stream.
- Redis Pub/Sub is used for ephemeral internal event fan-out.
- PostgreSQL remains authoritative for durable run state.
- Redis Pub/Sub is not treated as a durable event log.
- Pino remains the structured application logger.
- OpenTelemetry is used for distributed tracing/instrumentation.
- Prometheus is used for operational metrics.
- Grafana is used for dashboards.
- Run, tenant, worker, attempt, and trace identifiers are correlated across components.
- High-frequency operational information should generally be metrics rather than info-level logs.
- Secrets and sensitive model/tool content must not be exposed through logs or telemetry by default.
- API, scheduler, worker, sandbox/runtime, provider and tool boundaries should be observable.
- Queue wait time and execution latency should be measurable.
- Recovery and checkpoint behavior should be measurable.
- Observability failures must not normally corrupt execution correctness.

## Conceptual / not frozen

The following remain flexible:

- exact SSE event names,
- exact event payload schema,
- exact durable event-replay strategy,
- exact Redis channel names,
- exact OpenTelemetry Collector topology,
- exact trace exporter,
- exact metric names,
- exact histogram buckets,
- exact Grafana dashboard layout,
- exact sampling policy,
- exact log retention policy,
- exact alert thresholds,
- exact tracing backend used locally.

---

# 5. Three Observability Signals

Helmrun should understand the distinct roles of:

```text
Logs
Metrics
Traces
```

They overlap, but they solve different problems.

---

# 6. Logs

Logs answer questions such as:

```text
What happened?
What error occurred?
Which run was involved?
Which worker processed it?
What state transition happened?
```

Example:

```json
{
  "level": "info",
  "msg": "run execution started",
  "runId": "run_123",
  "attemptId": "att_2",
  "workerId": "worker_7",
  "traceId": "..."
}
```

---

# 7. Metrics

Metrics answer:

```text
How often?
How many?
How fast?
How saturated?
```

Examples:

```text
queue depth
active runs
execution latency
provider error rate
lease expirations
sandbox startup duration
SSE connection count
```

---

# 8. Traces

Traces answer:

```text
Where did the time go?
Which distributed component failed?
How did this run flow through the system?
```

Example:

```text
Run Execution Trace

API create run                 18 ms
  ↓
Scheduler dispatch             31 ms
  ↓
Queue wait                    420 ms
  ↓
Worker claim                   11 ms
  ↓
Sandbox startup               610 ms
  ↓
LLM call                     1820 ms
  ↓
Tool call                     540 ms
  ↓
Checkpoint                    120 ms
  ↓
LLM call                     1460 ms
  ↓
Complete                       16 ms
```

---

# 9. Theory Module A — SSE Fundamentals

Understand:

- HTTP long-lived response,
- `Content-Type: text/event-stream`,
- event framing,
- `data:`,
- `event:`,
- `id:`,
- blank-line delimiter,
- reconnect behavior,
- connection lifecycle.

Example:

```text
id: 104
event: tool.completed
data: {"tool":"search","durationMs":812}

```

---

# 10. Theory Module B — SSE vs WebSockets

Helmrun mainly requires:

```text
server → client
```

live execution events.

Commands remain REST:

```text
POST /runs
POST /runs/:id/cancel
```

Events use SSE:

```text
GET /runs/:id/events
```

This keeps the protocol simple.

Do not add WebSockets without a concrete bidirectional requirement.

---

# 11. Theory Module C — SSE Reconnection

Browsers/clients may disconnect.

Understand:

```text
connection lost
   ↓
reconnect
```

Potentially with:

```text
Last-Event-ID
```

Important:

> Redis Pub/Sub cannot replay missed messages.

Therefore reconnect semantics must be explicitly designed.

---

# 12. Reconnect Strategy

Recommended v1 behavior:

```text
client reconnects
   ↓
fetch authoritative current run snapshot
   ↓
resume live event subscription
```

Optionally, Helmrun may persist a limited set of run events for replay.

Do not pretend Pub/Sub gives durable replay.

---

# 13. Theory Module D — Event Ordering

Events for one run should have a useful order.

Possible:

```text
sequence
```

per run.

Example:

```text
101 run.started
102 model.call.started
103 model.call.completed
104 tool.call.started
```

A monotonically increasing logical sequence can simplify clients and reconnect behavior.

Exact implementation is not frozen.

---

# 14. Theory Module E — Pub/Sub

Redis Pub/Sub provides:

```text
publisher
 ↓
channel
 ↓
subscribers
```

Example:

```text
Worker
  ↓ publish
Redis
  ↓
API instance A
API instance B
```

Properties to understand:

- ephemeral,
- no durable replay,
- subscribers must be connected,
- messages may be lost during subscriber disconnect.

Use it for:

```text
live fan-out
```

not durable truth.

---

# 15. Theory Module F — OpenTelemetry

Understand:

- traces,
- spans,
- context propagation,
- attributes,
- events,
- exporters,
- sampling,
- baggage conceptually.

A trace represents a logical operation.

A span represents one component of it.

---

# 16. Theory Module G — Distributed Context Propagation

HTTP automatically supports trace headers through instrumentation.

Queues require explicit propagation.

For SQS:

```text
API / Scheduler
   ↓
trace context in message attributes
   ↓
Worker
   ↓
continue/link trace
```

Exact parent/link strategy should follow OpenTelemetry queue semantics.

---

# 17. Theory Module H — Prometheus

Understand:

- counters,
- gauges,
- histograms,
- labels,
- scraping,
- cardinality.

Examples:

```text
Counter:
helmrun_runs_created_total

Gauge:
helmrun_worker_active_executions

Histogram:
helmrun_run_execution_duration_seconds
```

---

# 18. Theory Module I — Metric Cardinality

Never make labels like:

```text
runId
agentId
user prompt
tool arguments
```

for Prometheus metrics.

That creates high-cardinality time series.

Good labels:

```text
provider
result
failure_category
tool_type
worker_pool
```

---

# 19. Theory Module J — RED and USE Methods

For request-driven services, RED:

```text
Rate
Errors
Duration
```

For resources, USE:

```text
Utilization
Saturation
Errors
```

Apply these ideas to:

- API,
- scheduler,
- workers,
- sandboxes,
- DB pool,
- queue.

---

# 20. Theory Module K — Sampling

Tracing every operation can become expensive.

Understand:

- head sampling,
- tail sampling conceptually,
- error-biased sampling.

For local/dev:

```text
100%
```

may be acceptable.

Production sampling can be lower later.

---

# 21. Implementation Sequence

Recommended:

```text
1. define event model
2. add event emitter abstraction
3. publish worker/runtime events
4. Redis Pub/Sub fan-out
5. SSE endpoint
6. reconnect/current-state behavior
7. structured logging cleanup
8. OpenTelemetry tracing
9. trace propagation through SQS
10. metrics
11. Grafana dashboards
12. failure/load tests
13. docs/refactoring
```

---

# 22. Step 1 — Execution Event Model

Define normalized event types.

Conceptually:

```text
run.created
run.queued
run.dispatched
run.started

model.call.started
model.call.completed
model.call.failed

tool.call.started
tool.call.completed
tool.call.failed

checkpoint.created
run.recovery.started
run.recovery.completed

sandbox.started
sandbox.stopped

run.completed
run.failed
run.cancelled
```

Avoid hundreds of event types.

---

# 23. Event Envelope

Conceptually:

```ts
type RunEvent = {
  id: string;
  runId: string;
  tenantId: string;

  sequence: number;

  type: RunEventType;
  timestamp: string;

  data: unknown;
};
```

Exact structure remains flexible.

---

# 24. Event Data Should Be Safe

Do not automatically include:

- full prompts,
- full model responses,
- secrets,
- authorization headers,
- raw tool credentials,
- large tool output.

Event payloads should be designed intentionally.

---

# 25. Event Categories

Useful conceptual categories:

```text
lifecycle
model
tool
checkpoint
recovery
sandbox
usage
```

Clients can choose which events to render.

---

# 26. Event Sequence

A per-run monotonic sequence is useful.

Example:

```text
run_123:
1
2
3
4
...
```

Possible source:

- PostgreSQL sequence/counter,
- runtime-owned monotonic counter with durable checkpoints,
- event store if implemented.

Exact mechanism should be chosen based on replay requirements.

---

# 27. Durable vs Ephemeral Events

Distinguish:

## Durable facts

Examples:

```text
run status
attempt history
checkpoint metadata
failure state
result
```

stored in PostgreSQL.

## Ephemeral live events

Examples:

```text
model call started
tool progress
temporary runtime progress
```

distributed via Redis Pub/Sub.

Not every event needs durable persistence.

---

# 28. Optional Durable Event History

If developer UX requires reconnect/replay, Helmrun may persist selected events.

Conceptually:

```text
run_events

run_id
sequence
type
payload
created_at
```

But do not persist every low-level log event blindly.

A reasonable v1 approach is:

```text
durable lifecycle events
+
ephemeral fine-grained events
```

This decision remains conceptual until implementation.

---

# 29. Step 2 — Event Publisher Abstraction

Components should publish through a common interface.

Conceptually:

```ts
interface RunEventPublisher {
  publish(event: RunEvent): Promise<void>;
}
```

Runtime code should not directly know Redis channel details.

---

# 30. Event Publishing Must Not Break Execution

For non-critical live events:

```text
Redis publish fails
```

should normally not cause:

```text
run failure
```

Instead:

```text
log/metric failure
continue execution
```

Durable state remains in PostgreSQL.

---

# 31. Critical Events

Some events represent important state changes.

For those:

```text
persist durable state first
then publish event
```

Example:

```text
update run COMPLETED
    ↓
COMMIT
    ↓
publish run.completed
```

Never make Redis publication the authoritative completion record.

---

# 32. Step 3 — Redis Channel Design

Conceptually:

```text
helmrun:run-events:<runId>
```

or a shared channel with run metadata.

Tenant isolation must be preserved at the SSE authorization layer.

Do not trust client-supplied channel names.

---

# 33. Step 4 — SSE Endpoint

Conceptually:

```text
GET /v1/runs/:runId/events
```

Flow:

```text
request
 ↓
authenticate API key
 ↓
authorize tenant ownership
 ↓
load current run state
 ↓
set SSE headers
 ↓
subscribe to run events
 ↓
stream
```

---

# 34. SSE Headers

Typical requirements include:

```text
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Proxy behavior must be tested.

Exact header set depends on infrastructure.

---

# 35. Heartbeat / Keepalive

Idle SSE connections can be closed by proxies.

Send periodic comment frames:

```text
: keepalive

```

Exact interval depends on ALB/proxy timeout later.

---

# 36. Connection Cleanup

When client disconnects:

```text
unsubscribe Redis
clear timers
release resources
```

Do not leak listeners.

---

# 37. SSE Connection Limits

Many open connections consume resources.

Track:

```text
active_sse_connections
```

and test:

```text
100
500
1000
```

connections using lightweight fake runs.

Do not assume long-lived connections are free.

---

# 38. Slow Client Handling

A client may read slowly.

Understand Node response backpressure.

Avoid unlimited in-memory buffering of events.

If a client falls too far behind:

```text
disconnect / force resync
```

may be safer than unbounded buffering.

Exact policy remains flexible.

---

# 39. Reconnect Flow

Recommended conceptual flow:

```text
Client reconnects
    ↓
GET current run snapshot
    ↓
optionally request events after sequence N
    ↓
subscribe live
```

If selected lifecycle events are durable:

```text
replay gap
then live stream
```

Otherwise:

```text
snapshot
then live
```

---

# 40. Step 5 — SDK Streaming

Phase 8 will polish the SDK, but Phase 6 should prove streaming API behavior.

Conceptually:

```ts
for await (const event of client.runs.stream(runId)) {
  console.log(event);
}
```

The SDK wrapper can remain minimal until Phase 8.

---

# 41. Step 6 — Structured Logging Review

Phase 0 introduced Pino.

Phase 6 should standardize context across all components.

Common fields:

```text
service
environment
requestId
traceId
spanId

tenantId
agentId
agentVersionId
runId
attemptId

schedulerId
workerId
sandboxId

provider
model
toolName
failureCategory
```

Not every log includes every field.

---

# 42. Log Levels

Suggested use:

```text
debug
  internal detailed diagnostics

info
  meaningful lifecycle events

warn
  recoverable abnormal condition

error
  operation/system failure
```

Do not log every heartbeat or cache hit at info level.

---

# 43. Log Event Examples

Useful:

```text
run dispatched
worker claimed run
lease expired
run recovery started
sandbox OOM killed
provider retry scheduled
run completed
```

Less useful:

```text
entered function
left function
loop iteration 73
```

---

# 44. Error Logging

Log errors structurally.

Conceptually:

```ts
logger.error(
  {
    err,
    runId,
    attemptId,
    failureCategory,
  },
  "run execution failed"
);
```

Do not stringify stacks manually everywhere.

---

# 45. Secret Redaction

Configure Pino redaction for known sensitive paths.

Examples:

```text
authorization
apiKey
providerKey
secret
token
credentials
```

Still avoid putting secrets into log objects in the first place.

Redaction is defense in depth.

---

# 46. Prompt / Model Content Policy

By default, do not log full:

```text
prompts
model responses
tool payloads
```

because they may contain sensitive data.

Instead log metadata:

```text
input size
output size
token count
provider
model
duration
```

A development-only debugging mode can be considered separately.

---

# 47. Step 7 — OpenTelemetry Bootstrap

Create shared telemetry setup.

Conceptually:

```text
packages/observability/
├── tracing.ts
├── metrics.ts
├── logging-context.ts
└── instrumentation.ts
```

Each application initializes telemetry early.

---

# 48. Service Names

Use stable service names:

```text
helmrun-api
helmrun-scheduler
helmrun-worker
helmrun-runtime
```

This makes traces and dashboards understandable.

---

# 49. Automatic Instrumentation

Where useful, instrument:

- HTTP/Express,
- PostgreSQL,
- Redis,
- AWS SDK,
- Node runtime.

Do not rely only on auto-instrumentation.

Helmrun-specific operations need custom spans.

---

# 50. Custom Span — Run Creation

Conceptually:

```text
helmrun.run.create
```

attributes might include:

```text
tenant.id
agent.id
agent.version
```

Avoid high-risk/sensitive attributes.

---

# 51. Custom Span — Scheduling

```text
helmrun.run.dispatch
```

measure:

```text
DB selection
quota checks
SQS send
```

---

# 52. Custom Span — Worker Claim

```text
helmrun.worker.claim
```

attributes:

```text
attempt.number
claim.result
```

---

# 53. Custom Span — Sandbox Startup

```text
helmrun.sandbox.start
```

measure:

```text
container creation
startup
runtime handshake
```

---

# 54. Custom Span — Model Call

```text
helmrun.model.generate
```

attributes may include:

```text
provider
model
retry_count
```

Metrics/logs can carry token counts.

Do not attach prompt text by default.

---

# 55. Custom Span — Tool Call

```text
helmrun.tool.execute
```

attributes:

```text
tool.name
tool.type
result
```

Avoid raw arguments.

---

# 56. Custom Span — Checkpoint

```text
helmrun.checkpoint.write
helmrun.checkpoint.restore
```

measure:

```text
size
storage type
duration
result
```

---

# 57. Custom Span — Recovery

```text
helmrun.recovery
```

show:

```text
lease expiry
attempt creation
checkpoint restore
requeue
```

---

# 58. Trace Propagation Through SQS

When scheduler sends execution message:

```text
trace context
```

should be placed in message attributes.

Worker extracts it.

This allows:

```text
API
 ↓
Scheduler
 ↓
SQS
 ↓
Worker
```

to appear connected.

---

# 59. Queue Semantics and Traces

A worker may receive the same message multiple times.

Trace each delivery attempt separately while associating it with:

```text
same run
```

Do not assume one trace equals one logical run forever.

A run may have:

```text
multiple attempts
multiple traces / linked spans
```

especially after recovery.

---

# 60. Run-Level Correlation

Even with multiple traces, all relevant telemetry should include:

```text
runId
```

in logs and suitable trace attributes.

This allows searching the entire lifecycle.

---

# 61. Step 8 — Prometheus Metrics

Create application metrics intentionally.

Start with a small useful set.

Do not create hundreds.

---

# 62. API Metrics

Examples:

```text
helmrun_http_requests_total
helmrun_http_request_duration_seconds
helmrun_http_requests_in_flight
```

Labels:

```text
method
route
status_class
```

Avoid raw URL paths containing IDs.

---

# 63. Run Metrics

Examples:

```text
helmrun_runs_created_total
helmrun_runs_completed_total
helmrun_runs_failed_total
helmrun_runs_cancelled_total
helmrun_run_execution_duration_seconds
```

Useful labels:

```text
result
failure_category
```

---

# 64. Scheduler Metrics

Examples:

```text
helmrun_scheduler_dispatch_total
helmrun_scheduler_dispatch_failures_total
helmrun_scheduler_dispatch_duration_seconds
```

---

# 65. Queue Metrics

Application-derived:

```text
helmrun_queue_wait_duration_seconds
```

AWS supplies:

```text
ApproximateNumberOfMessagesVisible
ApproximateAgeOfOldestMessage
```

Do not duplicate every AWS metric unnecessarily.

---

# 66. Worker Metrics

Examples:

```text
helmrun_worker_active_executions
helmrun_worker_execution_total
helmrun_worker_claim_conflicts_total
helmrun_worker_execution_duration_seconds
```

---

# 67. Lease / Recovery Metrics

From Phase 4:

```text
helmrun_lease_expirations_total
helmrun_heartbeat_failures_total
helmrun_recoveries_total
helmrun_recovery_duration_seconds
helmrun_stale_writes_rejected_total
```

---

# 68. Checkpoint Metrics

Examples:

```text
helmrun_checkpoint_write_total
helmrun_checkpoint_write_duration_seconds
helmrun_checkpoint_restore_total
helmrun_checkpoint_size_bytes
```

---

# 69. Sandbox Metrics

From Phase 5:

```text
helmrun_sandboxes_active
helmrun_sandbox_start_duration_seconds
helmrun_sandbox_oom_total
helmrun_sandbox_timeout_total
helmrun_sandbox_cleanup_failures_total
```

---

# 70. Provider Metrics

Examples:

```text
helmrun_model_calls_total
helmrun_model_call_duration_seconds
helmrun_model_errors_total
helmrun_model_tokens_total
```

Labels:

```text
provider
model
result
```

Be careful with model-name cardinality if user-provided models become arbitrary.

---

# 71. Tool Metrics

Examples:

```text
helmrun_tool_calls_total
helmrun_tool_call_duration_seconds
helmrun_tool_errors_total
```

Labels:

```text
tool_type
result
```

Avoid unbounded user-defined tool names if cardinality becomes uncontrolled.

---

# 72. SSE Metrics

Examples:

```text
helmrun_sse_connections_active
helmrun_sse_connections_total
helmrun_sse_events_sent_total
helmrun_sse_disconnects_total
helmrun_sse_publish_failures_total
```

---

# 73. PostgreSQL Pool Metrics

Expose or derive:

```text
pool total
pool idle
pool waiting
query duration
```

This is useful when concurrency rises.

---

# 74. Event-Loop Metrics

Consider Node runtime metrics:

```text
event loop lag
heap usage
GC duration
```

especially for API and workers.

Use available instrumentation rather than building custom collectors unnecessarily.

---

# 75. Step 9 — Prometheus Exposure

Each service can expose:

```text
/metrics
```

on an internal/admin port or endpoint.

Do not expose internal metrics publicly without protection.

---

# 76. Local Prometheus

Add to development environment:

```text
Prometheus
```

scraping:

```text
API
Scheduler
Worker
```

Runtime/sandbox metrics may be forwarded through worker or telemetry collector.

---

# 77. Step 10 — Grafana

Add Grafana locally.

Build a small number of high-value dashboards.

Do not create decorative dashboards with dozens of unused panels.

---

# 78. Dashboard 1 — System Overview

Panels:

```text
API request rate
API p95 latency
API error rate

queued runs
active runs
completed/failed runs

active workers
active sandboxes

queue oldest-message age
```

---

# 79. Dashboard 2 — Execution

Panels:

```text
run duration p50/p95/p99
queue wait p50/p95/p99
sandbox startup latency

model-call duration
tool-call duration

checkpoint duration
recovery count
```

---

# 80. Dashboard 3 — Reliability

Panels:

```text
lease expirations
worker crashes/recoveries
stale writes rejected
checkpoint failures
DLQ count
provider error rate
sandbox OOM
sandbox timeout
```

---

# 81. Dashboard 4 — Capacity

Panels:

```text
worker active slots
DB pool waiting
Node memory
CPU
event-loop lag
SSE connections
queue backlog
```

---

# 82. Dashboard 5 — Provider Usage

Optional useful panels:

```text
calls by provider
tokens by provider
latency by provider
rate-limit failures
```

Do not build cost billing yet.

---

# 83. Step 11 — Tracing Backend

OpenTelemetry needs somewhere to send traces.

For local development, use a compatible tracing backend or Grafana stack.

Exact backend is not part of Helmrun's core stack contract.

The important part is:

```text
instrument with OpenTelemetry
```

not lock core code to one vendor.

---

# 84. OpenTelemetry Collector

A collector can receive:

```text
OTLP
```

from Helmrun services and route telemetry.

Conceptually:

```text
Services
   ↓
OTel Collector
   ↓
trace backend / metrics backend
```

This is a useful production-oriented pattern.

---

# 85. Sampling Policy

Local:

```text
100% traces
```

may be fine.

Production later:

```text
sample normal runs
retain errors/recoveries more aggressively
```

Do not finalize production sampling prematurely.

---

# 86. Step 12 — Event Correlation with Traces

Live SSE events can include:

```text
traceId
```

only if useful for debugging/admin clients.

Developer-facing events should not expose internal details unnecessarily.

A dashboard/admin view may link run IDs to trace search.

---

# 87. Run Detail Operational View

Minimal dashboard later may show:

```text
Run
├── status
├── attempt
├── worker
├── timeline
├── model calls
├── tool calls
├── checkpoints
├── recovery events
└── failure
```

Phase 6 should provide data/events necessary for this.

Full dashboard polish remains Phase 8.

---

# 88. SSE Failure — Redis Down

Scenario:

```text
Redis unavailable
```

Expected:

```text
run execution continues
durable state continues
live events may be degraded
```

SSE clients can still:

```text
poll/fetch current run state
```

depending on fallback design.

Redis outage must not corrupt execution.

---

# 89. SSE Failure — API Instance Dies

Client connection breaks.

Expected:

```text
client reconnects to another API instance
```

Then:

```text
authorize
load current state
resume live subscription
```

No sticky-session requirement should be assumed unless infrastructure forces it.

---

# 90. SSE Failure — Client Disconnects

Worker should not care.

Execution continues.

Client connection lifecycle must not control run lifecycle.

---

# 91. SSE Failure — Slow Client

Test a client that consumes events slowly.

Expected:

- bounded buffering,
- no API memory explosion,
- controlled disconnect/resync if necessary.

---

# 92. Redis Pub/Sub Failure Test

Stop Redis while runs execute.

Verify:

- execution correctness unaffected,
- publication failures measured,
- API behaves predictably,
- reconnect/current-state path still works.

---

# 93. Trace Exporter Failure

If telemetry backend fails:

```text
execution should normally continue
```

Telemetry export should be:

```text
bounded
non-blocking
fail-safe
```

Do not let an observability outage become an execution outage.

---

# 94. Prometheus Failure

If Prometheus stops scraping:

```text
Helmrun continues operating
```

Metrics storage loss should not affect execution.

---

# 95. Grafana Failure

Grafana is visualization.

It must have zero effect on execution correctness.

---

# 96. Logging Destination Failure

Pino output/log sink should not block the application indefinitely.

Production log shipping comes in the AWS phase.

For now ensure logging path is bounded and sane.

---

# 97. Trace Propagation Test

Create one run.

Verify trace shows:

```text
API
Scheduler
SQS
Worker
Sandbox
Model
Tool
Checkpoint
```

with correct parent/link relationships as practical.

---

# 98. Recovery Trace Test

Crash Worker A.

Recover on Worker B.

Verify telemetry clearly shows:

```text
attempt 1
lease expiry
recovery
attempt 2
checkpoint restore
completion
```

Even if this spans multiple traces, correlation by `runId` must be clear.

---

# 99. Error Trace Test

Force:

```text
provider timeout
```

Verify:

- span records error,
- log has same trace ID,
- metric increments error category,
- run failure state is correct.

This demonstrates correlation across all three signals.

---

# 100. Load Test — SSE Connections

Using synthetic events:

```text
100
500
1000
```

simultaneous SSE connections.

Measure:

```text
memory
CPU
event-loop lag
disconnect rate
event delivery latency
```

Do not need to reach internet-scale numbers.

The goal is understanding capacity.

---

# 101. Load Test — Event Fan-Out

Generate many events across many runs.

Measure:

```text
Redis publish latency
API subscriber processing
SSE send latency
memory
```

Identify whether event rate creates pressure.

---

# 102. Load Test — Metrics Overhead

Compare:

```text
observability disabled/minimal
vs
observability enabled
```

to understand overhead.

Do not micro-optimize unless overhead is material.

---

# 103. Cardinality Test

Inspect Prometheus series count.

Ensure labels do not include:

```text
runId
requestId
traceId
agentId
arbitrary URL
raw error messages
```

This is a real observability correctness check.

---

# 104. Trace Volume Test

Generate many fake runs.

Observe:

```text
trace volume
exporter queue
memory
```

This informs later sampling.

---

# 105. Event Payload Size Limits

SSE event payloads should be bounded.

Do not stream:

```text
100 MB tool output
```

through SSE.

Instead send:

```text
artifact/reference metadata
```

for large results.

---

# 106. Event Versioning

Include conceptual event schema version if useful.

Example:

```text
schemaVersion: 1
```

This helps SDK evolution.

Do not overbuild compatibility layers yet.

---

# 107. API Security

SSE endpoint must enforce:

```text
authentication
tenant authorization
run ownership
```

A client must never subscribe to another tenant's run events.

---

# 108. Cross-Tenant SSE Test

Tenant A has:

```text
run_A
```

Tenant B attempts:

```text
GET /runs/run_A/events
```

Expected:

```text
denied
```

No event leakage.

---

# 109. SSE Secret-Leak Test

Create fake secret in tool input.

Verify it does not appear in:

- SSE event,
- log,
- metric label,
- trace attribute.

This is an important cross-cutting security test.

---

# 110. OpenAPI Updates

Document SSE endpoint:

```text
GET /v1/runs/:runId/events
```

Document:

- auth,
- event format,
- event names,
- reconnect behavior,
- terminal behavior,
- expected connection lifecycle.

---

# 111. Event Stream Terminal Behavior

When run reaches terminal state:

```text
COMPLETED
FAILED
CANCELLED
```

SSE can:

```text
send terminal event
then close
```

or remain briefly open.

Choose and document one behavior.

Recommended:

```text
send terminal event
flush
close
```

---

# 112. Health / Readiness Updates

Observability dependencies should generally **not** be hard readiness dependencies.

For example:

```text
Grafana down
Prometheus down
trace backend down
```

should not make worker unready.

Redis is different because it also supports existing fast coordination functions, but execution correctness should still be assessed per feature.

---

# 113. Graceful Shutdown — SSE

API shutdown should:

```text
stop accepting new connections
send/close active streams where possible
unsubscribe Redis
clear keepalive timers
flush telemetry
close server
```

---

# 114. Graceful Shutdown — Telemetry

Before process exit:

```text
flush pending spans/metrics
```

within a bounded timeout.

Do not wait indefinitely.

---

# 115. Configuration Updates

Potential Phase 6 configuration:

```text
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_SERVICE_NAME
OTEL_TRACE_SAMPLE_RATIO

PROMETHEUS_ENABLED
METRICS_PORT

SSE_KEEPALIVE_INTERVAL_MS
SSE_MAX_CONNECTIONS
SSE_EVENT_BUFFER_LIMIT

REDIS_EVENT_CHANNEL_PREFIX
```

Exact names/values remain conceptual.

---

# 116. Configuration Validation

Validate:

```text
sampling ratio 0..1
positive keepalive interval
valid telemetry endpoint
reasonable buffer limit
```

Do not create environment variables for every metric detail.

---

# 117. Repository Changes

Conceptually:

```text
packages/
├── observability/
│   ├── logger.ts
│   ├── tracing.ts
│   ├── metrics.ts
│   ├── context.ts
│   └── instrumentation.ts
│
├── events/
│   ├── run-event.ts
│   ├── publisher.ts
│   ├── redis-publisher.ts
│   └── sequence.ts
```

API:

```text
apps/api/src/events/
├── sse.routes.ts
├── sse.controller.ts
├── sse.service.ts
└── subscriptions.ts
```

Exact structure is not frozen.

---

# 118. Phase 0–5 Living Infrastructure Updates

## Database

Potentially add:

- selected durable run events,
- event sequence if required,
- query support for current run timeline.

Do not turn PostgreSQL into a log store.

## Configuration

Add telemetry, metrics, SSE and event-distribution settings.

## Logging

Standardize correlation context across all services.

## Error model

Add:

```text
EventPublishError
SSESubscriptionError
TelemetryExportError
```

mostly internal.

## Tests

Add:

- SSE authorization,
- reconnect,
- Redis outage,
- slow client,
- trace propagation,
- telemetry failure,
- cardinality checks.

## CI

Add observability unit/integration tests.

## Docker/local environment

Add:

```text
Prometheus
Grafana
OTel Collector
trace backend as selected
```

## Health/readiness

Do not make visualization/telemetry backends hard execution dependencies.

## OpenAPI

Document SSE stream.

## Documentation

Add event/observability/run-debugging documentation.

## Shared packages

Create/refine observability and event packages.

## Graceful shutdown

Flush telemetry and close SSE connections.

## Failure testing

Add observability and streaming failures.

---

# 119. CI Changes

Phase 6 CI should test:

```text
event schema
event authorization
Redis publisher behavior
SSE framing
disconnect cleanup
trace propagation helpers
metric registration
no duplicate metric names
```

Heavier Grafana/Prometheus integration tests can remain local/manual.

---

# 120. Docker Compose Updates

Local stack may now include:

```text
PostgreSQL
Redis
API
Scheduler
Workers
Prometheus
Grafana
OpenTelemetry Collector
Trace backend
```

Keep developer startup manageable.

If full stack is heavy, provide:

```text
core profile
observability profile
```

or equivalent.

---

# 121. Documentation Updates

Add:

```text
docs/
├── events.md
├── sse.md
├── observability.md
├── logging.md
├── metrics.md
├── tracing.md
└── operations.md
```

Document:

- event contract,
- reconnect semantics,
- trace propagation,
- metric philosophy,
- log redaction,
- dashboard purposes,
- known limitations.

---

# 122. Suggested Week 1

Focus:

```text
event model
Redis Pub/Sub
SSE endpoint
authorization
keepalive
reconnect
structured logging cleanup
```

Target:

> A developer can watch a real Helmrun execution live.

---

# 123. Suggested Week 2

Focus:

```text
OpenTelemetry
SQS trace propagation
Prometheus metrics
Grafana dashboards
failure tests
```

Target:

> An operator can trace and measure the complete distributed execution path.

---

# 124. Optional Final 2–3 Days

Focus:

```text
SSE load test
slow-client test
Redis outage
trace-export outage
cardinality audit
dashboard cleanup
docs/refactoring
```

---

# 125. End-to-End Live Demo

Submit one run.

Watch:

```text
run.created
run.queued
run.dispatched
run.started
sandbox.started
model.call.started
model.call.completed
tool.call.started
tool.call.completed
checkpoint.created
run.completed
```

through SSE.

At the same time, show:

```text
Grafana metrics
+
distributed trace
+
structured logs
```

for the same run.

---

# 126. Recovery Observability Demo

Kill a worker mid-run.

Live/operational flow should show:

```text
heartbeat stops
lease expires
recovery starts
attempt 2 created
checkpoint restored
execution resumes
run completes
```

This makes the Phase 4 reliability system visible rather than hidden.

---

# 127. Failure Correlation Demo

Force an LLM timeout.

Show:

```text
SSE
  model.call.failed

Logs
  ProviderTimeoutError + traceId

Metric
  model_errors_total{failure="timeout"}

Trace
  failed model span
```

This demonstrates all three observability signals working together.

---

# 128. Exit Criteria

Phase 6 is complete only when:

## Event model

- [ ] Normalized run-event model exists.
- [ ] Event payloads are size-bounded.
- [ ] Event payloads do not expose secrets by default.
- [ ] Important lifecycle ordering is defined.
- [ ] Durable vs ephemeral event responsibilities are documented.

## Redis event fan-out

- [ ] Worker/runtime events can publish through Redis Pub/Sub.
- [ ] Multiple API instances can receive live events.
- [ ] Redis publication failure does not corrupt execution.
- [ ] Redis outage behavior is tested.

## SSE

- [ ] Authenticated SSE endpoint exists.
- [ ] Tenant ownership is enforced.
- [ ] Named events work.
- [ ] Event IDs/sequences are supported where useful.
- [ ] Keepalive exists.
- [ ] Disconnect cleanup works.
- [ ] Terminal stream behavior is defined.
- [ ] Reconnect/current-state behavior is documented and tested.
- [ ] Slow-client behavior is bounded.
- [ ] Cross-tenant event leakage test passes.

## Logging

- [ ] Pino fields are standardized across services.
- [ ] Request/run/attempt/worker/trace correlation works.
- [ ] Secret redaction is tested.
- [ ] Prompt/model/tool content is not logged indiscriminately.
- [ ] High-frequency events do not flood info logs.

## Tracing

- [ ] OpenTelemetry initialized in API.
- [ ] OpenTelemetry initialized in scheduler.
- [ ] OpenTelemetry initialized in workers.
- [ ] Sandbox/runtime operations are traceable.
- [ ] SQS context propagation works.
- [ ] Model spans exist.
- [ ] Tool spans exist.
- [ ] Checkpoint/recovery spans exist.
- [ ] Errors are recorded correctly.

## Metrics

- [ ] HTTP RED metrics exist.
- [ ] scheduler metrics exist.
- [ ] worker metrics exist.
- [ ] queue-wait metric exists.
- [ ] execution-duration metric exists.
- [ ] lease/recovery metrics exist.
- [ ] checkpoint metrics exist.
- [ ] sandbox metrics exist.
- [ ] provider/tool metrics exist.
- [ ] SSE metrics exist.
- [ ] metric labels pass cardinality review.

## Dashboards

- [ ] System overview dashboard exists.
- [ ] Execution dashboard exists.
- [ ] Reliability dashboard exists.
- [ ] Capacity dashboard exists.
- [ ] Dashboards show actual useful data.

## Failure/load testing

- [ ] Redis outage test passes.
- [ ] SSE API-instance restart/reconnect test passes.
- [ ] slow-client test performed.
- [ ] telemetry exporter outage does not break execution.
- [ ] SSE connection load test performed.
- [ ] event fan-out load test performed.
- [ ] trace propagation test passes.
- [ ] secret-leak telemetry test passes.

## Engineering

- [ ] Observability package is shared cleanly.
- [ ] configuration validated.
- [ ] CI tests event/SSE/telemetry primitives.
- [ ] local observability stack is reproducible.
- [ ] graceful shutdown flushes telemetry and closes streams.
- [ ] documentation matches actual behavior.

---

# 129. Explicitly Out of Scope

Do not add:

- production AWS deployment,
- CloudWatch production log pipeline,
- Terraform production infrastructure,
- Kubernetes,
- EKS,
- Helm charts,
- PagerDuty/on-call integrations,
- enterprise alert routing,
- long-term log analytics platform,
- Elasticsearch/OpenSearch,
- Kafka event streaming,
- full event-sourcing architecture,
- arbitrary historical event replay,
- billing dashboards,
- advanced cost allocation,
- multi-region telemetry,
- sophisticated SLO automation.

These belong to later phases or future work.

---

# 130. Things We Should Resist

Do not turn Phase 6 into:

```text
"Build Datadog."
```

Helmrun needs:

- clear live execution visibility,
- actionable logs,
- useful metrics,
- distributed traces,
- a few high-value dashboards.

It does not need:

- hundreds of metrics,
- dozens of dashboards,
- its own log database,
- its own tracing backend,
- a generic observability SaaS.

---

# 131. Core Phase 6 Invariants

### Invariant 1 — Observability is not authority

Logs, traces and Redis events do not replace PostgreSQL durable state.

### Invariant 2 — Observability failure should not normally fail execution

Telemetry backend outages should degrade visibility, not correctness.

### Invariant 3 — Live events are tenant-isolated

A caller may only observe authorized runs.

### Invariant 4 — Redis Pub/Sub is ephemeral

Missed Pub/Sub events cannot be assumed replayable.

### Invariant 5 — Secrets stay out of telemetry

Logs, traces, metrics and events must not become a secret exfiltration path.

### Invariant 6 — Correlation is consistent

The same run can be followed across API, scheduler, queue, worker, sandbox and runtime.

### Invariant 7 — Metrics remain bounded in cardinality

Identifiers belong in logs/traces, not Prometheus labels.

### Invariant 8 — Client streaming does not control execution

Disconnecting SSE does not cancel a run.

---

# 132. Definition of Done

Phase 6 is successful when:

> Helmrun streams authorized live execution events to developers through SSE, distributes ephemeral events across API instances with Redis Pub/Sub, produces structured correlated logs, propagates OpenTelemetry traces across API, scheduler, SQS, workers, sandboxes, model calls and tools, exposes useful Prometheus metrics, provides Grafana dashboards for system health, execution, reliability and capacity, and remains correct when its observability or streaming infrastructure partially fails.

At that point Helmrun is no longer only:

```text
durable
distributed
isolated
```

It is also:

```text
observable
debuggable
operable
```

The next phase can focus on deploying this architecture as real cloud infrastructure on AWS using Terraform and CI/CD.
