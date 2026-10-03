# Helmrun Phase 5 — Isolation, Sandboxing & Execution Security

## Phase Status

Phase 5 moves Helmrun from durable distributed execution to **isolated durable execution**.

By the end of Phase 4, Helmrun can:

- dispatch runs through SQS,
- execute across workers,
- use leases and heartbeats,
- recover after worker crashes,
- restore checkpoints,
- fence stale workers,
- preserve execution state across failures.

The remaining security problem is:

```text
Worker
  ↓
Agent Runtime
  ↓
Tools / model calls
```

If agent execution runs directly inside the worker process, then:

```text
agent bug
malicious tool
unexpected code
resource exhaustion
filesystem access
network abuse
secret exposure
```

can affect the worker itself.

Phase 5 introduces a stricter execution boundary:

```text
Worker
  ↓
Sandbox Manager
  ↓
Docker Container
  ↓
Agent Runtime
```

This phase focuses on:

- Docker-based sandboxes,
- per-run container lifecycle,
- CPU limits,
- memory limits,
- process limits,
- execution deadlines,
- filesystem isolation,
- controlled networking,
- scoped secret injection,
- tool permission enforcement,
- least privilege,
- sandbox cleanup,
- container crash handling,
- resource-exhaustion handling,
- security-oriented failure testing.

The goal is not to build a custom container runtime.

The goal is:

> **Agent workloads must execute inside controlled, disposable environments that cannot freely interfere with Helmrun's control plane or worker host.**

---

# 1. Phase Goal

At the end of Phase 5, the execution path should become:

```text
Developer
   ↓
API
   ↓
Scheduler
   ↓
SQS
   ↓
Worker
   ↓
Sandbox Manager
   ↓
Docker Container
   ↓
Agent Runtime
   ├── LLM providers
   └── allowed MCP/tools
```

The worker should no longer execute the agent workload directly in its own process.

The worker becomes:

```text
execution coordinator
```

while the sandbox becomes:

```text
execution environment
```

---

# 2. Estimated Duration

Recommended:

```text
2 to 2.5 weeks
```

Approximate effort:

```text
45–60 hours
```

Suggested split:

| Area | Approx. hours |
|---|---:|
| Container isolation/security theory | 7–9 h |
| Sandbox lifecycle | 8–10 h |
| Resource limits | 5–7 h |
| Filesystem/network restrictions | 6–8 h |
| Secret handling | 5–7 h |
| Worker/runtime integration | 5–7 h |
| Failure/security testing | 6–8 h |
| Docs/refactoring | 3–4 h |

---

# 3. What Changes from Phase 4

Before:

```text
Worker process
    ↓
Agent Runtime
```

After:

```text
Worker process
    ↓
Sandbox Manager
    ↓
Docker container
    ↓
Agent Runtime
```

This creates a clear trust boundary.

---

# 4. Frozen vs Conceptual

## Frozen architectural direction

The following are part of Helmrun v1:

- Agent execution is isolated from the worker process.
- Docker is the v1 sandbox mechanism.
- Sandboxes are disposable.
- Each run receives explicit resource limits.
- CPU and memory are bounded.
- Overall execution time is bounded.
- Tool permissions remain explicit.
- Secrets are scoped to the execution.
- The worker should not expose all host secrets to the sandbox.
- Containers should run with reduced privileges.
- Sandbox cleanup must occur on success, failure, cancellation, and worker shutdown.
- Sandbox failure must be represented as an execution failure.
- Sandbox isolation must not replace logical authorization checks.
- Security controls should be layered.

## Conceptual / not frozen

The following can evolve during implementation:

- exact Docker image layout,
- exact user UID/GID,
- exact memory limit,
- exact CPU quota,
- exact PID/process limit,
- exact filesystem mount layout,
- exact network policy,
- exact secret injection strategy,
- exact container communication protocol,
- exact image build strategy,
- exact sandbox startup timeout,
- exact cleanup timeout,
- exact seccomp/AppArmor usage,
- exact read-only filesystem policy.

---

# 5. Core Security Boundary

Conceptually:

```text
Trusted Helmrun infrastructure
│
├── API
├── Scheduler
├── Worker
└── Database / queue clients
        │
        ▼
---------------- TRUST BOUNDARY ----------------
        │
        ▼
Sandbox
├── Agent Runtime
├── Agent context
├── allowed tools
└── scoped secrets
```

The sandbox should receive only what it requires.

---

# 6. Theory Module A — Containers vs Security Boundaries

Understand:

- containers are process isolation,
- namespaces,
- cgroups,
- filesystem layers,
- capabilities,
- container user,
- host kernel sharing.

Important:

> Docker is not a perfect security boundary.

But for Helmrun v1 it is a reasonable, practical isolation layer when combined with least privilege and controlled inputs.

Do not claim VM-level isolation.

---

# 7. Theory Module B — Linux Namespaces

Learn conceptually:

- PID namespace,
- mount namespace,
- network namespace,
- user namespace,
- IPC namespace,
- UTS namespace.

You do not need to implement namespaces manually.

Understand what Docker provides.

---

# 8. Theory Module C — cgroups

Study:

- CPU limits,
- memory limits,
- process limits,
- OOM behavior.

This matters because one run should not consume all worker-host resources.

---

# 9. Theory Module D — Linux Capabilities

Containers often receive capabilities they do not need.

Understand:

- `CAP_NET_ADMIN`,
- `CAP_SYS_ADMIN`,
- `CAP_SYS_PTRACE`,
- other privileged capabilities.

Helmrun should prefer:

```text
drop capabilities by default
```

and add only what is required.

---

# 10. Theory Module E — Privileged Containers

Understand why:

```text
--privileged
```

is dangerous.

Helmrun sandboxes should not run privileged.

Avoid:

- Docker socket mounts,
- host filesystem mounts,
- host PID namespace,
- host network mode.

---

# 11. Theory Module F — Container User

Do not run runtime as root unless required.

Prefer:

```text
non-root user
```

inside container.

Study:

- UID/GID,
- filesystem ownership,
- writable directories.

---

# 12. Theory Module G — Filesystem Isolation

Understand:

- image filesystem,
- writable layer,
- bind mounts,
- read-only mounts,
- tmpfs,
- volume lifecycle.

The sandbox should have the minimum writable surface required.

---

# 13. Theory Module H — Network Isolation

Agent workloads may need:

- LLM provider APIs,
- MCP servers,
- approved external APIs.

But unrestricted egress can enable:

- scanning,
- exfiltration,
- abuse,
- unexpected costs.

Phase 5 should establish a controlled networking model.

Exact enforcement can remain practical rather than perfect.

---

# 14. Theory Module I — Secret Injection

Study risks of:

- putting all host env vars into container,
- logging env vars,
- baking secrets into images,
- persistent secret files.

Secrets should be:

- scoped,
- short-lived where possible,
- injected only for required providers/tools,
- removed with the sandbox.

---

# 15. Theory Module J — Least Privilege

Every run should receive:

```text
only required:
- model credentials
- tool credentials
- network access
- filesystem access
- resource budget
```

not:

```text
worker's entire environment
```

---

# 16. Theory Module K — Denial of Service

A run can fail accidentally or maliciously via:

- infinite loops,
- fork bombs,
- memory allocation,
- huge outputs,
- endless file writes,
- excessive network traffic.

Resource limits must bound impact.

---

# 17. Theory Module L — Container Lifecycle

Understand:

```text
create
start
inspect
wait
stop
kill
remove
```

A sandbox manager should handle each state deliberately.

---

# 18. Implementation Sequence

Recommended:

```text
1. define sandbox contract
2. build runtime container image
3. sandbox manager
4. launch per-run container
5. resource limits
6. non-root execution
7. filesystem restrictions
8. network restrictions
9. scoped secrets
10. worker ↔ sandbox protocol
11. cancellation/timeout
12. cleanup
13. crash/recovery integration
14. security/failure tests
15. docs/refactoring
```

---

# 19. Step 1 — Sandbox Contract

Define what the worker gives the sandbox.

Conceptually:

```ts
type SandboxExecutionRequest = {
  runId: string;
  attemptId: string;
  executionToken: string;

  agentVersion: AgentVersionSnapshot;
  input: unknown;

  checkpoint?: RuntimeCheckpoint;

  limits: SandboxLimits;

  credentials: ScopedCredentialReferences;
};
```

Exact type is conceptual.

---

# 20. Keep Sandbox Input Minimal

Do not pass:

- PostgreSQL superuser credentials,
- Redis admin credentials,
- SQS credentials,
- worker IAM credentials,
- unrelated tenant secrets.

Sandbox only needs runtime-specific data.

---

# 21. Step 2 — Runtime Image

Build a dedicated image.

Conceptually:

```text
helmrun-runtime:<version>
```

Image contains:

- Node.js runtime,
- compiled agent runtime,
- MCP/tool support,
- runtime entrypoint.

It should not contain:

- source-control credentials,
- local `.env`,
- AWS root credentials,
- development tooling unless required.

---

# 22. Image Versioning

Execution should know which runtime image was used.

Potential metadata:

```text
runtime_image
runtime_version
```

This helps debugging and future reproducibility.

---

# 23. Step 3 — Sandbox Manager

Worker gets a component responsible for:

```text
create
start
monitor
cancel
kill
remove
```

Conceptually:

```ts
interface SandboxManager {
  execute(request: SandboxExecutionRequest): Promise<SandboxResult>;

  cancel(sandboxId: string): Promise<void>;

  cleanup(sandboxId: string): Promise<void>;
}
```

Exact interface is not frozen.

---

# 24. Separation of Responsibilities

Worker:

```text
ownership
lease
heartbeat
queue
recovery
```

Sandbox Manager:

```text
container lifecycle
resource limits
process isolation
```

Runtime:

```text
agent loop
providers
tools
checkpoint logic
```

Do not merge them into one giant class.

---

# 25. Step 4 — Per-Run Container

Recommended v1 model:

```text
one active run
    ↓
one sandbox container
```

Benefits:

- simple isolation,
- clean lifecycle,
- easier debugging,
- easier cleanup.

Do not optimize by multiplexing many runs inside one sandbox yet.

---

# 26. Sandbox Naming

Use deterministic metadata.

Conceptually:

```text
helmrun-run-<runId>-<attemptId>
```

or labels:

```text
helmrun.run_id
helmrun.attempt_id
helmrun.tenant_id
```

Docker labels are useful for cleanup/reconciliation.

---

# 27. Step 5 — CPU Limits

Set explicit CPU bounds.

Conceptually:

```text
cpus = 0.5 / 1 / 2
```

Exact values depend on workload tier.

Agent runtime is mostly I/O-bound, but tools may not be.

---

# 28. Step 6 — Memory Limits

Set:

```text
memory limit
```

Example conceptual:

```text
512 MB
1 GB
```

Also understand OOM behavior.

If container exceeds limit:

```text
container may be OOM-killed
```

Helmrun must detect and classify this.

---

# 29. Step 7 — PID Limits

Set process limit.

This reduces risk of:

```text
fork bomb
```

or uncontrolled process spawning.

Even if normal runtime rarely spawns subprocesses, explicit limits are valuable.

---

# 30. Step 8 — Execution Time Limit

Phase 2/4 already have logical run deadlines.

Phase 5 enforces container-level deadlines too.

Layered model:

```text
runtime deadline
+
worker cancellation
+
container hard timeout
```

If runtime fails to cooperate:

```text
worker can stop/kill sandbox
```

---

# 31. Step 9 — Non-Root Runtime

Dockerfile should create a dedicated runtime user.

Conceptually:

```dockerfile
RUN addgroup --system helmrun \
 && adduser --system --ingroup helmrun helmrun

USER helmrun
```

Exact base image and syntax can vary.

---

# 32. Step 10 — Read-Only Root Filesystem

Where practical:

```text
root filesystem = read-only
```

Provide writable locations only where needed:

```text
/tmp
/work
```

Potentially via:

```text
tmpfs
```

---

# 33. Writable Workspace

A sandbox may need temporary files.

Use a dedicated workspace.

Conceptually:

```text
/work
```

Rules:

- sandbox-scoped,
- size-bounded,
- destroyed after run,
- no host-sensitive files.

---

# 34. Filesystem Quotas

Docker alone may not make per-directory quotas trivial.

For v1, use practical controls:

- memory-backed tmpfs size,
- bounded volume strategy,
- output size limits,
- runtime policy.

Do not build custom filesystem quota infrastructure.

---

# 35. Step 11 — Drop Capabilities

Prefer:

```text
cap-drop=ALL
```

then add only required capabilities, ideally none.

Test runtime compatibility.

---

# 36. No Docker Socket

Never mount:

```text
/var/run/docker.sock
```

into agent sandbox.

Doing so can effectively grant host-level control.

---

# 37. No Host Filesystem Mounts

Avoid:

```text
/:/host
/home:/host-home
```

Sandbox should not have arbitrary host visibility.

---

# 38. No Host Network

Avoid:

```text
network_mode=host
```

Use isolated Docker networking.

---

# 39. Step 12 — Network Policy

Define allowed outbound destinations conceptually.

Potentially:

```text
LLM providers
approved MCP servers
approved external tool endpoints
```

For v1, network restrictions can be practical rather than perfect.

Options may include:

- dedicated Docker network,
- egress proxy,
- allowlist proxy,
- DNS restrictions,
- tool-mediated access rather than arbitrary network.

---

# 40. Preferred Application-Level Strategy

A strong v1 principle:

> Do not give arbitrary agent code unrestricted HTTP access if tools can mediate external access.

Example:

```text
Agent
 ↓
MCP/tool
 ↓
external API
```

rather than:

```text
Agent
 ↓
arbitrary fetch()
 ↓
internet
```

This reduces security surface.

---

# 41. Network Egress Proxy

If implemented, conceptually:

```text
Sandbox
   ↓
Egress Proxy
   ↓
Allowed destinations
```

Proxy can:

- enforce allowlist,
- log destination metadata,
- apply rate limits.

Do not overbuild if tool mediation is enough for v1.

---

# 42. DNS / SSRF Awareness

Tools that fetch URLs can create SSRF risk.

Protect against access to:

```text
127.0.0.1
localhost
169.254.169.254
private subnets
internal admin services
```

where applicable.

This becomes especially important on AWS.

---

# 43. Step 13 — Secret Scope

For each run, resolve only required secrets.

Example:

```text
Agent uses OpenAI
Tools use GitHub
```

Inject:

```text
OpenAI credential
GitHub tool credential
```

Do not inject:

```text
Anthropic
Gemini
database admin
SQS
unrelated tenant credentials
```

---

# 44. Secret References vs Raw Secrets

Agent version may store:

```text
secret reference
```

not raw secret.

Example:

```text
github_credential_ref = sec_123
```

Worker resolves it at execution time.

Later AWS Secrets Manager becomes the production secret backend.

---

# 45. Secret Injection Options

Potential methods:

- environment variables,
- temporary files,
- stdin/bootstrap payload,
- local secret broker.

For v1, environment variables or temporary files may be acceptable if:

- scoped,
- not logged,
- container is ephemeral,
- cleanup is guaranteed.

Exact strategy remains conceptual.

---

# 46. Secret Logging Policy

Never log:

- raw secret,
- API key,
- bearer token,
- entire environment.

Logs may include:

```text
secretRef
provider
toolName
```

without secret contents.

---

# 47. Step 14 — Tool Permissions

Phase 2 introduced tool allowlists.

Phase 5 strengthens enforcement.

Tool invocation should require:

```text
agent allows tool
tenant allows tool
execution policy allows tool
```

Potential chain:

```text
model requests tool
    ↓
runtime allowlist
    ↓
policy check
    ↓
tool adapter
```

Sandbox does not replace authorization.

---

# 48. Tool Capability Metadata

Tools may declare capabilities:

```text
network
filesystem
side_effecting
secret_refs
```

This can inform execution policy.

Conceptual example:

```text
github.read
  network: true
  filesystem: false
  side_effecting: false
```

---

# 49. Step 15 — Worker ↔ Sandbox Communication

The worker needs:

- start signal,
- input,
- execution events,
- checkpoint requests/results,
- final result,
- errors,
- cancellation.

Possible transport:

```text
stdin/stdout protocol
local HTTP
Unix socket
```

For v1, a simple structured stdin/stdout or local IPC protocol can work.

Do not introduce gRPC just for this phase.

---

# 50. Structured Sandbox Protocol

Example conceptual messages:

```json
{
  "type": "runtime.started",
  "runId": "run_123"
}
```

```json
{
  "type": "checkpoint.created",
  "sequence": 4
}
```

```json
{
  "type": "runtime.completed",
  "result": {}
}
```

Exact event schema remains conceptual.

---

# 51. Protocol Validation

Treat sandbox output as untrusted input.

Worker should validate:

- message shape,
- run ID,
- attempt ID,
- event type,
- size bounds.

Do not blindly `JSON.parse()` and trust everything.

---

# 52. Output Size Limits

A sandbox can produce too much stdout/stderr.

Set:

- log size limits,
- result size limits,
- event size limits.

Large artifacts should go through controlled artifact storage later.

---

# 53. Step 16 — Container Startup Timeout

Container creation/start can hang or fail.

Define:

```text
sandboxStartupTimeout
```

If exceeded:

```text
SandboxStartupError
```

Run can follow retry policy.

---

# 54. Step 17 — Container Health

For a short-lived per-run container, full health checks may be unnecessary.

Worker should observe:

- container started,
- runtime process alive,
- exit code,
- timeout,
- output protocol.

Do not build Kubernetes-style probes prematurely.

---

# 55. Step 18 — Cancellation

Cancellation path:

```text
user cancels
   ↓
worker receives durable cancellation
   ↓
send graceful cancellation to runtime
   ↓
wait short grace
   ↓
docker stop
   ↓
docker kill if required
```

Do not rely only on runtime cooperation.

---

# 56. Step 19 — Cleanup

Cleanup must happen after:

- success,
- failure,
- cancellation,
- timeout,
- worker shutdown,
- recovery/fencing,
- runtime crash.

Conceptually:

```text
try execute
finally cleanup sandbox
```

but cleanup itself can fail.

---

# 57. Cleanup Failure

If:

```text
docker remove
```

fails:

- log,
- metric,
- retry cleanup,
- reconciliation job later if necessary.

Do not leak containers indefinitely.

---

# 58. Sandbox Reconciliation

Worker startup or periodic maintenance may inspect containers with Helmrun labels.

Find:

```text
orphaned sandboxes
```

that no longer correspond to active valid attempts.

Then remove them safely.

This is useful after hard worker crashes.

---

# 59. Orphan Scenario

```text
Worker A starts container
      ↓
Worker A crashes
      ↓
container remains
```

Phase 4 may recover run on Worker B.

The old sandbox must not continue indefinitely.

Use:

- ownership fencing,
- container labels,
- reconciliation,
- hard lifetime limits.

---

# 60. Stale Sandbox Protection

Even if stale container continues:

```text
execution token
```

must prevent authoritative writes.

This reuses Phase 4 fencing.

Sandbox isolation and durable ownership complement each other.

---

# 61. Container Exit Classification

Possible cases:

```text
exit 0
runtime reported success

nonzero exit
runtime crash

OOMKilled
memory limit exceeded

SIGKILL
hard cancellation / timeout

startup failure
image/container issue
```

Normalize these into Helmrun errors.

---

# 62. Error Model Updates

Potential new errors:

```text
SandboxStartupError
SandboxProtocolError
SandboxTimeoutError
SandboxOOMError
SandboxExitError
SandboxCleanupError

ResourceLimitExceededError
NetworkPolicyViolationError
SecretResolutionError
```

Exact names remain flexible.

---

# 63. Security Error vs Infrastructure Error

Distinguish:

```text
tool not permitted
```

from:

```text
container failed to start
```

and:

```text
memory limit exceeded
```

Failure category affects retry behavior.

---

# 64. Retry Semantics

Potentially retryable:

- Docker daemon transient failure,
- image pull failure,
- host transient issue.

Usually not automatically retryable:

- repeated memory exhaustion due to agent workload,
- denied tool permission,
- invalid runtime configuration.

Document policy.

---

# 65. Resource Policy

Agent version or tenant may define a resource class.

Conceptually:

```text
small
medium
large
```

mapping to:

```text
CPU
memory
timeout
```

Do not allow arbitrary unbounded values from users.

---

# 66. Quota Interaction

Tenant quota may limit:

```text
number of concurrent sandboxes
CPU allocation
memory allocation
```

For v1, basic concurrency controls are enough.

Full cloud resource accounting can come later.

---

# 67. Worker Capacity

Worker should not start more sandboxes than host can safely support.

Example:

```text
host memory = 8 GB
sandbox limit = 1 GB
```

Running 20 sandboxes is not safe.

Worker concurrency should be linked to real resource capacity.

---

# 68. Capacity Admission

Conceptually:

```text
if available capacity:
    start sandbox
else:
    keep work queued
```

SQS remains the backlog buffer.

---

# 69. CPU-Bound Tool Risk

Some tools may consume substantial CPU.

Container CPU limits protect host.

Do not rely solely on Node.js event-loop assumptions.

---

# 70. Memory-Bomb Test

Create a controlled test runtime that allocates memory until limit.

Expected:

```text
container OOM
worker survives
other runs survive
failure classified
sandbox cleaned
```

This is a flagship Phase 5 test.

---

# 71. Infinite-Loop Test

Run a CPU loop.

Expected:

- container constrained by CPU,
- run deadline enforced,
- worker remains responsive,
- container terminated,
- cleanup succeeds.

---

# 72. Fork-Bomb / Process Explosion Test

Use a safe controlled test if environment permits.

Verify PID limits prevent uncontrolled process creation.

Do not run dangerous experiments on shared infrastructure.

Use an isolated dev environment.

---

# 73. Filesystem Escape Tests

Verify sandbox cannot read:

- host `.env`,
- worker source secrets,
- host home directory,
- Docker socket,
- database credentials.

This is more valuable than only inspecting Docker flags.

---

# 74. Secret Isolation Test

Run:

```text
Agent A
```

with:

```text
OpenAI secret
```

and:

```text
Agent B
```

with:

```text
Anthropic secret
```

Verify each sandbox sees only intended credentials.

---

# 75. Cross-Tenant Secret Test

Tenant A sandbox must never receive Tenant B secrets.

Add explicit integration tests.

---

# 76. Network Restriction Test

Attempt:

```text
approved provider API
```

Expected:

```text
allowed
```

Attempt:

```text
blocked internal endpoint
```

Expected:

```text
denied
```

Exact enforcement depends on chosen networking model.

---

# 77. SSRF Test

If any HTTP-fetching tool exists, test attempts to reach:

```text
localhost
127.0.0.1
link-local metadata
private/internal IP
```

and confirm policy.

---

# 78. Tool Permission Test

Agent allowlist:

```text
github.read
```

Model requests:

```text
github.write
```

Expected:

```text
denied
```

even if the underlying credential could technically perform write operations.

---

# 79. Secret Redaction Test

Inject known fake secret.

Trigger errors.

Inspect:

- worker logs,
- sandbox logs,
- runtime errors,
- API responses.

Secret must not appear.

---

# 80. Container Crash Test

Kill runtime process inside sandbox.

Expected:

```text
worker detects exit
run attempt fails/retries according to policy
lease/heartbeat stops appropriately
sandbox cleaned
```

---

# 81. Worker Crash with Active Sandbox

Kill worker while sandbox runs.

Observe:

- sandbox lifecycle,
- Phase 4 lease expiry,
- recovery on another worker,
- old sandbox reconciliation.

This connects Phase 4 and Phase 5.

---

# 82. Cancellation Race Test

Race:

```text
sandbox completes
```

vs:

```text
worker sends cancel
```

Terminal-state fencing still applies.

No invalid state transition should occur.

---

# 83. Cleanup Race Test

Ensure cleanup is idempotent.

Calling:

```text
cleanup(sandboxId)
```

multiple times should not corrupt state.

---

# 84. Image Pull Failure Test

Simulate unavailable/bad image.

Expected:

- controlled startup failure,
- bounded retry,
- no stuck lease,
- no orphan container.

---

# 85. Docker Daemon Failure

If Docker daemon becomes unavailable:

```text
worker cannot start new sandboxes
```

Expected:

- worker readiness degraded,
- no new claims if execution cannot proceed safely,
- active existing behavior handled predictably.

---

# 86. Worker Claim Ordering

Worker should avoid claiming too much work before sandbox capacity exists.

Bad:

```text
claim 100 runs
then discover only 4 sandbox slots
```

Better:

```text
available execution slot
   ↓
receive/claim work
```

or tightly bounded prefetch.

---

# 87. Backpressure Revisited

Sandbox capacity becomes part of backpressure.

```text
SQS backlog
   ↓
worker capacity
   ↓
sandbox slots
```

Do not buffer many claimed-but-not-started runs in memory.

---

# 88. Observability Updates

Useful metrics:

```text
sandbox_start_total
sandbox_start_failures_total
sandbox_start_duration

sandbox_active
sandbox_completed_total
sandbox_failed_total

sandbox_oom_total
sandbox_timeout_total

sandbox_cleanup_failures_total

sandbox_cpu_limit
sandbox_memory_limit
```

---

# 89. Security Metrics

Potential metrics:

```text
tool_permission_denied_total
secret_resolution_failures_total
network_policy_denied_total
sandbox_protocol_errors_total
```

Avoid high-cardinality labels such as raw run IDs in Prometheus.

---

# 90. Logging Updates

Add:

```text
sandboxId
containerId
runtimeImage
resourceClass
exitCode
oomKilled
```

Keep:

```text
runId
attemptId
workerId
executionToken
```

Do not log raw container environment.

---

# 91. Database Changes

Potential additions:

```text
run_attempts:
  sandbox_id
  runtime_image
  resource_class

runs/attempts:
  failure_category
```

Most sandbox state is operational and does not need a huge relational schema.

---

# 92. S3 / Artifact Preparation

Phase 5 may need a controlled path for:

- large runtime outputs,
- temporary artifacts.

If used:

```text
sandbox
 ↓
controlled artifact upload path
 ↓
S3
```

Avoid giving broad bucket permissions.

Full artifact UX can remain later.

---

# 93. IAM Preparation

Production AWS comes later, but design toward:

```text
least privilege
```

Worker role should eventually access:

- required queue,
- required checkpoint/artifact bucket,
- required secrets.

Sandbox should not inherit unrestricted worker IAM credentials.

---

# 94. Credential Broker Concept

A stronger future design is:

```text
Sandbox
  ↓
Helmrun credential broker
  ↓
short-lived scoped token
```

This is not required for v1.

Do not overbuild unless direct secret injection proves insufficient.

---

# 95. Health / Readiness Updates

Worker readiness should now include:

- PostgreSQL,
- SQS,
- Docker daemon,
- runtime image availability/capability.

If worker cannot create sandboxes:

```text
do not accept new work
```

---

# 96. Graceful Shutdown Updates

Worker shutdown now:

```text
stop polling
 ↓
stop starting new sandboxes
 ↓
continue heartbeats
 ↓
gracefully terminate/drain sandboxes
 ↓
force kill after grace
 ↓
cleanup
 ↓
close resources
```

---

# 97. Phase 0–4 Living Infrastructure Updates

## Database

Add minimal sandbox metadata and failure classification.

## Configuration

Add:

- runtime image,
- CPU/memory defaults,
- PID limit,
- sandbox timeout,
- startup timeout,
- cleanup timeout,
- network policy settings.

## Logging

Add sandbox/container context.

## Error model

Add sandbox/security/resource-limit errors.

## Tests

Add:

- OOM,
- CPU runaway,
- secret isolation,
- network policy,
- cleanup,
- worker-crash/orphan tests.

## CI

Add sandbox integration tests where Docker is available.

## Docker/local development

Add runtime image and sandbox test harnesses.

## Health/readiness

Worker must verify Docker capability.

## OpenAPI

Only expose meaningful resource/failure information.

## Documentation

Add sandbox/security docs.

## Shared packages

Potentially add sandbox manager package/module.

## Graceful shutdown

Add container draining/cleanup.

## Failure testing

Expand to host/container-level faults.

---

# 98. Configuration Updates

Potential settings:

```text
RUNTIME_IMAGE
SANDBOX_CPU_LIMIT
SANDBOX_MEMORY_MB
SANDBOX_PIDS_LIMIT

SANDBOX_START_TIMEOUT_MS
SANDBOX_RUN_TIMEOUT_MS
SANDBOX_STOP_GRACE_MS

SANDBOX_NETWORK_MODE
SANDBOX_WORKDIR_SIZE_MB
```

Exact values/names remain conceptual.

---

# 99. Configuration Validation

Reject invalid combinations.

Examples:

```text
memory <= 0
CPU <= 0
PID limit <= 0
run timeout < startup timeout
```

Also enforce upper bounds from trusted configuration, not user input.

---

# 100. Runtime Image Build

CI should build:

```text
helmrun-runtime
```

separately from:

```text
helmrun-worker
```

This preserves architectural boundaries.

---

# 101. Image Security Basics

Use:

- minimal base image where practical,
- pinned versions,
- non-root user,
- no unnecessary packages,
- `.dockerignore`,
- dependency scanning if available.

Do not optimize image size at the cost of maintainability.

---

# 102. Reproducible Image Tagging

Prefer immutable identifiers:

```text
git SHA
version
digest
```

rather than relying only on:

```text
latest
```

for production behavior.

---

# 103. Sandbox Protocol Versioning

Worker and runtime image may evolve independently.

Include:

```text
protocolVersion
```

in startup handshake.

If incompatible:

```text
fail clearly
```

instead of mysterious parse errors.

---

# 104. Protocol Handshake

Conceptually:

```text
Worker starts container
   ↓
Runtime emits:
{
  "type": "runtime.ready",
  "protocolVersion": 1
}
```

Worker verifies compatibility before sending execution input.

---

# 105. Sandbox Startup Failure Categories

Distinguish:

```text
image missing
container create failed
container start failed
runtime handshake timeout
protocol mismatch
```

These help debugging.

---

# 106. Read-Only vs Side-Effecting Tools

Phase 4 established side-effect semantics.

Phase 5 should ensure tool capabilities and secrets align.

Example:

```text
read-only GitHub tool
```

should not receive a credential with repository admin scope if avoidable.

---

# 107. Security Principle — Defense in Depth

Do not rely on one layer.

Use:

```text
tenant auth
+
agent tool allowlist
+
tool validation
+
scoped secrets
+
container isolation
+
resource limits
+
network restrictions
+
fencing tokens
```

Each protects against different failure classes.

---

# 108. Suggested Week 1

Focus:

```text
container isolation theory
runtime image
sandbox manager
per-run container
CPU/memory/PID/time limits
non-root execution
filesystem restrictions
```

Target:

> Worker executes each run in a disposable constrained container.

---

# 109. Suggested Week 2

Focus:

```text
network policy
secret scoping
tool permissions
cancellation
cleanup
orphan reconciliation
failure classification
```

Target:

> Sandboxes have deliberately restricted capabilities and predictable lifecycle behavior.

---

# 110. Optional Final 2–3 Days

Focus:

```text
OOM tests
CPU runaway tests
secret leakage tests
network/SSRF tests
worker crash + orphan sandbox
load/capacity tests
docs/refactoring
```

---

# 111. End-to-End Demo

A strong Phase 5 demo:

```text
1. Submit 3 runs.
2. Three workers/sandbox slots start containers.
3. Show unique sandbox/container IDs.
4. Show CPU/memory limits.
5. Show agent can use allowed tool.
6. Show disallowed tool request rejected.
7. Show result completes normally.
8. Show containers removed afterward.
```

---

# 112. Resource-Abuse Demo

Run a deliberately bad test workload:

```text
allocates excessive memory
```

Expected:

```text
sandbox OOM-killed
worker remains healthy
other runs continue
run failure classified
sandbox cleaned
```

This is a strong systems demonstration.

---

# 113. Secret-Isolation Demo

Two tenants:

```text
Tenant A → credential A
Tenant B → credential B
```

Show each sandbox receives only its own intended secret set.

---

# 114. Worker Crash + Orphan Demo

Flow:

```text
Worker A starts sandbox
Worker A crashes
lease expires
Worker B recovers run
old sandbox detected as stale
old sandbox terminated/cleaned
```

This connects durable execution and isolation.

---

# 115. Load Test — Sandbox Capacity

Create many queued fake runs.

Measure:

```text
sandbox startup latency
active containers
CPU
memory
worker saturation
queue depth
```

Verify:

```text
worker never exceeds configured sandbox capacity
```

---

# 116. Exit Criteria

Phase 5 is complete only when:

## Sandbox architecture

- [ ] Agent runtime no longer executes directly inside worker process.
- [ ] Dedicated runtime image exists.
- [ ] Worker launches one disposable sandbox per active run.
- [ ] Sandbox manager owns container lifecycle.
- [ ] Worker/runtime protocol is structured and validated.

## Isolation

- [ ] Sandboxes run non-root.
- [ ] Privileged mode is not used.
- [ ] Host network is not used.
- [ ] Docker socket is not mounted.
- [ ] Arbitrary host filesystem access is prevented.
- [ ] Capabilities are minimized.
- [ ] Writable filesystem surface is bounded.

## Resource limits

- [ ] CPU limit enforced.
- [ ] Memory limit enforced.
- [ ] PID/process limit enforced.
- [ ] Runtime timeout enforced.
- [ ] Worker concurrency respects host capacity.
- [ ] OOM behavior is detected and classified.

## Secrets

- [ ] Only required secrets are injected.
- [ ] Cross-tenant secret isolation tested.
- [ ] Secrets are not baked into image.
- [ ] Secrets are not logged.
- [ ] Secret references remain separate from raw secret values.

## Tool/network security

- [ ] Tool allowlists still enforced.
- [ ] Tool argument validation still enforced.
- [ ] Network access model is documented.
- [ ] Internal/metadata endpoint exposure considered.
- [ ] SSRF behavior tested where relevant.
- [ ] Arbitrary network access is not accidentally granted.

## Lifecycle

- [ ] Startup timeout implemented.
- [ ] Graceful cancellation implemented.
- [ ] Hard kill fallback implemented.
- [ ] Cleanup works on success.
- [ ] Cleanup works on failure.
- [ ] Cleanup works on cancellation.
- [ ] Cleanup is idempotent.
- [ ] Orphan sandbox reconciliation exists.

## Failure testing

- [ ] Memory exhaustion test passes.
- [ ] CPU runaway test passes.
- [ ] Container crash test passes.
- [ ] Worker crash/orphan test passes.
- [ ] Docker startup failure test passes.
- [ ] Secret isolation test passes.
- [ ] Network policy test passes where applicable.
- [ ] Cleanup failure behavior documented/tested.

## Engineering

- [ ] Structured logs include sandbox context.
- [ ] Metrics expose sandbox lifecycle/resource failures.
- [ ] CI builds runtime image.
- [ ] Docker-based integration tests run where feasible.
- [ ] Health/readiness reflects Docker capability.
- [ ] Graceful shutdown drains/terminates sandboxes correctly.
- [ ] Documentation matches actual isolation model.

---

# 117. Explicitly Out of Scope

Do not add:

- Kubernetes,
- EKS,
- Firecracker/microVMs,
- gVisor,
- custom container runtime,
- service mesh,
- full zero-trust network platform,
- custom eBPF security system,
- SELinux policy authoring from scratch,
- multi-region sandbox scheduling,
- GPU isolation/scheduling,
- production AWS deployment,
- Terraform production infrastructure,
- full OpenTelemetry tracing,
- final Grafana dashboards,
- billing,
- arbitrary user-supplied container images,
- remote code execution as a general product feature.

These belong to later phases or future work.

---

# 118. Things We Should Resist

Do not turn Phase 5 into:

```text
"Build a secure cloud VM platform."
```

Helmrun v1 needs:

- practical isolation,
- bounded resources,
- controlled secrets,
- controlled tools,
- safe cleanup.

It does not need:

- a hypervisor,
- a kernel sandbox,
- custom seccomp compiler,
- full container orchestration system.

---

# 119. Core Phase 5 Invariants

### Invariant 1 — Worker is not the sandbox

Agent workload does not execute directly inside worker process.

### Invariant 2 — Sandboxes are disposable

No run relies on long-lived local sandbox state for durability.

### Invariant 3 — Resources are bounded

A single run cannot consume unlimited CPU, memory, processes, or execution time.

### Invariant 4 — Secrets are scoped

Sandbox receives only credentials required for that execution.

### Invariant 5 — Tool permissions remain authoritative

Container isolation does not replace logical authorization.

### Invariant 6 — Cleanup is mandatory

Terminal executions must not intentionally leave active sandboxes behind.

### Invariant 7 — Stale sandboxes cannot become authoritative

Phase 4 fencing tokens still protect durable state.

### Invariant 8 — Host trust boundary stays intact

No Docker socket, privileged mode, host network, or arbitrary host filesystem access.

---

# 120. Definition of Done

Phase 5 is successful when:

> Helmrun executes every agent run inside a disposable Docker sandbox with explicit CPU, memory, process and time limits; uses non-root and reduced-privilege execution; scopes secrets and tool capabilities to the run; controls filesystem and network exposure; safely propagates cancellation; detects OOM/crash/resource failures; cleans up sandboxes after all terminal paths; reconciles stale containers after worker crashes; and proves these guarantees through security- and resource-oriented failure tests.

At that point Helmrun has:

```text
durable
distributed
isolated
agent execution
```

The next phase can focus on making that system **visible and operable** through streaming, logs, metrics, traces, and dashboards.
