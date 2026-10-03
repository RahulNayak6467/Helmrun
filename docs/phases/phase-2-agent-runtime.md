# Helmrun Phase 2 — Agent Runtime & Local Execution

## Phase Status

Phase 2 builds the first real execution engine of Helmrun.

Phase 1 created a trustworthy control plane:

- tenants,
- API keys,
- agents,
- immutable agent versions,
- durable run records,
- tenant isolation,
- PostgreSQL-backed APIs.

Phase 2 answers the next question:

> Given a run and an immutable agent version, can Helmrun actually execute the agent correctly?

This phase introduces:

- the custom TypeScript agent runtime,
- LLM provider abstraction,
- OpenAI / Anthropic / Gemini adapters,
- model request/response normalization,
- tool calling,
- MCP integration,
- execution state,
- local run execution,
- cancellation,
- execution timeouts,
- structured outputs,
- provider failure handling,
- usage accounting basics.

This phase intentionally keeps execution **local/simple**.

It does **not** yet introduce distributed workers, SQS scheduling, leases, heartbeats, crash recovery, or durable checkpoint recovery.

---

# 1. Phase Goal

At the end of Phase 2, Helmrun should support this end-to-end path:

```text
Developer
   │
   │ POST /runs
   ▼
Control Plane
   │
   ▼
Run persisted in PostgreSQL
   │
   ▼
Local Execution Trigger
   │
   ▼
Agent Runtime
   │
   ├── load immutable agent version
   ├── build model request
   ├── call LLM provider
   ├── inspect response
   ├── execute tool if requested
   ├── feed tool result back
   └── stop on final response
            │
            ▼
       Final Result
            │
            ▼
       PostgreSQL
```

The target is:

> A developer can define an agent, start a run, and observe Helmrun execute a real multi-step agent loop using LLMs and tools.

---

# 2. Estimated Duration

Recommended:

```text
2 to 2.5 weeks
```

Approximate total effort:

```text
45–60 hours
```

Suggested split:

| Area | Approx. hours |
|---|---:|
| LLM/provider theory | 5–7 h |
| Agent runtime theory/design | 5–7 h |
| Provider abstraction/adapters | 8–10 h |
| Runtime loop | 8–10 h |
| Tool/MCP layer | 7–9 h |
| Execution state + cancellation/timeouts | 5–7 h |
| Tests/failure experiments | 5–7 h |
| Docs/refactoring | 3–4 h |

---

# 3. What Phase 2 Adds

Phase 1:

```text
API
 ↓
PostgreSQL
 ↓
Run = QUEUED
```

Phase 2:

```text
API
 ↓
PostgreSQL
 ↓
Run
 ↓
Agent Runtime
 ↓
LLM
 ↓
Tools / MCP
 ↓
Final Result
```

Helmrun now stops being only a control-plane backend and becomes an actual **agent execution platform prototype**.

---

# 4. Frozen vs Conceptual

## Frozen architectural direction

The following are considered part of the Helmrun v1 direction:

- Helmrun owns a custom TypeScript agent runtime.
- Agent versions remain immutable.
- Runs execute against a pinned agent version.
- LLM providers are accessed through a provider abstraction.
- OpenAI, Anthropic, and Gemini should be supported through adapters.
- Tool calls are validated before execution.
- MCP is the primary standardized tool integration path.
- Runtime execution state is explicit.
- LLM/provider failures are normalized into Helmrun-level errors.
- Tool execution has explicit timeout/failure semantics.
- Usage information is captured where available.
- The runtime must support cancellation.
- The runtime must have explicit termination conditions.
- The runtime must not execute arbitrary business logic in Express route handlers.

## Conceptual / not frozen

The following are intentionally flexible:

- exact runtime class/function structure,
- exact provider interface,
- exact normalized message format,
- exact internal tool-call format,
- exact MCP client implementation,
- exact execution event schema,
- exact maximum step count,
- exact timeout values,
- exact model retry policy,
- exact structured-output abstraction,
- exact result schema,
- exact usage table schema,
- exact synchronous/local execution trigger.

These should be refined during implementation.

---

# 5. Architectural Boundary

The control plane should not become the agent runtime.

Conceptually:

```text
apps/api
   │
   │ create/load run
   ▼
packages/agent-runtime
   │
   ├── model-providers
   ├── tool-protocol
   └── execution state
```

A useful dependency direction is:

```text
API
 ↓
Agent Runtime
 ↓
Provider / Tool abstractions
```

The runtime should be usable later by:

```text
Phase 3 Worker
```

without rewriting it.

That is one of the most important design goals of this phase.

---

# 6. Core Runtime Model

A conceptual execution loop:

```text
start
 ↓
load agent version
 ↓
build context
 ↓
call model
 ↓
response?
 ├── final output ──→ complete
 │
 └── tool call
       ↓
   validate tool
       ↓
   authorize tool
       ↓
   execute tool
       ↓
   append result
       ↓
   next model call
```

This loop continues until one of the following occurs:

```text
final response
max steps reached
timeout reached
cancel requested
provider failure
tool failure
invalid model output
internal runtime failure
```

---

# 7. Theory Module A — LLM Request/Response Semantics

Understand:

- messages / turns,
- roles,
- system/developer/user content,
- model responses,
- token usage,
- finish reasons,
- tool/function calling,
- streaming,
- structured output concepts.

Do not spend time on:

- transformer internals,
- training,
- fine-tuning,
- gradient descent,
- attention math.

Helmrun needs **LLM application infrastructure knowledge**, not model-training theory.

---

# 8. Theory Module B — Provider Differences

Study practical differences among:

```text
OpenAI
Anthropic
Gemini
```

Understand that each provider may differ in:

- message format,
- tool-call format,
- streaming protocol,
- usage metadata,
- error codes,
- rate-limit headers,
- structured output support,
- timeout behavior.

The runtime should not be forced to know all provider-specific details.

---

# 9. Theory Module C — Adapter Pattern

The purpose:

```text
Agent Runtime
      │
      ▼
Normalized Model Interface
   /        |         \
OpenAI   Anthropic   Gemini
```

The runtime should deal with one internal representation.

Example conceptual interface:

```ts
interface ModelProvider {
  generate(
    request: ModelRequest,
    options?: ModelCallOptions,
  ): Promise<ModelResponse>;

  stream?(
    request: ModelRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<ModelEvent>;
}
```

Exact interface is not frozen.

---

# 10. Theory Module D — Agent Loop Design

Understand:

- model → tool → model loops,
- termination,
- maximum steps,
- execution context,
- state accumulation,
- deterministic vs nondeterministic behavior,
- repeated tool calls,
- malformed tool calls,
- runaway loops.

A runtime must never rely on:

```text
"the model will eventually stop"
```

It needs enforced limits.

---

# 11. Theory Module E — Tool Calling

Understand:

- tool schema,
- tool identifier,
- arguments,
- model-requested calls,
- validation,
- execution,
- result normalization,
- error propagation.

Important distinction:

```text
Model requests tool
        ≠
Helmrun blindly executes it
```

Helmrun must validate and authorize the requested operation.

---

# 12. Theory Module F — MCP Fundamentals

Learn:

- MCP client/server concept,
- tool discovery,
- tool metadata,
- tool invocation,
- transport concepts,
- request/response lifecycle,
- error handling.

For Helmrun:

```text
Agent Runtime
    ↓
MCP Client
    ↓
MCP Server
    ↓
External capability
```

Do not implement the MCP protocol yourself if a reliable SDK/library exists.

Focus on:

- integrating it,
- validating it,
- securing it,
- normalizing it.

---

# 13. Theory Module G — Cancellation

Cancellation is not:

```text
set status = CANCELLED
```

The active operation must notice the cancellation request.

Conceptually:

```text
cancel request
    ↓
AbortController / cancellation signal
    ↓
provider call / tool execution / runtime loop
    ↓
stop
```

Understand:

- cooperative cancellation,
- AbortController,
- abort signals,
- cleanup,
- race conditions around completion vs cancellation.

---

# 14. Theory Module H — Timeouts

Every external boundary should have bounded waiting.

Examples:

```text
LLM provider timeout
tool timeout
overall run timeout
```

Understand difference between:

```text
operation timeout
overall execution deadline
```

A tool may get:

```text
30 seconds
```

while the whole run may get:

```text
5 minutes
```

Exact values remain configurable later.

---

# 15. Theory Module I — Retries

Phase 2 should introduce provider retries carefully.

Understand:

- retryable failure,
- permanent failure,
- exponential backoff,
- jitter,
- rate-limit handling,
- network timeout ambiguity.

Do not retry everything.

Potentially retryable:

```text
temporary provider 5xx
some rate limits
transient network errors
```

Usually not retryable:

```text
invalid API key
invalid model
invalid request
malformed tool schema
authorization failure
```

Tool retries are more dangerous because tools may have side effects.

Durable side-effect handling becomes deeper in Phase 4.

---

# 16. Theory Module J — Structured Outputs

Understand:

- JSON/schema-constrained responses,
- parsing,
- schema validation,
- malformed output,
- provider-specific structured-output support.

Helmrun should normalize the result for callers where practical.

Do not assume:

```text
model says JSON
```

means:

```text
valid JSON
```

unless the provider guarantees constrained output.

---

# 17. Theory Module K — Token/Usage Accounting

Understand provider-reported usage:

```text
input tokens
output tokens
cached tokens if available
reasoning tokens if available
```

Helmrun should capture normalized usage where possible.

This phase does not build full billing.

---

# 18. Phase 2 Implementation Sequence

Recommended order:

```text
1. define internal runtime contracts
2. implement provider abstraction
3. build one provider adapter first
4. implement simple single-turn runtime
5. implement tool-call loop
6. implement local tool registry
7. integrate MCP
8. add second/third providers
9. add cancellation/timeouts
10. add normalized usage
11. add structured outputs
12. add execution result persistence
13. add tests/failure experiments
14. refactor/docs
```

Do not build all provider adapters before proving the runtime with one provider.

---

# 19. Step 1 — Internal Model Types

Create normalized internal types.

Conceptually:

```ts
type RuntimeMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
};

type ToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

type ModelResponse = {
  content?: unknown;
  toolCalls?: ToolCall[];
  finishReason: string;
  usage?: ModelUsage;
};
```

Exact shape is conceptual.

The goal is:

> provider-specific response objects should not leak through the runtime.

---

# 20. Step 2 — Provider Registry

A registry may resolve configured providers.

Conceptually:

```text
agent version
    │
    │ provider = "openai"
    ▼
ProviderRegistry
    │
    ▼
OpenAIProvider
```

Possible interface:

```ts
interface ModelProviderRegistry {
  get(provider: ModelProviderName): ModelProvider;
}
```

Avoid giant `switch` statements scattered throughout runtime code.

---

# 21. Step 3 — First Provider Adapter

Start with one provider.

For example:

```text
OpenAI
```

Implement:

- request conversion,
- response conversion,
- tool-call conversion,
- timeout support,
- cancellation support,
- error normalization,
- usage normalization.

Only after the runtime works correctly should additional adapters be added.

---

# 22. Provider Error Normalization

Provider-specific errors should become Helmrun errors.

Conceptually:

```text
OpenAI 429
Anthropic rate limit
Gemini resource exhausted
        │
        ▼
ProviderRateLimitError
```

Other useful categories:

```text
ProviderAuthenticationError
ProviderRateLimitError
ProviderTimeoutError
ProviderUnavailableError
ProviderInvalidRequestError
ProviderResponseError
```

Exact names are conceptual.

---

# 23. Step 4 — Single-Turn Runtime

Before tools, prove the smallest path:

```text
Run
 ↓
Agent Version
 ↓
ModelProvider.generate()
 ↓
Final Output
 ↓
Run completed
```

This establishes:

- agent config loading,
- provider resolution,
- model call,
- error mapping,
- result persistence.

Do not jump directly into complex multi-tool agents.

---

# 24. Step 5 — Runtime State

The runtime should carry explicit state.

Conceptually:

```ts
type RuntimeState = {
  runId: string;
  tenantId: string;
  agentVersionId: string;

  step: number;

  messages: RuntimeMessage[];

  startedAt: Date;

  usage: RuntimeUsage;
};
```

Later phases may make this state checkpointable.

For now, make state explicit enough that it can eventually be serialized.

That future compatibility matters.

---

# 25. Step 6 — Maximum Steps

Introduce a hard bound.

Conceptually:

```text
maxSteps = 20
```

Then:

```text
for each step:
    if step >= maxSteps:
        fail with execution limit
```

Exact value is not frozen.

This prevents:

```text
LLM
 ↓
tool
 ↓
LLM
 ↓
tool
 ↓
...
forever
```

---

# 26. Step 7 — Local Tool Registry

Before MCP, build a simple internal tool abstraction.

Conceptually:

```ts
interface Tool {
  name: string;
  description: string;
  inputSchema: unknown;

  execute(
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolResult>;
}
```

Example development tools:

```text
calculator
echo
current_time mock
simple HTTP fetch mock
```

Avoid dangerous production tools initially.

---

# 27. Tool Registry

Conceptually:

```text
ToolRegistry
│
├── calculator
├── echo
└── ...
```

The runtime:

```text
model requests "calculator"
        ↓
ToolRegistry.get("calculator")
        ↓
validate arguments
        ↓
execute
```

The registry should reject unknown tools.

---

# 28. Tool Authorization

An agent version should declare which tools it is allowed to use.

Conceptually:

```text
Agent Version
  allowedTools:
  - calculator
  - github.read
```

If model requests:

```text
payments.send
```

but it is not allowed:

```text
ToolNotAuthorizedError
```

This rule must exist before broad external tool integration.

---

# 29. Tool Argument Validation

Every tool invocation should validate the model-provided arguments.

Conceptually:

```text
Model Tool Call
      ↓
JSON / object
      ↓
Zod / schema validation
      ↓
Tool
```

Never assume model-generated arguments are valid.

---

# 30. Tool Execution Timeouts

Each tool call should be bounded.

Conceptually:

```text
tool.execute(...)
      │
      ├── returns → continue
      │
      └── timeout → ToolTimeoutError
```

A hung tool should not hang the entire runtime indefinitely.

---

# 31. Tool Error Model

Distinguish:

```text
ToolValidationError
ToolNotFoundError
ToolNotAuthorizedError
ToolTimeoutError
ToolExecutionError
```

The runtime then decides whether:

```text
fail run
```

or perhaps:

```text
send controlled tool error back to model
```

Exact policy should be documented per tool category.

---

# 32. Step 8 — Multi-Step Agent Loop

Now combine model and tools.

Conceptual pseudo-code:

```ts
while (state.step < limits.maxSteps) {
  throwIfCancelled(signal);

  const response = await model.generate({
    messages: state.messages,
    tools: availableTools,
  });

  accumulateUsage(state, response.usage);

  if (response.toolCalls?.length) {
    const results = await executeToolCalls(
      response.toolCalls,
      context,
      signal,
    );

    appendToolResults(state, results);
    state.step++;
    continue;
  }

  return complete(response);
}

throw new MaxStepsExceededError();
```

This is conceptual.

Production code will likely split responsibilities more cleanly.

---

# 33. Multiple Tool Calls

Some providers may return multiple tool calls.

Decide deliberately whether to execute them:

```text
sequentially
```

or:

```text
in parallel
```

For Phase 2, sequential execution is simpler and safer unless tools are explicitly independent.

Parallel tool execution adds:

- concurrency,
- cancellation complexity,
- ordering semantics,
- rate-limit pressure.

Do not add it purely for speed.

---

# 34. Step 9 — MCP Integration

Once local tools work, introduce MCP.

Conceptually:

```text
Agent Runtime
    │
    ▼
Tool Registry
    │
    ├── local tools
    │
    └── MCP tool adapters
            │
            ▼
        MCP Client
            │
            ▼
        MCP Server
```

MCP tools should still flow through the same Helmrun controls:

```text
tool allowlist
argument validation
timeouts
cancellation
logging
error normalization
```

MCP must not bypass runtime policy.

---

# 35. MCP Tool Discovery

Helmrun may query MCP servers for available tools.

However, do not automatically expose every discovered tool to every agent.

Flow:

```text
MCP discovers tools
       ↓
Helmrun registers metadata
       ↓
Agent version explicitly allows subset
       ↓
Runtime exposes allowed tools to model
```

This preserves least privilege.

---

# 36. Step 10 — Additional Provider Adapters

After the runtime works with one provider, add:

```text
Anthropic
Gemini
```

Each adapter must satisfy the same conformance tests.

Do not implement custom runtime logic for each provider.

If provider-specific capability differs, represent capability explicitly.

Conceptually:

```ts
type ProviderCapabilities = {
  streaming: boolean;
  tools: boolean;
  structuredOutput: boolean;
};
```

Exact structure remains flexible.

---

# 37. Provider Conformance Tests

Every provider adapter should pass the same conceptual contract:

```text
normal text response
tool call response
usage normalization
timeout handling
cancellation
authentication error
rate limit error
invalid request
provider 5xx
```

Mock provider responses where practical.

Live-provider integration tests should be limited and controlled because they cost money and may be nondeterministic.

---

# 38. Step 11 — Structured Outputs

Allow an agent version to request a structured result.

Conceptually:

```text
Agent Version
  outputSchema
        ↓
Model
        ↓
Structured Output
        ↓
validate
        ↓
final result
```

If schema validation fails:

```text
StructuredOutputValidationError
```

Whether Helmrun retries once or fails immediately should be a documented policy.

Do not create an elaborate schema-repair system yet.

---

# 39. Step 12 — Cancellation

Phase 2 should support cancellation for an actively running local execution.

Conceptually:

```text
POST /runs/:runId/cancel
        ↓
mark cancellation requested
        ↓
active runtime receives abort signal
        ↓
provider/tool call aborts if supported
        ↓
runtime stops
        ↓
run terminal state
```

Exact run states remain conceptual.

This phase can keep cancellation coordination in-process.

Phase 3/4 will redesign it for distributed workers.

---

# 40. Cancellation Race

Consider:

```text
run completes
   │
   └── at same moment
        cancel arrives
```

The final state should be decided with an atomic transition.

Avoid arbitrary:

```text
last write wins
```

without thought.

This is a useful database concurrency exercise.

---

# 41. Step 13 — Overall Run Deadline

A run should have an overall deadline.

Conceptually:

```text
start time
   +
max runtime
   =
deadline
```

Before each major operation:

```text
check deadline
```

The overall deadline should propagate into:

```text
provider timeout
tool timeout
```

so a tool cannot receive more time than the remaining run budget.

---

# 42. Step 14 — Usage Tracking

Capture normalized usage:

```text
input tokens
output tokens
total tokens
provider
model
number of model calls
number of tool calls
```

Potential persistence:

```text
run_usage
```

or columns/JSON in run metadata initially.

Do not build billing yet.

---

# 43. Step 15 — Run Result Persistence

On successful local execution:

```text
Agent Runtime
      ↓
Final Result
      ↓
PostgreSQL
```

Store:

- completion status,
- result metadata,
- timestamps,
- normalized usage,
- failure metadata if relevant.

Large artifacts remain a later concern unless Phase 2 needs a small proof.

---

# 44. Run Failure Persistence

A failed execution should not only throw an exception.

Persist controlled failure metadata.

Conceptually:

```text
status = FAILED

failure_code
failure_category
failure_message
failed_at
```

Do not store raw provider stack traces as user-facing failure messages.

Internal logs can contain richer details, subject to secret filtering.

---

# 45. Execution Events

Phase 2 should introduce an internal execution event vocabulary even though SSE delivery comes later.

Examples:

```text
run.started
model.call.started
model.call.completed
tool.call.started
tool.call.completed
run.completed
run.failed
run.cancelled
```

These may initially be:

```text
logs
internal callbacks
in-memory event emitter
```

Do not overbuild durable event storage yet.

The goal is to make the runtime observable and prepare for Phase 6.

---

# 46. Logging Updates

Phase 2 should extend structured context with:

```text
runId
agentId
agentVersionId
provider
model
step
toolName
toolCallId
attempt if relevant
```

Example:

```ts
logger.info(
  {
    runId,
    provider,
    model,
    step,
  },
  "model call completed"
);
```

Do not log:

- provider API keys,
- Authorization headers,
- full secret-bearing tool arguments,
- raw sensitive prompts by default.

Prompt logging policy should be conservative.

---

# 47. Provider Secret Handling

Provider credentials should come from configuration / secret-management abstraction.

During local development:

```text
environment variables
```

Later:

```text
AWS Secrets Manager
```

Runtime code should not read environment variables directly everywhere.

Use a central configuration/provider credential layer.

---

# 48. Security Baseline for Tools

Phase 2 is not the full sandbox-security phase, but basic safeguards are required.

At minimum:

- agent tool allowlist,
- validated arguments,
- execution timeout,
- cancellation,
- no arbitrary shell execution,
- no unrestricted filesystem access,
- no secret leakage into logs,
- explicit external HTTP access if implemented.

Do not add generic:

```text
exec(command)
```

as an agent tool.

---

# 49. Caching in Phase 2

Caching is not a mandatory runtime feature.

Potential safe cache candidates:

```text
immutable agent versions
tool metadata
provider metadata
```

Do not cache:

```text
active mutable run state
execution ownership
cancellation truth
```

If caching is introduced, apply the previously agreed production behavior:

- PostgreSQL remains authoritative,
- Redis failures degrade gracefully where possible,
- TTLs are explicit,
- tenant-aware keys,
- metrics/failure testing,
- no correctness dependency on cache.

Do not add caching just to use Redis.

---

# 50. Rate Limits

Phase 1 may already have API rate limiting.

Phase 2 introduces a different concern:

```text
provider rate limits
```

The runtime should:

- normalize provider 429/rate-limit errors,
- retry only where policy permits,
- back off,
- cap retries,
- record provider failures.

Do not build a global provider-capacity scheduler yet.

That belongs later.

---

# 51. Retry Policy

A conceptual provider policy might look like:

```text
max attempts: 3
backoff: exponential
jitter: yes
retry:
  transient network failure
  selected 5xx
  selected rate limit
do not retry:
  invalid API key
  invalid request
  unknown model
```

Exact values remain conceptual.

The important requirement is:

> Retry policy must be centralized and observable, not scattered across provider adapters.

---

# 52. Why Tool Retries Are Different

Suppose:

```text
tool = send_email
```

Tool call succeeds externally.

Then:

```text
network response lost
```

Helmrun cannot know with certainty whether the operation occurred.

Blind retry could send two emails.

Therefore Phase 2 should document:

```text
read-only tools
    ↓
safer to retry

side-effecting tools
    ↓
retry only with idempotency support / explicit policy
```

Full durable side-effect semantics become a major Phase 4 topic.

---

# 53. Database Changes

Phase 2 may extend the existing schema with:

```text
run result fields
run failure fields
usage information
started_at
completed_at
cancel_requested_at
```

Potential separate tables:

```text
run_usage
run_events
```

only if justified.

Do not add:

```text
leases
worker ownership
checkpoints
```

yet.

---

# 54. Run State Changes

Phase 1 may only have:

```text
QUEUED
```

Phase 2 may conceptually need:

```text
QUEUED
RUNNING
COMPLETED
FAILED
CANCELLED
```

These names are not frozen.

The important invariant is:

> State transitions must be explicit and validated.

Avoid:

```ts
updateRun({ status: arbitraryString });
```

from random parts of the codebase.

---

# 55. State Transition Function

Conceptually:

```ts
transitionRun(
  runId,
  fromStatus,
  toStatus,
)
```

backed by conditional SQL.

Example:

```sql
UPDATE runs
SET status = $1
WHERE id = $2
  AND status = $3
RETURNING *;
```

This prepares the system for stronger concurrency control later.

---

# 56. Local Execution Trigger

Phase 2 needs a simple way to start execution after run creation.

Potential approaches:

```text
A. API creates run then schedules in-process async execution
B. explicit development execution endpoint
C. local execution service polls queued runs
```

The exact approach is not frozen.

Choose the simplest mechanism that:

- proves the runtime,
- does not contaminate runtime design,
- can be removed cleanly in Phase 3.

Do not pretend this is the final production scheduling model.

---

# 57. API Request Should Not Block for Entire Agent Run

Even in Phase 2, avoid:

```text
POST /runs
    ↓
hold HTTP request for 5 minutes
    ↓
agent completes
    ↓
return
```

Prefer:

```text
POST /runs
    ↓
persist run
    ↓
202/created response
    ↓
execution begins separately
```

Then:

```text
GET /runs/:id
```

retrieves status/result.

This aligns with the eventual distributed model.

---

# 58. Graceful Shutdown Updates

Phase 2 adds active local executions.

Shutdown must now consider:

```text
stop accepting new requests
       ↓
signal active executions
       ↓
wait for bounded cleanup
       ↓
close provider/tool resources
       ↓
close DB/Redis
       ↓
exit
```

Do not allow:

```text
process exit
```

to silently abandon in-memory executions without recording their state.

For Phase 2, document the limitation because durable recovery arrives later.

---

# 59. Testing Strategy

Phase 2 should include:

```text
unit tests
runtime contract tests
provider adapter tests
tool tests
API integration tests
failure tests
cancellation tests
concurrency tests
small load tests
```

Avoid relying only on live LLM calls.

---

# 60. Fake Model Provider

Create a deterministic test provider.

Conceptually:

```ts
class FakeModelProvider implements ModelProvider {
  // returns scripted responses
}
```

It should be able to produce:

```text
final response
tool request
multiple tool requests
provider error
rate limit
timeout
malformed response
```

This makes runtime tests deterministic.

---

# 61. Fake Tools

Create test tools such as:

```text
echo
add
slow_tool
failing_tool
side_effect_counter
```

These allow testing:

- normal tool calls,
- timeouts,
- failures,
- cancellation,
- repeated calls.

---

# 62. Runtime Loop Tests

Test:

```text
single model call completes
model requests tool
tool result returns to model
multi-step loop completes
unknown tool rejected
unauthorized tool rejected
invalid tool args rejected
max steps exceeded
overall timeout reached
provider timeout
provider rate limit
provider permanent error
tool timeout
tool execution error
cancellation during model call
cancellation during tool call
```

---

# 63. Provider Adapter Tests

For each provider:

```text
request normalization
response normalization
tool-call normalization
usage normalization
error normalization
timeout
cancellation
```

Use mocked HTTP/SDK responses where possible.

---

# 64. Structured Output Tests

Test:

```text
valid structured response
invalid JSON
valid JSON wrong schema
provider refuses request
schema validation failure
```

---

# 65. Run State Tests

Test allowed transitions.

For example:

```text
QUEUED → RUNNING
RUNNING → COMPLETED
RUNNING → FAILED
RUNNING → CANCELLED
```

Reject impossible transitions.

Example:

```text
COMPLETED → RUNNING
```

must not silently succeed.

Exact state graph can evolve.

---

# 66. Cancellation Concurrency Test

Run:

```text
execution active
```

then race:

```text
completion
vs
cancel
```

Verify exactly one valid terminal state wins.

This is an important correctness test.

---

# 67. Provider Failure Experiment

Simulate:

```text
429 rate limit
500 error
connection reset
timeout
invalid key
malformed response
```

Verify:

- correct error category,
- retry policy,
- bounded retry duration,
- structured logs,
- final run status,
- no secrets leaked.

---

# 68. Tool Failure Experiment

Simulate:

```text
tool hangs
tool throws
tool returns invalid output
tool cancellation
unknown tool
```

Verify the runtime never hangs indefinitely.

---

# 69. Runtime Load Experiment

Do not load-test external providers heavily.

Instead use the fake provider.

Example:

```text
50
100
250
```

concurrent local runs.

Measure:

```text
event-loop lag
memory
CPU
DB pool pressure
average runtime overhead
error rate
```

The goal is to understand the runtime's own overhead.

Distributed scale comes later.

---

# 70. Context Growth Experiment

Agent loops can accumulate large message histories.

Create a synthetic test:

```text
20 steps
large tool outputs
large messages
```

Observe:

```text
memory use
serialized state size
provider request size
latency
```

This prepares later decisions around:

- context truncation,
- summarization,
- artifact references.

Do not build advanced context compression yet unless necessary.

---

# 71. Basic Context Policy

Phase 2 should define simple rules.

For example:

- bounded number of steps,
- reject absurdly large input,
- tool output size limits,
- avoid inserting huge binary payloads into model context.

Large artifacts should eventually go to S3.

---

# 72. Tool Output Size Limits

A tool could return:

```text
100 MB
```

The runtime should not blindly append that to context.

Introduce an upper bound.

Possible behavior:

```text
small output
  ↓
append directly

large output
  ↓
truncate / summarize / store externally later
```

Exact policy remains conceptual.

---

# 73. OpenAPI Updates

Phase 2 may add/extend:

```text
POST /runs
GET  /runs/:runId
POST /runs/:runId/cancel
```

Run response now includes execution-relevant data such as:

```text
status
startedAt
completedAt
result
failure
usage
```

Exact shape remains flexible.

---

# 74. Error Model Updates

Add runtime-specific errors.

Possible categories:

```text
RunAlreadyStartedError
RunNotCancellableError

ProviderAuthenticationError
ProviderRateLimitError
ProviderTimeoutError
ProviderUnavailableError
ProviderResponseError

ToolNotFoundError
ToolNotAuthorizedError
ToolValidationError
ToolTimeoutError
ToolExecutionError

StructuredOutputValidationError
MaxStepsExceededError
RunTimeoutError
RunCancelledError
```

Do not expose raw provider SDK errors directly to clients.

---

# 75. Configuration Updates

Phase 2 may add:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GEMINI_API_KEY

DEFAULT_MODEL_TIMEOUT_MS
DEFAULT_TOOL_TIMEOUT_MS
DEFAULT_RUN_TIMEOUT_MS
DEFAULT_MAX_AGENT_STEPS
```

Exact names/values are conceptual.

Validate all startup configuration.

If a provider is optional, absence of its API key should not necessarily make the entire API fail startup.

Capability should degrade intentionally.

---

# 76. Logging Updates

Add:

```text
provider
model
runtimeStep
toolName
toolCallId
finishReason
usage
```

Avoid logging sensitive model/tool payloads by default.

Consider a development-only verbose mode if useful.

---

# 77. CI Updates

Phase 2 CI should add:

```text
runtime unit tests
provider contract tests
tool contract tests
cancellation tests
integration tests
```

Live-provider tests should not run on every PR unless cost and reliability are controlled.

A possible split:

```text
PR CI
  → deterministic fake-provider tests

scheduled/manual integration
  → limited live-provider tests
```

---

# 78. Documentation Updates

Add or extend:

```text
docs/
├── architecture.md
├── agent-runtime.md
├── model-providers.md
├── tools.md
├── mcp.md
├── run-lifecycle.md
└── failure-model.md
```

Document:

- runtime loop,
- provider abstraction,
- tool execution path,
- cancellation semantics,
- timeout semantics,
- retry policy,
- current limitations,
- state transitions.

---

# 79. Phase 0/1 Living Infrastructure Updates

The existing foundation must evolve.

## Database

Update:

- run execution columns,
- usage/result persistence,
- state transition queries,
- migrations,
- integration fixtures.

## Configuration

Add provider/runtime settings.

## Logging

Add runtime/provider/tool execution context.

## Error model

Add provider/tool/runtime errors.

## Tests

Add:

- runtime,
- provider,
- tool,
- cancellation,
- timeout,
- state transition,
- load/failure tests.

## CI

Add deterministic runtime contract tests.

## Docker/local development

Add any MCP test servers or supporting dev services if required.

## Health/readiness

Do not make external LLM providers mandatory for API readiness unless the design explicitly requires it.

Potentially expose capability status separately.

## OpenAPI

Update run/cancel/result endpoints.

## Documentation

Add runtime/provider/tool design docs.

## Shared packages

This phase likely introduces:

```text
packages/agent-runtime
packages/model-providers
packages/tool-protocol
```

## Graceful shutdown

Extend it for active executions.

## Failure testing

Add provider/tool/cancellation/timeouts.

---

# 80. Suggested Package Structure

Conceptually:

```text
packages/
│
├── agent-runtime/
│   ├── runtime.ts
│   ├── runtime-state.ts
│   ├── runtime-errors.ts
│   ├── execution-limits.ts
│   └── events.ts
│
├── model-providers/
│   ├── provider.ts
│   ├── registry.ts
│   ├── openai.provider.ts
│   ├── anthropic.provider.ts
│   ├── gemini.provider.ts
│   ├── provider-errors.ts
│   └── provider-types.ts
│
└── tool-protocol/
    ├── tool.ts
    ├── registry.ts
    ├── tool-errors.ts
    ├── validation.ts
    └── mcp/
```

Exact files are not frozen.

Avoid over-splitting.

---

# 81. Suggested Week 1

Focus:

```text
provider theory
runtime contracts
one provider adapter
single-turn execution
runtime state
error normalization
usage capture
```

Target:

> A real run can call one provider and persist a final response.

---

# 82. Suggested Week 2

Focus:

```text
tool abstraction
tool registry
tool validation
multi-step loop
MCP
cancellation
timeouts
state transitions
```

Target:

> A real run can use one or more tools and complete through the runtime.

---

# 83. Optional Final 2–3 Days

Focus:

```text
Anthropic/Gemini adapters
structured outputs
provider conformance tests
failure experiments
load baseline
documentation
refactoring
```

---

# 84. End-to-End Demo

A good demo:

```text
Agent:
"Research Assistant"

Allowed tools:
- calculator
- MCP search tool

Model:
OpenAI / Anthropic / Gemini

Input:
"Find X, calculate Y, and return structured JSON."
```

Flow:

```text
create run
   ↓
runtime starts
   ↓
LLM requests search
   ↓
MCP tool executes
   ↓
tool result returned
   ↓
LLM requests calculator
   ↓
calculator executes
   ↓
LLM produces final structured output
   ↓
result validated
   ↓
run COMPLETED
```

Then retrieve:

```text
status
result
model usage
tool-call count
timings
```

---

# 85. Mandatory Failure Demo

Also demonstrate:

```text
Provider timeout
      ↓
bounded failure

Tool hangs
      ↓
tool timeout

Unknown tool
      ↓
rejected

Invalid tool args
      ↓
validation error

Infinite agent loop
      ↓
max steps

Cancel active run
      ↓
runtime stops

Provider rate limit
      ↓
bounded retry / controlled failure
```

---

# 86. Exit Criteria

Phase 2 is complete only when the following are true.

## Runtime

- [ ] Custom TypeScript runtime exists.
- [ ] Runtime is independent from Express.
- [ ] Runtime state is explicit.
- [ ] Maximum steps are enforced.
- [ ] Overall execution timeout exists.
- [ ] Cancellation works.
- [ ] Terminal results are persisted.

## Providers

- [ ] Provider abstraction exists.
- [ ] One provider works end-to-end first.
- [ ] OpenAI adapter works.
- [ ] Anthropic adapter works.
- [ ] Gemini adapter works.
- [ ] Provider errors are normalized.
- [ ] Usage is normalized.
- [ ] Provider timeouts work.
- [ ] Provider cancellation works where supported.
- [ ] Contract tests cover adapters.

## Tools

- [ ] Tool abstraction exists.
- [ ] Tool registry exists.
- [ ] Tool allowlists are enforced.
- [ ] Tool input is validated.
- [ ] Tool timeouts exist.
- [ ] Tool failures are normalized.
- [ ] MCP tool invocation works.
- [ ] Unknown/unauthorized tools are rejected.

## Run lifecycle

- [ ] Run can transition into active execution.
- [ ] Run can complete.
- [ ] Run can fail.
- [ ] Run can be cancelled.
- [ ] Invalid state transitions are rejected.
- [ ] Completion-vs-cancel race is tested.

## Structured output

- [ ] Structured result validation works.
- [ ] Invalid structured output has controlled behavior.

## Reliability

- [ ] Provider timeout test passes.
- [ ] Provider 429/5xx tests pass.
- [ ] Tool timeout test passes.
- [ ] Tool failure test passes.
- [ ] Max-step protection works.
- [ ] Runtime load baseline performed.
- [ ] No runtime path can wait indefinitely.

## Engineering

- [ ] Structured logs contain run/provider/tool context.
- [ ] Secrets are excluded from logs.
- [ ] OpenAPI reflects runtime endpoints.
- [ ] CI runs deterministic runtime tests.
- [ ] Graceful shutdown handles active executions.
- [ ] Documentation reflects actual implementation.

---

# 87. Explicitly Out of Scope

Do not add:

- AWS SQS execution queue,
- distributed scheduler,
- worker fleet,
- worker claiming,
- execution leases,
- heartbeats,
- visibility-timeout coordination,
- crash recovery,
- checkpoint recovery,
- durable tool side-effect orchestration,
- Docker sandbox isolation,
- Kubernetes,
- SSE client streaming,
- Prometheus/Grafana stack,
- full OpenTelemetry tracing,
- AWS deployment,
- Terraform,
- billing,
- sophisticated provider load balancing,
- provider failover,
- distributed rate limiting for model calls,
- Kafka,
- gRPC,
- advanced RAG,
- vector search.

These belong to later phases.

---

# 88. Things We Should Resist

Do not turn Phase 2 into:

```text
"Build LangChain from scratch."
```

Avoid:

- arbitrary workflow DAGs,
- planner/executor frameworks,
- memory frameworks,
- multi-agent collaboration,
- reflection loops,
- autonomous browser agents,
- dozens of tool types,
- provider-specific runtime branches,
- custom prompt DSL,
- advanced context compression,
- model-routing algorithms.

Helmrun's Phase 2 goal is a **clean, reliable execution primitive**.

---

# 89. Definition of Done

Phase 2 is successful when:

> Helmrun can load a tenant-owned immutable agent version, execute it through a provider-independent TypeScript runtime, safely process model/tool loops including MCP tools, enforce limits, cancellation, validation and timeouts, normalize provider/tool failures, persist final results and usage, and prove the behavior through deterministic failure and concurrency tests.

At that point, the execution engine is good enough to move out of the API process and into the distributed architecture of Phase 3.
