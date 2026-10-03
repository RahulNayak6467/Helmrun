# Helmrun Phase 4 — Durable Execution, Leases, Heartbeats & Crash Recovery

## Phase Status

Phase 4 turns Helmrun's distributed execution system into a **durable execution platform**.

Phase 3 established:

- a separate scheduler,
- AWS SQS,
- distributed workers,
- atomic run claiming,
- bounded worker concurrency,
- retry/DLQ basics,
- distributed cancellation,
- worker draining,
- queue/backpressure behavior.

The largest remaining reliability gap is:

```text
Worker claims a run
      ↓
execution begins
      ↓
worker crashes
      ↓
PostgreSQL may still say RUNNING
```

Phase 4 solves that class of problems.

This phase introduces:

- execution leases,
- worker heartbeats,
- lease renewal,
- stale-worker detection,
- recovery scheduling,
- execution attempts,
- checkpoint persistence,
- checkpoint restoration,
- crash recovery,
- stale-worker fencing,
- retry-safe state transitions,
- recovery-safe cancellation,
- stronger idempotency,
- side-effect awareness,
- failure classification,
- durable execution invariants,
- fault-injection testing.

The goal is not to promise mathematically "exactly-once execution."

The goal is:

> **Helmrun can recover a run after infrastructure failure without silently losing work, creating uncontrolled duplicate execution, or trusting dead workers indefinitely.**

---

# 1. Phase Goal

At the end of Phase 4, this flow should work:

```text
Worker A claims run
      ↓
lease created
      ↓
heartbeat renews lease
      ↓
agent executes
      ↓
checkpoint #1
      ↓
agent executes
      ↓
checkpoint #2
      ↓
Worker A crashes
      X
heartbeat stops
      ↓
lease expires
      ↓
scheduler/recovery process detects stale run
      ↓
run becomes recoverable
      ↓
requeue
      ↓
Worker B claims new attempt
      ↓
loads checkpoint #2
      ↓
resumes
      ↓
COMPLETED
```

The system should understand that:

```text
message redelivery
```

and:

```text
execution ownership
```

are separate problems.

---

# 2. Estimated Duration

Recommended:

```text
3 to 4 weeks
```

Approximate effort:

```text
65–85 hours
```

Suggested split:

| Area | Approx. hours |
|---|---:|
| Durable-execution theory | 8–10 h |
| Lease/heartbeat model | 10–12 h |
| Execution-attempt model | 5–7 h |
| Checkpoint design/persistence | 10–13 h |
| Recovery flow | 9–12 h |
| Idempotency/side-effect handling | 7–9 h |
| Failure/concurrency tests | 10–14 h |
| Docs/refactoring | 4–6 h |

This is intentionally the deepest phase in Helmrun v1.

---

# 3. What Changes from Phase 3

Phase 3:

```text
SQS
 ↓
Worker
 ↓
atomic claim
 ↓
execute
```

Problem:

```text
Worker dies after claim
```

There is no durable proof that the worker is still alive.

Phase 4:

```text
SQS
 ↓
Worker
 ↓
claim + lease
 ↓
heartbeat
 ↓
checkpoint
 ↓
execute
```

If worker disappears:

```text
lease expires
 ↓
recover
```

---

# 4. Frozen vs Conceptual

## Frozen architectural direction

The following are part of Helmrun v1:

- Execution ownership is represented by a time-bounded lease.
- Workers renew leases while actively executing.
- A missing heartbeat eventually causes ownership to expire.
- PostgreSQL is authoritative for execution ownership.
- SQS visibility timeout is not treated as the execution lease.
- Each recovery creates or advances an execution attempt.
- A stale worker must not be allowed to overwrite the result of a newer owner.
- Checkpoints are durable.
- Checkpoint metadata lives in PostgreSQL.
- Large checkpoint payloads may live in S3.
- Recovery begins from durable state, not worker memory.
- Completed work is committed before SQS acknowledgement.
- Duplicate queue delivery is normal.
- Recovery logic must be idempotent.
- External side effects require stronger care than internal state.
- Cancellation must remain valid through recovery.

## Conceptual / not frozen

The following remain flexible:

- exact lease duration,
- heartbeat interval,
- checkpoint frequency,
- checkpoint schema,
- whether small checkpoints remain entirely in PostgreSQL,
- exact attempt-table schema,
- exact fencing-token representation,
- exact recovery state names,
- exact retry policy,
- exact scheduler/recovery query,
- exact visibility-extension strategy,
- exact S3 object layout,
- exact side-effect deduplication strategy per tool.

---

# 5. Core Durable-Execution Model

Conceptually:

```text
Run
 │
 ├── Attempt 1
 │      ├── Worker A
 │      ├── Lease
 │      ├── Heartbeats
 │      └── Checkpoints
 │
 └── Attempt 2
        ├── Worker B
        ├── New Lease
        └── Resume from checkpoint
```

The **run** is the logical execution.

An **attempt** is one ownership period by one worker.

---

# 6. Theory Module A — Failure Model

Before implementing recovery, define what can fail.

Examples:

```text
API crash
scheduler crash
worker process crash
host crash
network partition
PostgreSQL outage
Redis outage
SQS delay/redelivery
LLM timeout
tool timeout
tool succeeds but response is lost
worker freezes
worker becomes slow
```

Durable execution starts with:

> Which failures are we trying to survive, and what durable evidence remains after each one?

---

# 7. Theory Module B — Leases

A lease is temporary ownership.

Example:

```text
run_123
owner = worker_A
lease_until = 12:30:30
```

Worker A owns the run only while:

```text
current_time < lease_until
```

If lease expires:

```text
ownership may be reclaimed
```

This is fundamentally different from:

```text
worker_id = worker_A forever
```

---

# 8. Theory Module C — Heartbeats

A heartbeat proves continued liveness.

Conceptually:

```text
Worker A
   │
   │ every N seconds
   ▼
PostgreSQL
   │
   └── extend lease_until
```

Heartbeats should be:

- periodic,
- bounded,
- independent from individual LLM/tool calls where practical,
- observable,
- safe under transient failure.

---

# 9. Theory Module D — Lease Safety Margin

If:

```text
lease duration = 30s
heartbeat every = 29s
```

the system is fragile.

Use a meaningful margin.

Conceptually:

```text
lease duration >> heartbeat interval
```

Example:

```text
heartbeat every 10s
lease duration 45s
```

Exact values are not frozen.

Study:

- scheduling delays,
- GC/event-loop stalls,
- network latency,
- DB latency,
- temporary DB outages.

---

# 10. Theory Module E — Fencing Tokens

A dangerous situation:

```text
Worker A lease expires
      ↓
Worker B claims run
      ↓
Worker A wakes up
```

Now both may think they can write.

A lease alone is insufficient unless stale owners are prevented from mutating authoritative state.

One solution is a **fencing token / attempt number / ownership version**.

Example:

```text
Attempt 1 → token 41
Attempt 2 → token 42
```

Only writes carrying the current token are accepted.

---

# 11. Fencing Example

```text
Worker A token = 41
lease expires

Worker B token = 42
becomes current owner

Worker A finishes old LLM call
tries to mark COMPLETED using token 41
```

Database should reject it.

Conceptual SQL:

```sql
UPDATE runs
SET status = 'COMPLETED'
WHERE id = $1
  AND execution_token = $2
  AND status = 'RUNNING';
```

With:

```text
execution_token = 42
```

Worker A's `41` no longer matches.

---

# 12. Theory Module F — Checkpointing

A checkpoint is a durable snapshot of recoverable runtime state.

Potential checkpoint data:

```text
runtime step
messages/context
completed tool results
usage counters
agent version reference
runtime metadata
artifact references
```

Checkpoint does not need to store everything blindly.

It should store what is required to safely resume.

---

# 13. Theory Module G — Checkpoint Granularity

Checkpoint too frequently:

```text
high DB/S3 overhead
```

Checkpoint too rarely:

```text
large amount of repeated work after crash
```

Potential strategy:

```text
after expensive/important steps
```

such as:

- after tool completion,
- after major model turn,
- before/after side-effect boundary,
- periodically if execution is long.

Exact policy should be evidence-driven.

---

# 14. Theory Module H — At-Least-Once Execution

SQS is at-least-once.

Recovery is also naturally at-least-once.

Therefore Helmrun should not claim:

```text
exactly once
```

for arbitrary external side effects.

Instead, design for:

```text
at-least-once processing
+
idempotent internal transitions
+
side-effect deduplication where possible
```

---

# 15. Theory Module I — Idempotency

Internal operations can often be made idempotent.

Examples:

```text
claim run
create checkpoint with deterministic sequence
record attempt
mark terminal state conditionally
```

External side effects may need:

- provider idempotency keys,
- tool-specific request IDs,
- application-level deduplication,
- "at most once after uncertainty" policies,
- manual/operator intervention for ambiguous outcomes.

---

# 16. Theory Module J — Ambiguous Outcomes

Example:

```text
tool = send_payment
```

Flow:

```text
Helmrun calls payment API
      ↓
payment succeeds
      ↓
network response lost
```

Helmrun sees timeout.

Reality is ambiguous.

Blind retry may duplicate the payment.

This is a critical distributed-systems concept:

> **A timeout does not prove failure.**

Phase 4 should explicitly classify side-effecting operations.

---

# 17. Theory Module K — Recovery State Machine

A recoverable run may move through conceptual states like:

```text
RUNNING
  ↓
LEASE_EXPIRED
  ↓
RECOVERING
  ↓
QUEUED
  ↓
RUNNING
```

Exact names are not frozen.

The important property is:

- state transitions are explicit,
- only valid owners mutate execution,
- stale ownership is detectable.

---

# 18. Theory Module L — Clock Considerations

Leases depend on time.

Avoid relying on unsynchronized application clocks where possible.

Prefer PostgreSQL time:

```sql
NOW()
```

for lease comparisons and renewal.

This reduces distributed clock-skew problems.

---

# 19. Implementation Sequence

Recommended:

```text
1. define failure/recovery invariants
2. add execution-attempt model
3. add lease fields/token
4. implement atomic lease claim
5. implement heartbeat renewal
6. implement stale-owner fencing
7. implement expired-lease detection
8. requeue/recovery flow
9. define checkpoint format
10. persist checkpoints
11. restore runtime from checkpoint
12. recovery-aware cancellation
13. side-effect/idempotency policies
14. failure injection
15. load/concurrency testing
16. docs/refactoring
```

---

# 20. Step 1 — Execution Attempts

Introduce an explicit attempt concept.

Conceptually:

```text
run_attempts

id
run_id
attempt_number
worker_id
execution_token
started_at
heartbeat_at
lease_until
ended_at
status
failure_code
```

Exact schema is flexible.

Benefits:

- execution history,
- debugging,
- retry visibility,
- ownership tracking,
- metrics.

---

# 21. Attempt Number

A run may have:

```text
attempt 1
attempt 2
attempt 3
```

Attempt numbers should be monotonic.

A new attempt means:

```text
new execution ownership period
```

not merely another LLM retry inside the same worker.

---

# 22. Step 2 — Lease Claim

Atomic claim should:

- verify run is claimable,
- increment/assign ownership token,
- create new attempt,
- assign worker,
- set lease expiration,
- transition run into active state.

This should occur transactionally.

---

# 23. Conceptual Lease Claim Transaction

```text
BEGIN

verify run eligible

increment execution generation/token

create run_attempt

update run:
  current_attempt_id
  execution_token
  status = RUNNING

COMMIT
```

Exact SQL will be designed during implementation.

---

# 24. Claim Concurrency Test

Run:

```text
50 workers
```

trying to claim:

```text
run_123
```

Expected:

```text
exactly one current attempt
exactly one current execution token
```

Others must observe controlled rejection.

---

# 25. Step 3 — Heartbeat Loop

When worker owns a run:

```text
start heartbeat loop
```

Conceptually:

```text
every heartbeatInterval:
    UPDATE attempt
    SET
      heartbeat_at = NOW(),
      lease_until = NOW() + leaseDuration
    WHERE
      attempt_id = ?
      AND execution_token = ?
      AND status = RUNNING
```

If update affects zero rows:

```text
worker has lost ownership
```

Execution should stop.

---

# 26. Heartbeat Failure Semantics

A single failed heartbeat should not necessarily abort instantly.

Example:

```text
DB unavailable for 2 seconds
```

But repeated heartbeat failure risks lease expiry.

Worker should track:

```text
last successful heartbeat
remaining lease time
```

and fail safely before continuing beyond ownership certainty.

---

# 27. Heartbeat Must Not Be Blocked by Agent Step

Suppose:

```text
LLM call = 90 seconds
```

Heartbeat must still run.

Therefore heartbeat loop should not depend on:

```text
agent step completing
```

It should run independently.

---

# 28. Step 4 — Ownership Loss

If worker discovers:

```text
lease renewal rejected
```

or:

```text
execution token no longer current
```

it must:

- abort runtime,
- stop tool/model work where possible,
- avoid further durable writes,
- avoid marking run terminal,
- stop checkpoint creation,
- leave ownership to the new attempt.

---

# 29. Stale Worker Fencing

Every important execution write should be fenced.

Examples:

```text
checkpoint insert
terminal status
usage update
failure record
attempt completion
```

should include current:

```text
attempt_id / execution_token
```

where appropriate.

The exact mechanism can vary by table.

---

# 30. Step 5 — Expired Lease Detection

Scheduler/recovery loop looks for:

```text
RUNNING
AND lease_until < NOW()
```

Conceptually.

Potential query:

```sql
SELECT ...
FROM runs
WHERE status = 'RUNNING'
  AND lease_until < NOW()
ORDER BY lease_until
FOR UPDATE SKIP LOCKED
LIMIT $1;
```

Exact schema/query remains conceptual.

---

# 31. Recovery Ownership

Expired lease does not mean:

```text
immediately assume old worker is dead with mathematical certainty
```

It means:

```text
old lease is no longer valid
```

The fencing token protects against a stale worker returning later.

---

# 32. Step 6 — Recovery Transition

Conceptually:

```text
expired lease
   ↓
mark current attempt EXPIRED/FAILED
   ↓
run becomes recoverable
   ↓
requeue
```

The transition must be idempotent.

If two recovery processes see the same stale run:

```text
only one should perform the recovery transition
```

---

# 33. Recovery Retry Budget

Runs should not recover forever.

Track:

```text
execution attempt count
```

and enforce a maximum.

Example concept:

```text
maxExecutionAttempts = 3
```

Exact value is configurable/flexible.

On exhaustion:

```text
run → FAILED
```

with controlled failure reason.

---

# 34. Step 7 — Checkpoint Model

Conceptual checkpoint record:

```text
run_checkpoints

id
run_id
attempt_id
sequence
runtime_step
payload_location
payload_hash
created_at
```

Potential metadata:

```text
provider usage
tool-call history
context size
checkpoint reason
```

Do not overstore if unnecessary.

---

# 35. Checkpoint Sequence

Checkpoints should have monotonic sequence numbers.

Example:

```text
checkpoint 1
checkpoint 2
checkpoint 3
```

Recovery loads:

```text
latest valid checkpoint
```

not merely "latest row by accident."

---

# 36. Checkpoint Immutability

Prefer checkpoints to be immutable.

Instead of updating checkpoint #2:

```text
create checkpoint #3
```

Benefits:

- easier debugging,
- history,
- safer recovery,
- avoids partial mutation.

---

# 37. Small vs Large Checkpoints

Small checkpoint:

```text
PostgreSQL JSONB / structured columns
```

Large checkpoint:

```text
S3 object
+
PostgreSQL metadata
```

Conceptually:

```text
PostgreSQL
  ↓
s3://helmrun-checkpoints/run_123/...
```

Exact threshold is not frozen.

---

# 38. Checkpoint Integrity

For S3-backed payloads, store:

```text
checksum/hash
```

or other validation metadata.

On restore:

```text
download
 ↓
verify
 ↓
deserialize
```

A corrupted checkpoint should not silently resume.

---

# 39. Checkpoint Serialization

Runtime state should have an explicit serializable representation.

Do not serialize:

- active sockets,
- SDK clients,
- AbortControllers,
- open file descriptors,
- closures.

Persist only durable logical state.

---

# 40. Runtime Restoration Contract

Phase 2 runtime should evolve from:

```ts
runtime.execute(initialInput)
```

toward something conceptually like:

```ts
runtime.execute({
  run,
  agentVersion,
  checkpoint?: restoredState,
  signal,
});
```

Exact API is not frozen.

---

# 41. Recovery State Validation

Before resuming, validate:

- checkpoint belongs to run,
- agent version matches,
- checkpoint schema/version supported,
- payload integrity valid,
- checkpoint sequence is latest valid one,
- run is still recoverable,
- worker currently owns new attempt.

---

# 42. Checkpoint Schema Versioning

Checkpoint format may evolve.

Include conceptual:

```text
schemaVersion
```

so future code can distinguish:

```text
checkpoint v1
checkpoint v2
```

Do not assume serialized runtime state will remain identical forever.

---

# 43. Step 8 — Checkpoint Timing

Initial recommended policy:

- after successful tool call,
- after significant model step,
- before/after non-repeatable side effects where appropriate,
- optionally after N seconds for long runs.

Do not checkpoint on every tiny variable change.

---

# 44. Checkpoint Failure

Suppose:

```text
tool succeeds
 ↓
checkpoint write fails
```

This can be dangerous.

The runtime must decide whether it can safely continue.

For important side-effect boundaries, inability to durably record progress may require:

```text
stop/fail execution
```

rather than proceeding blindly.

---

# 45. Step 9 — Resume Flow

Conceptually:

```text
Worker B claims recovered run
      ↓
load latest checkpoint
      ↓
validate
      ↓
restore runtime state
      ↓
continue from next safe step
```

Do not repeat completed steps if checkpoint proves they completed.

---

# 46. Resume Example

```text
Step 1: model call
Step 2: search tool
Checkpoint #1
Step 3: model call
Step 4: expensive API tool
Checkpoint #2
Step 5: model call
Worker crashes
```

Recovery:

```text
load checkpoint #2
resume at step 5
```

not:

```text
restart at step 1
```

---

# 47. Step 10 — Side-Effect Classification

Tool metadata should distinguish:

```text
READ_ONLY
IDEMPOTENT_WRITE
NON_IDEMPOTENT_WRITE
```

Exact taxonomy can vary.

This lets runtime/recovery apply different policies.

---

# 48. Read-Only Tool

Example:

```text
search
get_weather
read_repository
```

Retry/re-execution is generally safer.

Still consider:

- cost,
- rate limits,
- changing external data.

---

# 49. Idempotent Write Tool

Example:

```text
PUT /resource/:id
```

or APIs supporting:

```text
Idempotency-Key
```

Helmrun can attach a stable operation ID.

Conceptually:

```text
runId + stepId
```

becomes tool idempotency key.

---

# 50. Non-Idempotent Side Effect

Example:

```text
send_email
create_payment
post_message
```

If outcome is ambiguous, recovery should not blindly re-execute.

Possible policy:

```text
mark execution NEEDS_REVIEW / FAILED_AMBIGUOUS
```

or tool-specific reconciliation.

A full human-approval workflow is out of scope, but ambiguity must be represented.

---

# 51. Side-Effect Journal

A useful conceptual structure:

```text
tool_operations

operation_id
run_id
attempt_id
tool_name
step_id
status
external_id
started_at
completed_at
```

This is optional but valuable for side-effecting tools.

Do not build it for every trivial read-only tool if unnecessary.

---

# 52. Stable Operation ID

A logical tool step should have a stable ID across recovery.

Example:

```text
run_123:step_7:tool_1
```

This helps:

- deduplication,
- idempotency keys,
- tracing,
- debugging.

---

# 53. Step 11 — SQS Visibility vs Lease

Keep these separate.

## SQS visibility

Controls:

```text
when message may be delivered again
```

## Helmrun lease

Controls:

```text
which worker is allowed to mutate logical run state
```

Even if visibility expires early:

```text
another worker may receive message
```

but current valid lease/claim prevents duplicate logical execution.

---

# 54. Visibility Renewal

Worker may continue:

```text
ChangeMessageVisibility
```

during long execution.

But if that fails:

```text
lease still defines ownership
```

Duplicate receivers should fail to claim.

This is defense in depth.

---

# 55. Step 12 — Recovery and Queue Reconciliation

A stale run may need a new queue message.

Recovery flow must avoid creating uncontrolled duplicates.

Possible pattern:

```text
transition run to RECOVERY_PENDING
   ↓
enqueue run
   ↓
mark recovery dispatch
```

or use existing scheduler dispatch machinery.

Prefer reusing Phase 3 dispatch infrastructure.

---

# 56. Transactional Outbox Revisit

Phase 4 is a good point to implement a small outbox if Phase 3 used DB polling only and gaps are becoming awkward.

Concept:

```text
BEGIN
  update run state
  insert outbox event
COMMIT

dispatcher
  ↓
SQS
```

Only add it if it simplifies correctness.

Do not create a generic enterprise event platform.

---

# 57. Step 13 — Recovery-Aware Cancellation

Scenario:

```text
Worker A crashes
   ↓
user cancels run
   ↓
lease expires
```

Recovery must not requeue a cancelled run.

Cancellation remains authoritative.

Before recovery:

```text
check cancellation/terminal state
```

---

# 58. Cancellation vs Recovery Race

Possible race:

```text
Recovery process requeues
```

while:

```text
user cancels
```

Use conditional state transitions.

The outcome must be deterministic according to the chosen state machine.

---

# 59. Terminal-State Fencing

Once a run is terminal:

```text
COMPLETED
FAILED
CANCELLED
```

no stale worker should be able to move it back to:

```text
RUNNING
```

Terminal states should have strong transition rules.

---

# 60. Step 14 — Failure Classification

Introduce clear failure categories.

Examples:

```text
USER_CONFIGURATION
PROVIDER_TRANSIENT
PROVIDER_PERMANENT
TOOL_TRANSIENT
TOOL_PERMANENT
WORKER_CRASH
LEASE_EXPIRED
CHECKPOINT_ERROR
CANCELLED
AMBIGUOUS_SIDE_EFFECT
INTERNAL_ERROR
```

Exact names are conceptual.

Recovery policy depends on category.

---

# 61. Recovery Policy

Conceptual:

| Failure | Recover? |
|---|---|
| Worker crash | Yes |
| Host crash | Yes |
| Temporary provider outage | Usually |
| Invalid API key | No |
| Invalid agent config | No |
| Max steps exceeded | Usually no |
| Cancelled | No |
| Corrupt checkpoint | Possibly earlier checkpoint / otherwise fail |
| Ambiguous side effect | Do not blindly retry |

---

# 62. Checkpoint Fallback

If latest checkpoint is corrupt:

```text
checkpoint #5 invalid
```

Potentially try:

```text
checkpoint #4
```

only if safe and policy allows.

Do not automatically roll back across non-idempotent side effects.

---

# 63. Heartbeat Observability

Metrics:

```text
worker_heartbeat_success_total
worker_heartbeat_failure_total
lease_renewal_latency
lease_expirations_total
active_leases
```

Logs should include:

```text
runId
attemptId
workerId
executionToken
leaseUntil
```

Do not log every successful heartbeat at info level.

Metrics are better for high-frequency events.

---

# 64. Recovery Metrics

Useful metrics:

```text
runs_recovered_total
recovery_attempts_total
recovery_failures_total
checkpoint_restore_total
checkpoint_restore_failures_total
stale_worker_writes_rejected_total
```

---

# 65. Checkpoint Metrics

Measure:

```text
checkpoint_write_duration
checkpoint_size_bytes
checkpoint_upload_failures
checkpoint_restore_duration
checkpoint_count_per_run
```

This helps tune checkpoint frequency later.

---

# 66. Database Changes

Likely additions:

```text
runs:
  current_attempt_id
  execution_token
  recovery_count

run_attempts:
  attempt_number
  worker_id
  heartbeat_at
  lease_until
  status
  failure_code

run_checkpoints:
  sequence
  payload_location
  payload_hash
  schema_version
  created_at
```

Exact schema remains conceptual.

---

# 67. Indexing

Likely important access patterns:

```text
find expired leases
find attempts by run
find latest checkpoint
find recoverable runs
```

Potential indexes:

```text
(status, lease_until)
(run_id, attempt_number)
(run_id, sequence DESC)
```

Use `EXPLAIN ANALYZE`.

Do not create indexes only from intuition.

---

# 68. Connection Pool Impact

Heartbeats introduce regular DB writes.

Estimate:

```text
N active runs
×
heartbeat frequency
=
heartbeat write rate
```

Example:

```text
500 active runs
heartbeat every 10s
≈ 50 writes/sec
```

This should influence:

- heartbeat interval,
- batching considerations,
- DB sizing,
- indexes.

---

# 69. Heartbeat Batching

Do not implement batching immediately.

First measure.

If heartbeat write load becomes significant, evaluate:

- batch renewal,
- lower frequency,
- separate attempt table optimization.

Avoid complexity without evidence.

---

# 70. Redis Role

Redis may assist with:

- fast worker liveness view,
- cancellation notification,
- ephemeral counters.

But durable lease truth remains PostgreSQL.

If Redis disappears:

```text
lease correctness must survive
```

---

# 71. Worker Registry

Optional conceptual worker metadata:

```text
worker_id
started_at
last_seen_at
capacity
status
```

This may live in Redis or PostgreSQL depending on durability need.

Do not conflate:

```text
worker liveness
```

with:

```text
run lease ownership
```

---

# 72. Graceful Worker Shutdown

If worker shuts down normally:

```text
stop polling
 ↓
finish/drain active runs if within grace
 ↓
continue heartbeats while draining
 ↓
complete/acknowledge
```

If grace expires:

```text
abort runtime
 ↓
do not fake completion
 ↓
let lease expire / release safely
```

---

# 73. Optional Lease Release

For graceful shutdown, worker may explicitly release/requeue ownership if safe.

This can reduce recovery latency.

But hard crashes still rely on:

```text
lease expiry
```

---

# 74. Scheduler/Recovery Process

Recovery logic may live:

- in the scheduler process,
- or in a dedicated recovery loop within scheduler.

For v1, keep it simple.

Do not create a new microservice unless needed.

---

# 75. Recovery Scan

Conceptually:

```text
every N seconds
   ↓
find expired leases
   ↓
claim recovery work
   ↓
expire attempt
   ↓
requeue if eligible
```

Bound batch size.

Avoid full-table scans.

---

# 76. Recovery Concurrency

Run multiple scheduler instances.

Both may see expired leases.

Use:

- conditional updates,
- row locks,
- `SKIP LOCKED`,
- recovery token/state.

Only one should transition a stale run into recovery.

---

# 77. Failure Test — Hard Worker Kill

Scenario:

```text
run starts
checkpoint #1
checkpoint #2
SIGKILL worker
```

Expected:

```text
heartbeats stop
lease expires
recovery detects run
new attempt created
checkpoint #2 loaded
run resumes
```

This is the flagship Phase 4 test.

---

# 78. Failure Test — Worker Freezes

Simulate:

```text
worker process alive
but event loop blocked / heartbeat stopped
```

Expected:

```text
lease expires
ownership transfers
stale worker writes later rejected
```

This proves fencing works.

---

# 79. Failure Test — Stale Worker Returns

Scenario:

```text
Worker A lease expires
Worker B claims
Worker A resumes
```

Worker A tries:

```text
checkpoint
complete
fail
```

Expected:

```text
all authoritative writes rejected
```

This is one of the most important correctness tests.

---

# 80. Failure Test — Heartbeat DB Outage

Simulate temporary PostgreSQL outage.

Observe:

- heartbeat failures,
- lease safety margin,
- whether worker aborts before ownership becomes uncertain,
- recovery behavior.

Do not let workers continue indefinitely without durable ownership proof.

---

# 81. Failure Test — Checkpoint DB Failure

If checkpoint metadata write fails:

```text
do not pretend checkpoint exists
```

Runtime policy should be explicit.

---

# 82. Failure Test — S3 Checkpoint Upload Failure

If payload uses S3:

```text
upload fails
```

Expected:

- checkpoint not committed as valid,
- no DB metadata pointing to nonexistent payload,
- runtime decides whether to continue based on checkpoint importance.

Use correct ordering.

---

# 83. Checkpoint Commit Ordering

Safer pattern:

```text
upload payload
   ↓
verify success
   ↓
insert checkpoint metadata
```

or transactional equivalent where possible.

If DB metadata is written first and S3 upload fails:

```text
dangling checkpoint
```

Avoid that.

---

# 84. Failure Test — Corrupted Checkpoint

Modify/corrupt checkpoint payload.

Expected:

```text
hash validation fails
```

Then:

- try earlier safe checkpoint if allowed,
- otherwise fail recovery safely.

Never deserialize blindly.

---

# 85. Failure Test — Duplicate Recovery Messages

Inject multiple recovery messages for same run.

Expected:

```text
one current attempt
```

others fail claim or become harmless duplicates.

---

# 86. Failure Test — Cancellation During Recovery

Flow:

```text
lease expires
recovery pending
user cancels
```

Expected:

```text
run does not resume
```

---

# 87. Failure Test — Terminal Completion vs Lease Expiry

Race:

```text
worker completes
```

at nearly same moment:

```text
recovery process sees lease expiry
```

Atomic/fenced transition must ensure only one valid outcome.

---

# 88. Load Test — Many Active Leases

Simulate:

```text
100
500
1000
```

active fake executions.

Measure:

```text
heartbeat write rate
DB CPU
pool wait
lease renewal latency
recovery scan latency
```

Do not need real LLM calls.

---

# 89. Load Test — Recovery Storm

Kill many workers at once.

Example:

```text
200 active runs
workers terminated
```

Observe:

```text
lease expirations
recovery queue volume
DB load
scheduler load
SQS backlog
```

Prevent unbounded recovery spikes.

---

# 90. Recovery Backpressure

Recovery should use:

- bounded batches,
- bounded requeue rate if necessary,
- normal queue backpressure.

Do not recover thousands of runs into memory simultaneously.

---

# 91. Retry Storm Protection

Combine:

```text
provider outage
+
worker recovery
```

to ensure Helmrun does not create explosive retries.

Use:

- attempt limits,
- backoff,
- jitter,
- queue delay where useful,
- failure classification.

---

# 92. State-Machine Tests

Test every allowed transition.

Also test invalid transitions such as:

```text
COMPLETED → RECOVERING
CANCELLED → RUNNING
FAILED_PERMANENT → QUEUED
```

Exact state names can differ.

The principle is strict transition validation.

---

# 93. Property-Like Concurrency Tests

Useful invariants to assert under races:

```text
at most one current owner
at most one current execution token
terminal run never becomes non-terminal
attempt numbers strictly increase
checkpoint sequence never duplicates
stale token cannot mutate run
```

These are more valuable than trivial unit tests.

---

# 94. Chaos Testing Style

Phase 4 should deliberately inject failures.

Examples:

```text
kill worker
pause worker
drop DB connection
delay DB
fail checkpoint upload
duplicate SQS message
expire lease early
delay heartbeat
cancel during recovery
```

The goal is:

> prove the design under adverse conditions, not only read the happy-path code.

---

# 95. Error Model Updates

Potential internal errors:

```text
LeaseLostError
LeaseRenewalError
ExecutionOwnershipError
StaleExecutionTokenError

CheckpointWriteError
CheckpointCorruptError
CheckpointRestoreError

RecoveryExhaustedError
RecoveryConflictError

AmbiguousSideEffectError
```

Do not expose raw internal mechanics unnecessarily to API users.

---

# 96. User-Facing Failure Model

Public run failure should remain understandable.

Example:

```json
{
  "status": "FAILED",
  "failure": {
    "code": "EXECUTION_RECOVERY_EXHAUSTED",
    "message": "The run could not be recovered after repeated infrastructure failures."
  }
}
```

Internal logs carry richer details.

---

# 97. Configuration Updates

Potential config:

```text
LEASE_DURATION_MS
HEARTBEAT_INTERVAL_MS
RECOVERY_SCAN_INTERVAL_MS
MAX_EXECUTION_ATTEMPTS

CHECKPOINT_ENABLED
CHECKPOINT_MAX_INLINE_BYTES
CHECKPOINT_S3_BUCKET

RECOVERY_BATCH_SIZE
```

Exact names and values remain conceptual.

Validate relationships such as:

```text
heartbeat interval < lease duration
```

at startup.

---

# 98. Configuration Invariants

Startup should reject nonsensical values.

Example:

```text
heartbeat = 60s
lease = 20s
```

should not be accepted.

Also validate:

```text
max attempts >= 1
checkpoint thresholds > 0
```

---

# 99. Logging Updates

Add:

```text
attemptId
attemptNumber
executionToken
leaseUntil
checkpointId
checkpointSequence
recoveryCount
recoveryReason
```

Avoid info-level heartbeat spam.

Use:

- metrics for frequency,
- debug for detailed heartbeat traces,
- warn/error for lease problems.

---

# 100. OpenAPI Updates

Public API may expose limited durable-execution metadata:

```text
status
attemptCount
recoveryCount
lastFailure
startedAt
completedAt
```

Do not expose:

```text
SQS receipt handles
internal tokens
raw lease timestamps
worker internals
```

unless needed for admin/debug endpoints.

---

# 101. Health / Readiness Updates

Worker readiness should now include:

- DB connectivity,
- ability to maintain lease infrastructure,
- SQS connectivity,
- runtime initialization.

If worker cannot renew leases:

```text
it should not accept new work
```

---

# 102. Graceful Shutdown Updates

Worker shutdown must now:

```text
stop polling
 ↓
continue heartbeats for draining runs
 ↓
finish or release safely
 ↓
stop heartbeat loops
 ↓
flush checkpoints/state
 ↓
close resources
```

Scheduler shutdown must stop:

```text
dispatch + recovery scans
```

cleanly.

---

# 103. CI Updates

Add deterministic tests for:

```text
lease claim
heartbeat renewal
lease expiry
stale token rejection
recovery transitions
checkpoint persistence
checkpoint restore
cancellation/recovery race
```

Heavier crash tests can run:

- integration suite,
- manual failure suite,
- scheduled CI.

---

# 104. Local Development Updates

Local environment should support:

```text
API
Scheduler
multiple Workers
PostgreSQL
Redis
SQS/LocalStack or real dev queue
S3/LocalStack or dev bucket if checkpoints use S3
```

Make it easy to:

```text
kill worker containers
restart workers
pause processes
```

for failure experiments.

---

# 105. Documentation Updates

Add:

```text
docs/
├── durable-execution.md
├── leases.md
├── heartbeats.md
├── checkpoints.md
├── recovery.md
├── side-effects.md
└── failure-model.md
```

Document actual invariants, not just code flow.

---

# 106. Phase 0–3 Living Infrastructure Updates

## Database

Add:

- attempts,
- leases,
- fencing token,
- checkpoints,
- recovery indexes,
- conditional writes.

## Configuration

Add lease/heartbeat/checkpoint/recovery settings.

## Logging

Add ownership/recovery/checkpoint context.

## Error model

Add durable-execution errors.

## Tests

Add crash, stale-owner, recovery, checkpoint and side-effect tests.

## CI

Add concurrency and recovery integration suites.

## Docker/local environment

Support multi-worker crash experiments.

## Health/readiness

Workers must stop taking work when ownership infrastructure is unhealthy.

## OpenAPI

Expose only useful run recovery metadata.

## Documentation

Document durable execution and known limits.

## Shared packages

Runtime gains checkpoint/restore contracts.

## Graceful shutdown

Coordinate heartbeat/release/drain behavior.

## Failure testing

This phase significantly expands fault injection.

---

# 107. Suggested Repository Changes

Conceptually:

```text
packages/
├── agent-runtime/
│   ├── checkpoint.ts
│   ├── restore.ts
│   └── ...
│
├── database/
│   ├── attempts.repository.ts
│   ├── checkpoints.repository.ts
│   └── ...
│
└── execution/
    ├── lease.service.ts
    ├── heartbeat.service.ts
    ├── recovery.service.ts
    └── ownership.ts
```

Exact package layout is not frozen.

Do not create unnecessary abstraction layers.

---

# 108. Suggested Week 1

Focus:

```text
failure model
attempt model
lease claim
heartbeat renewal
fencing token
stale owner rejection
```

Target:

> A worker can prove ownership continuously, and stale workers cannot mutate current execution.

---

# 109. Suggested Week 2

Focus:

```text
checkpoint schema
checkpoint persistence
runtime serialization
checkpoint restore
resume path
```

Target:

> A run can stop and later resume from durable state.

---

# 110. Suggested Week 3

Focus:

```text
expired lease detection
recovery flow
retry budget
cancellation races
side-effect/idempotency policy
```

Target:

> A hard worker crash causes a new attempt to recover the run safely.

---

# 111. Optional Week 4 / Buffer

Focus:

```text
fault injection
recovery storm testing
checkpoint corruption
DB outage testing
stale-worker races
performance tuning
documentation
refactoring
```

This buffer is important because distributed recovery bugs can be subtle.

---

# 112. End-to-End Recovery Demo

A strong demo:

```text
1. Submit an agent run.
2. Worker A claims it.
3. Agent completes several steps.
4. Checkpoint #2 is persisted.
5. Kill Worker A with SIGKILL.
6. Show heartbeats stop.
7. Wait for lease expiry.
8. Scheduler detects stale attempt.
9. Run is requeued.
10. Worker B claims attempt 2.
11. Worker B restores checkpoint #2.
12. Execution resumes.
13. Run completes.
```

Logs should clearly show:

```text
attempt 1 → worker A
attempt 2 → worker B
```

---

# 113. Stale Worker Demo

After Worker B claims attempt 2, allow Worker A to resume if possible.

Worker A attempts a write with old token.

Expected:

```text
database rejects stale write
```

This is one of the best demonstrations of real distributed-systems correctness in Helmrun.

---

# 114. Side-Effect Demo

Use a fake side-effecting tool with stable operation IDs.

Example:

```text
increment_external_counter(operationId)
```

Crash after external success but before local completion recording.

Then recover.

Verify:

```text
same operation ID
```

prevents duplicate external effect.

This demonstrates why idempotency matters.

---

# 115. Exit Criteria

Phase 4 is complete only when:

## Ownership

- [ ] Runs have explicit execution attempts.
- [ ] Worker ownership is time-bounded.
- [ ] Atomic lease claim works.
- [ ] Heartbeats renew leases.
- [ ] Lease expiry is detectable.
- [ ] Ownership loss aborts execution.
- [ ] Stale workers cannot perform authoritative writes.
- [ ] Fencing/ownership token is enforced.

## Recovery

- [ ] Expired attempts are detected.
- [ ] Recovery transition is idempotent.
- [ ] Requeue/recovery uses existing dispatch path.
- [ ] Recovery attempts are bounded.
- [ ] Multiple recovery scanners cannot corrupt state.
- [ ] Cancellation prevents unwanted recovery.

## Checkpoints

- [ ] Runtime state can be serialized.
- [ ] Checkpoint metadata is durable.
- [ ] Large payload path is supported if needed.
- [ ] Checkpoints are ordered/versioned.
- [ ] Checkpoint integrity is validated.
- [ ] Latest valid checkpoint can be restored.
- [ ] Runtime can resume from checkpoint.
- [ ] Corrupt checkpoint behavior is controlled.

## Side effects

- [ ] Tool operations have stable logical IDs where needed.
- [ ] Read-only vs side-effecting behavior is distinguished.
- [ ] Idempotency keys are used where supported.
- [ ] Ambiguous external outcomes are not blindly retried.
- [ ] Side-effect policy is documented.

## Failure testing

- [ ] Hard worker-kill recovery test passes.
- [ ] Worker-freeze/stale-owner test passes.
- [ ] Stale-token writes are rejected.
- [ ] Temporary DB heartbeat failure tested.
- [ ] Checkpoint DB failure tested.
- [ ] S3/checkpoint payload failure tested if applicable.
- [ ] Corrupt checkpoint test passes.
- [ ] Duplicate recovery message test passes.
- [ ] Cancellation-vs-recovery race tested.
- [ ] Terminal-state-vs-recovery race tested.
- [ ] Recovery storm test performed.

## Engineering

- [ ] Structured logs include attempts/leases/recovery context.
- [ ] Metrics exist for lease expiry/recovery/checkpoints.
- [ ] CI includes deterministic lease/recovery tests.
- [ ] Local environment supports worker crash testing.
- [ ] Graceful shutdown preserves ownership correctness.
- [ ] Documentation reflects actual recovery semantics.

---

# 116. Explicitly Out of Scope

Do not add:

- Docker sandbox security,
- seccomp/AppArmor design,
- Kubernetes,
- EKS,
- full OpenTelemetry distributed tracing,
- Prometheus/Grafana final dashboards,
- production AWS deployment,
- Terraform production infrastructure,
- multi-region recovery,
- cross-region checkpoint replication,
- Raft/consensus,
- exactly-once guarantees for arbitrary external APIs,
- full human approval/workflow engine,
- sophisticated workflow DAGs,
- Kafka,
- gRPC,
- service mesh,
- GPU scheduling.

Those belong to later phases or future work.

---

# 117. Things We Should Resist

Do not turn Phase 4 into:

```text
"Build Temporal from scratch."
```

Helmrun v1 does not need:

- arbitrary workflow DAG orchestration,
- deterministic workflow replay engine,
- custom distributed log,
- consensus,
- every side-effect integration solved generically,
- enterprise-grade workflow version migration.

The goal is narrower:

> Make Helmrun's agent runs recoverable and ownership-safe.

---

# 118. Core Phase 4 Invariants

These should be written down and tested.

### Invariant 1 — One current owner

At most one execution attempt may be authoritative for a run.

### Invariant 2 — Ownership expires

A worker does not own a run forever.

### Invariant 3 — Stale workers are fenced

Old owners cannot write after ownership changes.

### Invariant 4 — Recovery starts from durable state

Worker memory is never required for recovery.

### Invariant 5 — Checkpoints are immutable evidence

A checkpoint represents a completed safe point.

### Invariant 6 — Terminal states stay terminal

Completed/cancelled/permanently failed runs do not return to active execution.

### Invariant 7 — Ambiguous side effects are not blindly replayed

Timeout is not proof of non-execution.

### Invariant 8 — Queue visibility is not execution ownership

SQS and Helmrun leases solve different problems.

---

# 119. Definition of Done

Phase 4 is successful when:

> Helmrun can detect when a worker that owns an execution has stopped making progress, expire that ownership using leases and heartbeats, prevent stale workers from mutating current state, create a new execution attempt, restore the latest valid durable checkpoint, resume the run on another worker, preserve cancellation and retry limits, and handle external side effects with explicit idempotency/ambiguity rules.

At that point Helmrun has moved from:

```text
distributed execution
```

to:

```text
durable distributed execution
```

The next phase can focus on **isolating the actual agent workload safely inside controlled Docker sandboxes** rather than relying only on worker-process boundaries.
