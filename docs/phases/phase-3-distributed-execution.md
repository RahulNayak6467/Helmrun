# Helmrun Phase 3 — Distributed Execution

## Phase Status

Phase 3 moves Helmrun from local/in-process agent execution to a genuine distributed execution architecture.

Phase 2 established:

- a custom TypeScript agent runtime,
- provider adapters,
- tool/MCP execution,
- cancellation,
- timeouts,
- structured outputs,
- provider/tool failure normalization,
- local execution of runs.

Phase 3 changes the execution topology.

Instead of:

```text
API
 ↓
Agent Runtime
```

Helmrun becomes:

```text
API
 ↓
PostgreSQL
 ↓
Scheduler
 ↓
AWS SQS
 ↓
Worker Fleet
 ↓
Agent Runtime
```

This is the phase where Helmrun starts behaving like an actual cloud execution system rather than a single-process backend.

Phase 3 introduces:

- a separate scheduler process,
- AWS SQS,
- independently running worker processes,
- worker polling,
- execution dispatch,
- basic worker claiming,
- worker concurrency,
- queue visibility semantics,
- acknowledgements,
- duplicate-delivery handling,
- backpressure,
- worker shutdown/draining,
- queue health/metrics,
- distributed cancellation basics.

Phase 3 does **not** yet implement full durable execution.

Leases, heartbeats, checkpoint-based recovery, crash resumption, and advanced execution ownership are Phase 4.

---

# 1. Phase Goal

At the end of Phase 3, the complete execution path should be:

```text
Developer
   │
   │ POST /runs
   ▼
Control Plane
   │
   ▼
PostgreSQL
   │
   │ durable run intent
   ▼
Scheduler
   │
   │ execution message
   ▼
AWS SQS
   │
   ├───────────┬───────────┐
   ▼           ▼           ▼
Worker A    Worker B    Worker N
   │
   ▼
Agent Runtime
   │
   ▼
LLM / MCP / Tools
   │
   ▼
PostgreSQL
   │
   ▼
Run Result
```

A run should no longer depend on the API process staying alive.

The target is:

> Helmrun can accept durable run intent, dispatch it through a queue, execute it on independently scalable workers, and correctly handle queue retries, duplicate messages, concurrency, cancellation, and worker shutdown.

---

# 2. Estimated Duration

Recommended:

```text
2.5 to 3 weeks
```

Approximate effort:

```text
50–65 hours
```

Suggested split:

| Area | Approx. hours |
|---|---:|
| Queue/distributed execution theory | 8–10 h |
| Scheduler design | 7–9 h |
| SQS integration | 7–9 h |
| Worker architecture | 8–10 h |
| Concurrency/backpressure | 6–8 h |
| Duplicate delivery/idempotency | 5–7 h |
| Failure/load testing | 6–8 h |
| Docs/refactoring | 3–4 h |

---

# 3. What Phase 3 Adds

Before Phase 3:

```text
API
 ↓
Run
 ↓
local execution
 ↓
Agent Runtime
```

After Phase 3:

```text
API
 ↓
PostgreSQL
 ↓
Scheduler
 ↓
SQS
 ↓
distributed workers
 ↓
Agent Runtime
```

This creates real distributed-system properties:

- asynchronous delivery,
- queue delay,
- duplicate messages,
- independent failures,
- worker concurrency,
- partial failure,
- distributed cancellation,
- independent scaling,
- backpressure.

---

# 4. Frozen vs Conceptual

## Frozen architectural direction

The following are considered part of the Helmrun v1 design:

- The API does not directly execute agent runs.
- PostgreSQL persists run intent before execution dispatch.
- A scheduler is a separate process.
- SQS is the durable execution queue.
- Workers are separately running and independently scalable.
- SQS messages should contain minimal execution identity, not the full authoritative agent configuration.
- Workers reload authoritative configuration from durable storage.
- SQS delivery is treated as at-least-once.
- Duplicate messages are expected.
- Workers must claim runs atomically before execution.
- Worker concurrency is bounded.
- Queue polling uses long polling.
- Messages are acknowledged only after the worker reaches a safe completion point.
- Worker shutdown drains or terminates work deliberately.
- PostgreSQL remains authoritative.
- Redis must not become the execution source of truth.
- The Phase 2 runtime remains reusable and independent from queue mechanics.

## Conceptual / not frozen

The following remain flexible:

- exact scheduler polling algorithm,
- exact dispatch batching,
- exact SQS message schema,
- exact visibility timeout,
- exact worker concurrency value,
- exact worker claim fields,
- exact queue naming,
- exact DLQ policy,
- exact retry count,
- exact cancellation signaling mechanism,
- exact scheduler cadence,
- exact autoscaling logic,
- exact worker process structure.

These should be validated experimentally.

---

# 5. Architecture

```text
                         CONTROL PLANE

Developer
   │
   ▼
API
   │
   ▼
PostgreSQL
   │
   │ queued runs
   ▼
Scheduler
   │
   ▼
AWS SQS
   │
   ├───────────────┬───────────────┐
   ▼               ▼               ▼
Worker A         Worker B         Worker C
   │               │               │
   ▼               ▼               ▼
Agent Runtime   Agent Runtime   Agent Runtime
   │               │               │
   ▼               ▼               ▼
LLM / Tools     LLM / Tools     LLM / Tools
```

---

# 6. Theory Module A — Message Queues

Understand:

- producer,
- queue,
- consumer,
- acknowledgement,
- delivery semantics,
- visibility,
- redelivery,
- dead-letter queues,
- backpressure,
- consumer concurrency.

Most important idea:

> Queue delivery is not equivalent to exactly-once execution.

---

# 7. Theory Module B — SQS Semantics

Study:

- Standard queues,
- at-least-once delivery,
- best-effort ordering,
- long polling,
- visibility timeout,
- message retention,
- delay,
- receive count,
- delete/acknowledge,
- dead-letter queues,
- redrive policy.

Do not assume:

```text
one SQS message
    =
one execution
```

Instead assume:

```text
one logical run
    ↓
message may appear more than once
```

---

# 8. Theory Module C — Visibility Timeout

When Worker A receives a message:

```text
SQS
 ↓
Worker A
```

the message becomes temporarily invisible.

If Worker A does not delete it before visibility expires:

```text
visibility expires
      ↓
message becomes visible
      ↓
Worker B may receive it
```

Therefore visibility timeout is not a lock.

It is a queue-delivery mechanism.

Execution ownership must still be enforced by Helmrun.

---

# 9. Theory Module D — Idempotent Consumers

A consumer is idempotent when processing the same logical message multiple times does not cause duplicated effects.

For Helmrun:

```text
Message(run_123)
Message(run_123)
```

must not result in:

```text
two independent executions of run_123
```

Worker claiming must prevent this.

---

# 10. Theory Module E — Competing Consumers

Multiple workers poll the same queue:

```text
        SQS
      /  |  \
     /   |   \
   W1    W2   W3
```

SQS distributes messages among them.

This is the basic worker-pool model.

Understand:

- horizontal scaling,
- worker concurrency,
- fairness,
- hot queues,
- task duration differences.

---

# 11. Theory Module F — Backpressure

If runs arrive faster than workers can execute them:

```text
arrival rate > processing rate
```

then:

```text
queue depth increases
```

Backpressure means the system must remain stable under overload.

Possible mechanisms include:

- bounded worker concurrency,
- tenant quotas,
- admission control,
- queue depth monitoring,
- API rate limits,
- autoscaling later.

Do not solve overload by simply starting unlimited promises.

---

# 12. Theory Module G — Worker Concurrency

A worker may process more than one run.

Example:

```text
Worker process
│
├── run A
├── run B
├── run C
└── run D
```

But concurrency must be bounded.

Understand:

- event-loop concurrency,
- CPU-bound vs I/O-bound work,
- memory usage,
- provider limits,
- Docker process count later,
- DB pool pressure.

Do not set:

```text
Promise.all(allMessages)
```

on an unbounded stream.

---

# 13. Theory Module H — Scheduler Responsibilities

Scheduler responsibilities in Phase 3:

- find queued runs,
- determine whether they are eligible for dispatch,
- avoid repeatedly dispatching the same run,
- enforce basic execution admission rules,
- enqueue run references,
- record dispatch state.

Scheduler should not:

- execute agents,
- call LLMs,
- own provider logic,
- contain tool logic.

---

# 14. Theory Module I — Polling vs Event-Driven Dispatch

Potential scheduler models:

```text
A. poll PostgreSQL for dispatchable runs

B. outbox/event-driven dispatch
```

For Phase 3, a simple reliable scheduler loop is acceptable.

Do not prematurely build a complex event bus.

However, understand the failure case:

```text
DB commit succeeds
   ↓
SQS send fails
```

The scheduler must retry later.

This is one reason durable run state exists in PostgreSQL.

---

# 15. Theory Module J — Transactional Outbox

Study the **transactional outbox pattern conceptually**.

Problem:

```text
BEGIN
create run
COMMIT

send SQS
   X
```

Now the run exists but execution dispatch failed.

An outbox pattern can atomically persist:

```text
run
+
dispatch event
```

inside the same DB transaction.

A dispatcher later sends the event.

For Phase 3:

- understand the pattern,
- decide whether to implement a small outbox,
- do not create a generic event platform.

A scheduler polling `QUEUED`/`DISPATCH_PENDING` runs can also solve the immediate problem.

The implementation is not frozen.

---

# 16. Theory Module K — Distributed Cancellation

Cancellation now crosses process boundaries.

Before:

```text
API
 ↓
in-process AbortController
```

Now:

```text
API
 ↓
Postgres
 ↓
Worker elsewhere
```

A cancellation request must become visible to the worker.

Potential mechanisms:

- PostgreSQL polling/checks,
- Redis Pub/Sub notification + PostgreSQL truth,
- lightweight cancellation channel.

The durable truth should remain PostgreSQL.

---

# 17. Implementation Sequence

Recommended:

```text
1. separate scheduler application
2. separate worker application
3. SQS local/dev integration
4. queue message contract
5. scheduler dispatch loop
6. worker polling loop
7. worker atomic run claim
8. runtime execution inside worker
9. safe message acknowledgement
10. bounded worker concurrency
11. cancellation propagation
12. DLQ/retry basics
13. metrics/logging
14. failure/concurrency/load tests
15. docs/refactoring
```

---

# 18. Step 1 — Create Scheduler Application

Add:

```text
apps/scheduler/
```

The scheduler should have its own:

- configuration,
- startup lifecycle,
- logger,
- DB access,
- shutdown hooks,
- health/readiness if exposed.

Do not import Express-specific code.

---

# 19. Scheduler Loop

Conceptually:

```text
while running:
    find dispatchable runs
    for each run:
        try dispatch to SQS
        record dispatch success
    sleep / wait
```

Important:

- bounded batch size,
- bounded loop frequency,
- predictable failure behavior,
- no busy-loop.

---

# 20. Dispatchable Run State

Phase 3 may introduce states such as:

```text
QUEUED
DISPATCHING
DISPATCHED
RUNNING
COMPLETED
FAILED
CANCELLED
```

Exact names are not frozen.

The important rule:

> A scheduler must be able to tell whether a run still needs dispatch.

---

# 21. Step 2 — SQS Queue

Create execution queue:

```text
helmrun-runs
```

Conceptually.

Also configure a DLQ:

```text
helmrun-runs-dlq
```

Exact names are flexible.

Study and configure:

- visibility timeout,
- long polling,
- max receive count,
- message retention,
- redrive policy.

---

# 22. SQS Message Contract

Keep the message small.

Recommended conceptual shape:

```json
{
  "runId": "run_123"
}
```

Optional:

```json
{
  "runId": "run_123",
  "dispatchId": "dispatch_456"
}
```

Do not include authoritative:

- agent instructions,
- API keys,
- tool credentials,
- full runtime state.

Workers should reload current immutable execution configuration from PostgreSQL.

---

# 23. Why Minimal Messages Matter

Large duplicated state in messages creates problems:

```text
DB says one thing
SQS message says another
```

For Helmrun, durable storage should remain authoritative.

Message means:

> "Run X is available for execution."

not:

> "This message contains the full truth about Run X."

---

# 24. Step 3 — Create Worker Application

Add:

```text
apps/worker/
```

Worker responsibilities:

```text
poll SQS
 ↓
receive run ID
 ↓
claim run
 ↓
load run + agent version
 ↓
execute runtime
 ↓
persist result
 ↓
acknowledge message
```

Worker must not depend on API server memory.

---

# 25. Step 4 — Worker Polling

Use SQS long polling.

Conceptually:

```text
worker
  ↓
ReceiveMessage(wait = long poll)
  ↓
0..N messages
```

Avoid tight loops such as:

```text
receive
no message
receive
no message
receive
...
```

Long polling reduces empty requests and cost.

---

# 26. Step 5 — Atomic Run Claim

Duplicate delivery is expected.

Suppose:

```text
same run message
   ├── Worker A
   └── Worker B
```

Both must try to claim.

Conceptual SQL:

```sql
UPDATE runs
SET
    status = 'RUNNING',
    worker_id = $1,
    started_at = COALESCE(started_at, NOW())
WHERE
    id = $2
    AND status IN ('DISPATCHED', 'QUEUED')
RETURNING *;
```

Only one worker should succeed.

Exact status fields remain conceptual.

This is the core Phase 3 concurrency invariant.

---

# 27. Worker Claim Result

If claim succeeds:

```text
execute
```

If claim fails because run already belongs to another worker or is terminal:

```text
do not execute
```

The worker should then safely dispose of or acknowledge the duplicate message according to the final policy.

---

# 28. Step 6 — Load Execution Configuration

After claiming:

```text
runId
  ↓
PostgreSQL
  ↓
run
  ↓
agent version
  ↓
model/tool configuration
  ↓
runtime
```

Do not trust stale configuration copied into SQS.

---

# 29. Step 7 — Execute Phase 2 Runtime

The worker invokes:

```text
packages/agent-runtime
```

The runtime should not know:

```text
SQS receipt handle
SQS visibility timeout
worker polling
scheduler
```

This separation is important.

---

# 30. Step 8 — Completion

Successful flow:

```text
runtime completes
      ↓
persist result
      ↓
transition run → COMPLETED
      ↓
delete SQS message
```

Message deletion should happen **after** durable completion state is stored.

Bad ordering:

```text
delete SQS
   ↓
then write DB
   X
```

could lose execution.

---

# 31. Step 9 — Failure

When runtime fails:

```text
runtime error
   ↓
classify failure
   ↓
persist attempt/failure state
   ↓
decide retry behavior
```

Phase 3 can use simple retry semantics.

Do not yet build checkpoint resume.

---

# 32. Retryable vs Permanent Failure

Retryable:

```text
temporary provider outage
transient network error
temporary infrastructure failure
```

Permanent:

```text
invalid agent configuration
unauthorized tool
invalid provider credentials
invalid request
```

Queue retries should not blindly retry permanent failures.

---

# 33. SQS Redelivery

One option for retryable failures:

```text
do not delete message
```

after visibility timeout:

```text
message becomes visible again
```

However, Helmrun must track attempt state.

Potential fields:

```text
attempt_count
last_failure_code
last_failure_at
```

Exact schema remains conceptual.

---

# 34. DLQ

After a configured number of receives:

```text
main queue
   ↓
repeated failures
   ↓
DLQ
```

Helmrun should not leave DLQ messages invisible operationally.

At minimum:

- log DLQ conditions,
- expose count/metric,
- document inspection process.

A full redrive UI is unnecessary.

---

# 35. Worker Concurrency

Introduce:

```text
WORKER_CONCURRENCY
```

Conceptually:

```text
Worker
│
├── slot 1
├── slot 2
├── slot 3
└── slot N
```

Use a semaphore/pool.

Never accept unlimited work.

---

# 36. Concurrency Pool

Conceptually:

```ts
const semaphore = new Semaphore(workerConcurrency);

for (const message of messages) {
  await semaphore.acquire();

  void processMessage(message)
    .finally(() => semaphore.release());
}
```

Exact implementation can use a library or custom small primitive.

The requirement is bounded concurrency.

---

# 37. Concurrency Must Consider DB Pool

Example:

```text
10 workers
×
20 concurrent runs
=
200 executions
```

If each run also requires DB queries:

```text
Postgres pressure
```

Worker concurrency is therefore connected to:

- DB connection pool,
- provider capacity,
- memory,
- CPU,
- future sandbox limits.

---

# 38. Backpressure

When all worker slots are occupied:

```text
do not pull unlimited extra messages
```

or:

```text
do not begin processing them
```

The queue should absorb excess load.

This is a major advantage of SQS.

---

# 39. Scheduler Admission

The scheduler can enforce basic eligibility:

```text
tenant execution quota
run not cancelled
run not already dispatched
```

Do not build sophisticated fair scheduling yet.

Phase 4/production hardening can evolve policy.

---

# 40. Basic Tenant Concurrency

Phase 3 may introduce a simple limit:

```text
max active runs per tenant
```

This can initially be enforced through PostgreSQL/Redis-assisted counters, depending on correctness needs.

Do not rely solely on Redis if incorrect counters could allow correctness failures.

Exact implementation remains conceptual.

---

# 41. Distributed Cancellation

Flow:

```text
Client
  ↓
POST /runs/:id/cancel
  ↓
PostgreSQL:
cancel_requested_at = ...
  ↓
Worker
  ↓
observes cancellation
  ↓
AbortController
  ↓
runtime stops
```

To reduce cancellation latency, Redis Pub/Sub may optionally notify the worker:

```text
Postgres = durable truth
Redis Pub/Sub = fast signal
```

If Redis notification is missed, worker should still eventually detect cancellation.

---

# 42. Cancellation Checks

Worker/runtime should check cancellation:

- before starting,
- before model calls,
- before tool calls,
- during long waits where possible,
- between agent steps.

Do not query PostgreSQL every few milliseconds.

Choose a reasonable strategy.

---

# 43. Visibility Timeout Problem

Suppose runtime takes:

```text
10 minutes
```

but visibility timeout is:

```text
2 minutes
```

Then:

```text
message reappears
```

while Worker A is still executing.

Phase 3 should understand and test this.

Potential temporary solution:

```text
visibility timeout comfortably exceeds expected run duration
```

or:

```text
periodically extend visibility
```

Full heartbeat/lease coordination is Phase 4.

---

# 44. Visibility Extension

SQS supports changing visibility timeout.

A worker may periodically extend message visibility for long executions.

Conceptually:

```text
Worker running
   ↓
every interval
   ↓
ChangeMessageVisibility
```

This is not the same as Helmrun execution lease.

Queue visibility protects message delivery.

Phase 4 leases protect logical run ownership.

Keep those concepts separate.

---

# 45. Worker Identity

Each worker should have an identity.

Conceptually:

```text
workerId =
hostname/process-id/generated-id
```

Logs and run metadata should record it.

Useful fields:

```text
workerId
runId
messageId
receiveCount
```

---

# 46. Worker Shutdown

Shutdown is now operationally important.

On SIGTERM:

```text
stop polling SQS
    ↓
stop accepting new work
    ↓
allow active executions to finish
or cancel after grace period
    ↓
flush state/logs
    ↓
close connections
    ↓
exit
```

This is called draining.

---

# 47. Shutdown Timeout

A worker cannot wait forever.

Conceptually:

```text
gracePeriod = N seconds
```

After that:

- signal remaining runs,
- leave messages unacknowledged if work is not safely completed,
- exit.

Those messages can later be redelivered.

---

# 48. Scheduler Shutdown

Scheduler shutdown:

```text
stop scanning for runs
 ↓
finish active dispatch operations
 ↓
close DB/SQS clients
 ↓
exit
```

No new dispatches after shutdown begins.

---

# 49. Health and Readiness

## Scheduler

Readiness may depend on:

```text
PostgreSQL
SQS connectivity
```

## Worker

Readiness may depend on:

```text
PostgreSQL
SQS
runtime initialization
```

External model providers should not necessarily make the worker process "unready" globally.

A provider outage is different from a worker infrastructure failure.

---

# 50. Database Changes

Phase 3 may add fields/tables for:

```text
dispatch status
dispatched_at
worker_id
attempt_count
started_at
last_failure_code
last_failure_at
```

Potential dedicated:

```text
run_attempts
```

if useful.

Do not add checkpoint tables yet.

---

# 51. Run Attempt Model

A useful conceptual model:

```text
run
  │
  ├── attempt 1
  ├── attempt 2
  └── attempt 3
```

Each attempt can record:

```text
worker_id
started_at
ended_at
failure_code
provider
```

Whether this becomes a separate table in Phase 3 is not frozen.

---

# 52. State Transition Safety

All important transitions should be conditional.

Conceptually:

```sql
UPDATE runs
SET status = 'RUNNING'
WHERE id = $1
  AND status = 'DISPATCHED';
```

Then inspect affected row count.

Do not:

```text
SELECT status
then later UPDATE
```

without understanding the race.

---

# 53. Scheduler Double-Dispatch Race

Two scheduler instances may eventually run.

Even if Phase 3 initially starts one scheduler, design with this possibility in mind.

Race:

```text
Scheduler A sees run
Scheduler B sees run
```

Both may try to dispatch.

Use:

- atomic dispatch state transition,
- row locking,
- `FOR UPDATE SKIP LOCKED`,
- or another justified DB coordination approach.

This is a useful concurrency exercise.

---

# 54. `FOR UPDATE SKIP LOCKED`

Study it conceptually.

Potential pattern:

```sql
SELECT id
FROM runs
WHERE status = 'QUEUED'
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 50;
```

This can allow multiple scheduler processes to claim different rows.

Do not use it blindly.

Understand transaction boundaries and lock duration.

---

# 55. Scheduler Batch Size

Scheduler should process bounded batches.

Example:

```text
50 runs per poll
```

Exact number is not frozen.

Measure:

- dispatch latency,
- DB query cost,
- SQS API cost,
- lock time.

---

# 56. SQS Batch APIs

Study:

- SendMessageBatch,
- DeleteMessageBatch.

Batching can reduce API overhead.

But correctness and clarity come first.

Do not batch everything before the basic path works.

---

# 57. Message Attributes

Potentially include:

```text
tenantId
priority class
trace context
```

only if useful.

Authoritative business data should still come from PostgreSQL.

---

# 58. Trace Context Preparation

Full distributed tracing arrives later, but Phase 3 should preserve identifiers across:

```text
API
 ↓
scheduler
 ↓
SQS
 ↓
worker
```

At minimum carry or derive:

```text
runId
dispatchId
requestId where meaningful
```

Later OpenTelemetry can propagate trace context through SQS.

---

# 59. Logging Updates

Structured logs should now include:

```text
runId
tenantId
workerId
schedulerInstanceId
messageId
receiveCount
attempt
queue
```

Examples:

```text
run dispatch started
run dispatched
message received
run claim succeeded
run claim rejected
execution started
message acknowledged
message redelivered
worker draining
```

Avoid noisy per-poll empty-queue logs at info level.

---

# 60. Queue Metrics

Useful metrics:

```text
runs_dispatched_total
worker_messages_received_total
worker_duplicate_messages_total
worker_claim_failures_total
worker_executions_active
worker_executions_completed_total
worker_executions_failed_total
queue_dispatch_errors_total
```

AWS/SQS also exposes:

```text
ApproximateNumberOfMessagesVisible
ApproximateNumberOfMessagesNotVisible
ApproximateAgeOfOldestMessage
```

These become important later for autoscaling.

---

# 61. Basic Latency Metrics

Measure:

```text
run creation → dispatch
dispatch → worker receive
worker receive → execution start
execution duration
```

Conceptually:

```text
queue wait time
```

becomes an important platform metric.

---

# 62. Redis Usage in Phase 3

Redis may be used for:

- fast cancellation notification,
- concurrency counters,
- ephemeral worker metadata.

But:

```text
Redis != authoritative run ownership
```

Worker claim truth should remain durable/transactional.

If Redis fails:

- cancellation notification may become slower,
- counters may need rebuilding,
- run correctness should remain intact.

---

# 63. SQS Failure Handling

Scheduler SQS send may fail.

Expected:

```text
log failure
do not mark run successfully dispatched
retry later
```

Do not:

```text
catch error
mark dispatched anyway
```

---

# 64. Database Failure in Scheduler

If PostgreSQL fails:

```text
scheduler cannot determine authoritative runs
```

Therefore:

```text
stop dispatching
retry with bounded backoff
readiness unhealthy
```

Do not dispatch from stale in-memory lists indefinitely.

---

# 65. Database Failure in Worker

If DB becomes unavailable after receiving a message:

```text
worker cannot safely claim/load/persist
```

Expected:

- do not execute if claim cannot be confirmed,
- do not acknowledge the message,
- allow redelivery later,
- use bounded retry/backoff.

---

# 66. SQS Failure in Worker

If worker cannot poll:

```text
existing active executions may continue
```

but:

```text
no new work
```

Readiness/health semantics should reflect prolonged inability to consume work.

---

# 67. Duplicate Message Test

Create a test that injects the same run message multiple times.

Example:

```text
10 identical messages
       ↓
5 workers
```

Expected:

```text
exactly one logical execution
```

Even though:

```text
multiple messages were received
```

This is one of Phase 3's most important tests.

---

# 68. Worker Competition Test

Run:

```text
20 workers
```

against:

```text
100 runs
```

Verify:

- no run executes twice,
- all eligible runs eventually execute,
- worker concurrency stays bounded,
- no state corruption.

---

# 69. Scheduler Competition Test

Start:

```text
Scheduler A
Scheduler B
```

against the same queued runs.

Expected:

- runs may experience duplicate dispatch attempts depending on design,
- worker claiming still prevents duplicate execution,
- ideally dispatch coordination minimizes duplicates.

This demonstrates defense in depth.

---

# 70. Worker Crash Experiment

Phase 3 should deliberately kill a worker.

Example:

```text
Worker A receives message
   ↓
claims run
   ↓
starts runtime
   X
SIGKILL
```

Observe:

- SQS message visibility,
- run state,
- whether message redelivers,
- whether run becomes stuck.

Important:

> Phase 3 does not have to fully recover this correctly yet.

This experiment should expose the need for Phase 4 leases/heartbeats/recovery.

Document the failure clearly.

---

# 71. Why Phase 3 Intentionally Leaves a Gap

After a hard worker crash:

```text
PostgreSQL may say RUNNING
```

while:

```text
worker no longer exists
```

That is the exact problem Phase 4 solves.

Do not hide it with fragile hacks.

The expected Phase 3 outcome is:

```text
distributed execution works,
but durable crash recovery is incomplete.
```

---

# 72. Visibility Timeout Experiment

Configure a short visibility timeout.

Run a task longer than that timeout.

Observe:

```text
message becomes visible again
```

while first worker may still run.

Verify worker claim logic prevents duplicate execution.

This proves why queue visibility alone is insufficient for ownership.

---

# 73. Queue Backlog Load Test

Use a fake runtime or fast deterministic runtime.

Create:

```text
1,000+ runs
```

with workers processing at a slower rate.

Observe:

```text
queue depth
oldest message age
worker active count
DB pressure
scheduler throughput
```

Expected:

- API remains responsive,
- queue absorbs backlog,
- workers remain bounded,
- memory does not grow unbounded.

---

# 74. Worker Concurrency Load Test

Test worker concurrency values such as:

```text
1
5
10
20
```

Measure:

```text
throughput
memory
CPU
DB pool wait
provider simulation latency
```

Do not assume higher concurrency is always better.

---

# 75. DB Pool Under Worker Load

Workers now create additional DB pressure.

Model:

```text
API pool
+
scheduler pool
+
worker pools
=
total possible connections
```

Document:

```text
expected max connections
```

and test pressure.

---

# 76. Retry Storm Experiment

Simulate a provider outage.

If every run instantly retries:

```text
1000 failed runs
      ↓
1000 immediate retries
      ↓
provider still down
      ↓
another 1000
```

This can create a retry storm.

Phase 3 should use:

- bounded attempts,
- delay/backoff,
- jitter,
- DLQ.

Full retry orchestration can evolve later.

---

# 77. Poison Message

A poison message repeatedly fails because the underlying run is permanently invalid.

Expected:

```text
bounded retries
   ↓
terminal failure / DLQ
```

not:

```text
infinite retry forever
```

---

# 78. Cancellation Test

Test:

```text
run queued
   ↓
cancel before worker receives
```

Expected:

```text
worker sees terminal/cancelled state
does not execute
```

Also test:

```text
run executing
   ↓
cancel request
   ↓
worker/runtime stops
```

---

# 79. Shutdown Test

Start active work, then:

```text
SIGTERM worker
```

Verify:

- no new polling,
- active work follows documented drain policy,
- no completed work is lost,
- uncompleted messages remain recoverable/redeliverable.

---

# 80. Local Development

Phase 3 local setup may use:

- real AWS SQS development queue,
- LocalStack if useful,
- or another reliable SQS-compatible local approach.

Do not spend excessive time building an elaborate local cloud emulator.

The production behavior must still be validated against real SQS before phase completion.

---

# 81. Docker Compose Updates

Local environment may become:

```text
PostgreSQL
Redis
API
Scheduler
Worker
```

Potentially:

```text
LocalStack
```

if selected.

Workers should be easy to scale locally:

```text
worker x N
```

---

# 82. Repository Structure

Recommended:

```text
apps/
├── api/
├── scheduler/
├── worker/
├── dashboard/
└── cli/

packages/
├── agent-runtime/
├── model-providers/
├── tool-protocol/
├── database/
├── queue/
├── observability/
└── shared/
```

A `queue` package may encapsulate:

- SQS client,
- message types,
- serialization,
- receive/delete helpers.

Do not hide SQS semantics behind an overly generic broker abstraction.

Helmrun explicitly uses SQS in v1.

---

# 83. Queue Package

A useful structure:

```text
packages/queue/
├── sqs-client.ts
├── execution-message.ts
├── queue-errors.ts
└── queue-config.ts
```

Avoid creating:

```text
IUniversalMessageBrokerFactory
AbstractEnterpriseQueueProvider
```

unless a real second broker appears.

---

# 84. Scheduler Service Structure

Conceptually:

```text
apps/scheduler/src/
├── scheduler.ts
├── dispatch.service.ts
├── dispatch.repository.ts
├── lifecycle.ts
└── main.ts
```

Exact structure is flexible.

---

# 85. Worker Structure

Conceptually:

```text
apps/worker/src/
├── worker.ts
├── message-handler.ts
├── run-claim.service.ts
├── cancellation.ts
├── concurrency.ts
├── lifecycle.ts
└── main.ts
```

The Phase 2 runtime remains in shared packages.

---

# 86. Error Model Updates

New errors may include:

```text
QueueUnavailableError
DispatchFailedError
MessageValidationError

RunClaimConflictError
RunNotExecutableError

WorkerShuttingDownError
WorkerExecutionError

RetryExhaustedError
```

Do not surface all of these directly to API users.

Many are internal platform errors.

---

# 87. Configuration Updates

Potential Phase 3 config:

```text
AWS_REGION
SQS_RUN_QUEUE_URL
SQS_RUN_DLQ_URL

SCHEDULER_BATCH_SIZE
SCHEDULER_POLL_INTERVAL_MS

WORKER_CONCURRENCY
SQS_WAIT_TIME_SECONDS
SQS_VISIBILITY_TIMEOUT_SECONDS
WORKER_SHUTDOWN_GRACE_MS
```

Exact values are not frozen.

Add only real runtime configuration.

---

# 88. OpenAPI Updates

The external API may not change dramatically.

Important changes are semantic:

```text
POST /runs
```

now means:

```text
persist asynchronous execution request
```

Run responses may expose:

```text
queuedAt
startedAt
completedAt
attemptCount
```

Exact public fields should remain minimal.

Avoid exposing internal SQS implementation details.

---

# 89. Phase 0/1/2 Living Infrastructure Updates

## Database

Add:

- dispatch fields,
- worker identity fields,
- attempt metadata,
- conditional transition queries,
- scheduler queries,
- concurrency indexes.

## Configuration

Add SQS, scheduler, worker settings.

## Logging

Add:

```text
workerId
schedulerId
messageId
receiveCount
attempt
```

## Error model

Add queue/scheduler/worker errors.

## Tests

Add:

- duplicate delivery,
- worker race,
- scheduler race,
- queue backlog,
- shutdown,
- cancellation,
- DB/SQS failures.

## CI

Add:

- scheduler tests,
- worker tests,
- SQS integration tests where feasible.

## Docker/local development

Add scheduler and worker services.

## Health/readiness

Add SQS/worker/scheduler dependency semantics.

## OpenAPI

Update asynchronous run semantics.

## Documentation

Add queue/worker/scheduler architecture.

## Shared packages

Potentially add queue package.

## Graceful shutdown

Extend for scheduler and workers.

## Failure testing

Add distributed failure experiments.

---

# 90. CI Changes

A Phase 3 CI pipeline should approximately support:

```text
install
 ↓
lint
 ↓
typecheck
 ↓
start test dependencies
 ↓
migrations
 ↓
unit tests
 ↓
DB integration tests
 ↓
queue integration tests
 ↓
scheduler/worker integration tests
 ↓
build
```

A heavier real-AWS integration suite may run manually or on a controlled branch.

---

# 91. Documentation Updates

Add:

```text
docs/
├── distributed-execution.md
├── scheduler.md
├── worker.md
├── sqs.md
├── failure-model.md
└── run-lifecycle.md
```

Document:

- dispatch semantics,
- queue semantics,
- duplicate handling,
- worker claim invariant,
- acknowledgement ordering,
- cancellation path,
- shutdown/draining,
- known Phase 3 crash-recovery limitation.

---

# 92. Architectural Invariants

Phase 3 should establish these invariants.

### Invariant 1 — Durable intent precedes dispatch

```text
PostgreSQL first
SQS second
```

### Invariant 2 — Queue messages are hints to execute durable work

SQS is not the authoritative source of run configuration.

### Invariant 3 — Duplicate delivery is normal

Consumers must be idempotent.

### Invariant 4 — Only one worker may own logical execution

Atomic claim protects the run.

### Invariant 5 — Completed work is persisted before acknowledgement

Database state first, SQS delete second.

### Invariant 6 — Worker concurrency is bounded

Backlog belongs in the queue, not unbounded memory.

### Invariant 7 — Redis is not execution ownership truth

Redis can accelerate coordination, not define durable ownership.

---

# 93. Suggested Week 1

Focus:

```text
SQS theory
scheduler application
worker application
message contract
basic dispatch
basic polling
atomic worker claim
```

Target:

> A queued run can travel API → DB → Scheduler → SQS → Worker.

---

# 94. Suggested Week 2

Focus:

```text
Phase 2 runtime integration
bounded concurrency
acknowledgement semantics
cancellation
retry/DLQ basics
graceful worker shutdown
```

Target:

> Multiple workers can execute real runs safely.

---

# 95. Optional Final 3–5 Days

Focus:

```text
scheduler race safety
duplicate-message tests
failure experiments
backlog load test
visibility experiments
DB pool tuning
documentation
refactoring
```

---

# 96. End-to-End Demo

A strong Phase 3 demo:

```text
Start:
1 API
1 scheduler
3 workers
```

Then submit:

```text
20 agent runs
```

Observe:

```text
API persists runs
      ↓
scheduler dispatches
      ↓
SQS queues
      ↓
workers compete
      ↓
runs execute across workers
      ↓
results persist
```

Logs should show different worker IDs processing different runs.

---

# 97. Duplicate Delivery Demo

Manually inject duplicate messages for one run:

```text
run_123
run_123
run_123
```

Expected:

```text
multiple messages received
        ↓
one worker claim succeeds
        ↓
one logical execution
```

This is a high-value demonstration.

---

# 98. Backpressure Demo

Submit runs faster than workers can process.

Expected:

```text
API remains responsive
queue grows
workers remain at configured concurrency
memory remains bounded
runs eventually drain
```

This shows real platform behavior.

---

# 99. Worker Crash Demo

Kill a worker mid-run.

Observe:

```text
message eventually redelivers
```

but also demonstrate/document that:

```text
run ownership may remain stuck
```

without Phase 4 leases.

This is not a Phase 3 failure.

It is the designed transition into the next phase.

---

# 100. Exit Criteria

Phase 3 is complete only when:

## Architecture

- [ ] Scheduler runs separately from API.
- [ ] Worker runs separately from API.
- [ ] API does not execute agent runs directly.
- [ ] SQS is integrated.
- [ ] Worker uses Phase 2 runtime package.

## Dispatch

- [ ] Runs persist before queue dispatch.
- [ ] Scheduler finds dispatchable runs.
- [ ] Dispatch is retryable.
- [ ] SQS message contract is minimal and validated.
- [ ] Duplicate scheduler activity cannot corrupt state.

## Workers

- [ ] Workers long-poll SQS.
- [ ] Worker concurrency is bounded.
- [ ] Worker IDs are recorded/logged.
- [ ] Worker claims are atomic.
- [ ] Duplicate messages do not cause duplicate logical execution.
- [ ] Runtime results persist correctly.
- [ ] Completed work is persisted before message delete.

## Failure handling

- [ ] SQS send failure tested.
- [ ] SQS receive failure tested.
- [ ] DB failure in scheduler tested.
- [ ] DB failure in worker tested.
- [ ] Duplicate message test passes.
- [ ] Visibility-timeout experiment performed.
- [ ] Retry behavior is bounded.
- [ ] DLQ exists or equivalent terminal handling is documented.

## Concurrency/backpressure

- [ ] Multi-worker test passes.
- [ ] Scheduler concurrency/race tested.
- [ ] Worker concurrency limit enforced.
- [ ] Queue backlog load test performed.
- [ ] DB pool pressure measured.
- [ ] No unbounded in-memory work queue exists.

## Cancellation/shutdown

- [ ] Queued cancellation works.
- [ ] Running cancellation propagates.
- [ ] Worker stops polling during shutdown.
- [ ] Active work follows documented drain policy.
- [ ] Scheduler shuts down cleanly.

## Engineering

- [ ] Structured logs include queue/worker context.
- [ ] Configuration is validated.
- [ ] CI includes scheduler/worker tests.
- [ ] Docker/local environment runs API + scheduler + workers.
- [ ] Documentation reflects actual distributed behavior.
- [ ] Known worker-crash limitation is explicitly documented.

---

# 101. Explicitly Out of Scope

Do not add:

- durable execution leases,
- heartbeat-based ownership renewal,
- checkpoint persistence,
- checkpoint resume,
- worker crash recovery,
- exactly-once side-effect orchestration,
- sophisticated distributed scheduler,
- priority scheduling,
- Kafka,
- gRPC,
- Kubernetes,
- Docker sandbox isolation for untrusted agent code,
- full OpenTelemetry distributed tracing,
- Prometheus/Grafana production dashboards,
- AWS production deployment,
- Terraform production infrastructure,
- multi-region queues,
- billing,
- advanced provider routing,
- global fairness algorithms.

These belong to later phases or future work.

---

# 102. Things We Should Resist

Do not turn Phase 3 into:

```text
"Build our own distributed task broker."
```

Avoid:

- replacing SQS with a custom queue,
- building custom queue persistence,
- writing distributed consensus,
- implementing exactly-once messaging,
- creating a universal scheduler framework,
- adding Kafka merely because it is distributed,
- adding gRPC without a concrete requirement,
- building Kubernetes orchestration before worker semantics are correct.

The goal is:

> Use SQS correctly and make Helmrun's execution semantics reliable.

---

# 103. Definition of Done

Phase 3 is successful when:

> Helmrun can accept durable run requests, dispatch them through a separately running scheduler into SQS, execute them across multiple bounded-concurrency workers using the Phase 2 runtime, prevent duplicate logical execution under at-least-once delivery, propagate cancellation, handle retries and queue failures predictably, drain workers safely, and remain stable under a controlled queue backlog.

At that point Helmrun has a genuine distributed execution architecture.

The remaining major reliability problem is:

```text
What happens when a worker dies after claiming a run?
```

That becomes the central problem of **Phase 4 — Durable Execution, Leases, Heartbeats, Checkpoints & Crash Recovery**.
