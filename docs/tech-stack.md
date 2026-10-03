# Helmrun — Tech Stack

> **Scope:** Resume-ready Helmrun v1. Kubernetes is intentionally excluded from the initial 5-month milestone and can be added as a later infrastructure upgrade.

---

## 1. Core Backend

| Technology | Role in Helmrun |
|---|---|
| **TypeScript** | Primary language for the control plane, scheduler, workers, runtime, SDK, and CLI |
| **Node.js** | Runtime for backend services and the agent execution runtime |
| **Express.js** | REST API and SSE endpoints for the control plane |
| **Zod** | Runtime validation for API requests, configuration, tool inputs, and structured data |
| **OpenAPI** | API contract and documentation |
| **pnpm Workspaces** | Monorepo/package management |

### Backend responsibilities

- Authentication and authorization
- Agent definitions and versioning
- Run creation and lifecycle management
- Scheduling
- Quotas and concurrency limits
- Execution status
- Cancellation
- Usage accounting
- SSE event streaming

---

## 2. Database

### PostgreSQL

**Library:** `pg` / node-postgres  
**Access style:** Raw SQL

PostgreSQL is the **durable source of truth** for Helmrun.

Stores:

- Users
- Organizations / tenants
- Projects
- API keys
- Agent definitions
- Agent versions
- Runs
- Run steps
- Run state
- Worker ownership
- Lease information
- Checkpoint metadata
- Usage information
- Audit information

### PostgreSQL concepts used

- Relational schema design
- Primary and foreign keys
- Constraints
- Indexes
- Composite / partial indexes
- Transactions
- Isolation levels
- MVCC
- Row locking
- Atomic conditional updates
- Optimistic concurrency
- Connection pooling
- Query plans / `EXPLAIN ANALYZE`
- Parameterized SQL
- Schema migrations

---

## 3. Redis

Redis is used only for **fast, ephemeral state**. It is **not** the durable source of truth.

Uses:

- Rate limiting
- Concurrency counters
- Worker heartbeat information
- Short-lived coordination state
- Caching
- Temporary locks where appropriate
- SSE event distribution using Pub/Sub

Important principle:

```text
PostgreSQL = durable truth
Redis      = fast ephemeral state
```

---

## 4. Execution Queue

### AWS SQS

SQS transports execution jobs from the scheduler to workers.

Typical message:

```json
{
  "runId": "run_123"
}
```

The complete agent definition should not need to live inside the queue message. Workers load authoritative execution information using the `runId`.

Concepts used:

- Producer / consumer architecture
- Long polling
- Visibility timeout
- At-least-once delivery
- Duplicate delivery
- Idempotent consumers
- Retry policies
- Dead-letter queues
- Backpressure
- Poison messages

---

## 5. Agent Runtime

### Custom TypeScript Agent Runtime

Helmrun contains a lightweight runtime responsible for actually executing an agent.

Responsibilities:

- Agent execution loop
- Conversation/context state
- Model calls
- Structured outputs
- Tool calls
- Tool-result handling
- Runtime events
- Cancellation
- Timeouts
- Checkpointing
- Error handling

High-level loop:

```text
Input
  ↓
LLM
  ↓
Tool requested?
  ├── No ──→ Final result
  │
  └── Yes
       ↓
   Validate tool
       ↓
   Authorize tool
       ↓
   Execute tool
       ↓
   Tool result
       ↓
      LLM
```

---

## 6. LLM Provider Layer

Helmrun uses a provider abstraction instead of coupling the runtime directly to one model provider.

Example interface:

```ts
interface ModelProvider {
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}
```

Potential adapters:

- OpenAI
- Anthropic
- Gemini

Provider layer responsibilities:

- Request normalization
- Streaming
- Structured outputs
- Tool calling
- Timeouts
- Retries
- Error normalization
- Token accounting
- Usage / cost tracking
- Provider-specific configuration

---

## 7. MCP & Tool Execution

### Model Context Protocol (MCP)

MCP provides a standardized mechanism for connecting agents to external tools and services.

Helmrun responsibilities include:

- MCP client integration
- Tool discovery
- Tool schemas
- Input validation
- Tool permissions
- Tool execution
- Tool-result handling
- Execution tracing

Possible tools:

- Search
- GitHub
- Databases
- Internal APIs
- SaaS services
- Custom MCP servers

---

## 8. Sandboxed Execution

### Docker

Each agent execution should run in an isolated execution environment rather than directly inside the control-plane process.

Worker flow:

```text
Worker
  ↓
Create Docker container
  ↓
Apply resource/security policy
  ↓
Inject scoped configuration
  ↓
Start Agent Runtime
  ↓
Monitor execution
  ↓
Collect result
  ↓
Destroy container
```

Docker responsibilities:

- Process isolation
- Filesystem isolation
- CPU limits
- Memory limits
- Execution timeout
- Network restrictions
- Scoped credentials
- Cleanup

---

## 9. Object Storage

### Amazon S3

S3 stores large or blob-oriented data.

Examples:

- Agent artifacts
- Uploaded files
- Large tool outputs
- Reports
- Execution archives
- Large checkpoint payloads
- Large final outputs

PostgreSQL stores metadata/references while S3 stores the actual large objects.

---

## 10. Real-Time Event Streaming

### Server-Sent Events (SSE)

SSE streams run progress from Helmrun to developers.

Example events:

```text
run.started
sandbox.started
agent.started
llm.started
llm.completed
tool.started
tool.completed
checkpoint.created
run.failed
run.completed
```

Architecture:

```text
Worker
  ↓
Redis Pub/Sub
  ↓
API instance
  ↓
SSE
  ↓
SDK / Dashboard
```

Concepts:

- `text/event-stream`
- Named events
- Event IDs
- Reconnection
- `Last-Event-ID`
- Heartbeats
- Connection lifecycle
- Proxy buffering
- Multi-instance event distribution

---

## 11. TypeScript SDK

### `@helmrun/sdk`

The SDK is the main programmatic developer interface.

Example:

```ts
import { Helmrun } from "@helmrun/sdk";

const helmrun = new Helmrun({
  apiKey: process.env.HELMRUN_API_KEY
});

const run = await helmrun.agents.run("research-agent", {
  input: "Analyze these repositories"
});
```

Streaming:

```ts
for await (const event of helmrun.runs.stream(run.id)) {
  console.log(event);
}
```

The SDK **does not execute the agent locally**. It communicates with Helmrun's remote execution infrastructure.

---

## 12. CLI

### Commander.js

The CLI should internally reuse the TypeScript SDK.

Example commands:

```bash
helmrun login

helmrun agents list
helmrun agents deploy ./research-agent

helmrun run research-agent --input "Research PostgreSQL changes"

helmrun runs list
helmrun runs inspect run_123
helmrun runs logs run_123
helmrun runs cancel run_123
```

---

## 13. Minimal Dashboard

### Next.js

The dashboard is intentionally secondary to the API, SDK, and CLI.

Possible views:

- Agents
- Agent versions
- Runs
- Run details
- Live execution events
- Tool calls
- Execution traces
- Logs
- Token / cost usage
- Worker health

### Scope rule

Do not turn Helmrun into a frontend-heavy project.

```text
Backend / Cloud / Agent Infrastructure ≈ 90–95%
Dashboard                              ≈ 5–10%
```

---

## 14. Authentication & Authorization

### Authentication

- API keys
- JWT where appropriate
- Secure credential hashing/storage

### Authorization

- RBAC
- Tenant isolation
- Project-level authorization
- Agent permissions
- Tool permissions

Security principle:

```text
Authenticate identity
       ↓
Resolve tenant
       ↓
Authorize resource
       ↓
Check quota/policy
       ↓
Perform operation
```

---

## 15. Observability

### OpenTelemetry

Used for distributed tracing and telemetry instrumentation.

Trace examples:

```text
Run
 ├── scheduling
 ├── queue wait
 ├── worker claim
 ├── sandbox startup
 ├── LLM call
 ├── tool call
 ├── checkpoint
 └── completion
```

### Prometheus

Metrics such as:

- API latency
- Error rate
- Queue depth
- Queue wait time
- Active workers
- Worker utilization
- Running executions
- Execution duration
- LLM latency
- Tool latency
- Retry count
- Failed runs

### Grafana

Used for:

- Dashboards
- Operational visibility
- Performance analysis
- Alerts

### Pino

Structured application logging.

Logs should carry identifiers such as:

- `requestId`
- `tenantId`
- `runId`
- `agentId`
- `workerId`
- `traceId`

---

## 16. AWS Infrastructure

### Initial production infrastructure

| AWS Service | Purpose |
|---|---|
| **EC2 / ECS on EC2** | Run API, scheduler, and worker infrastructure |
| **RDS PostgreSQL** | Managed PostgreSQL |
| **ElastiCache Redis** | Managed Redis |
| **SQS** | Execution queue |
| **S3** | Artifacts and large objects |
| **ECR** | Container image registry |
| **ALB** | Load balancing |
| **VPC** | Network isolation |
| **IAM** | Identity and service permissions |
| **Secrets Manager** | Secret storage |
| **KMS** | Encryption key management |
| **CloudWatch** | AWS-level logs/metrics |
| **Route 53** | DNS |

Key AWS areas to understand:

- IAM
- VPCs
- Public/private subnets
- Route tables
- Security groups
- NAT
- Load balancing
- Service-to-service permissions
- Secrets
- Encryption
- Container deployment

---

## 17. Infrastructure as Code

### Terraform

All major AWS infrastructure should be reproducible through Terraform.

Possible structure:

```text
infrastructure/
└── terraform/
    ├── modules/
    │   ├── networking/
    │   ├── compute/
    │   ├── database/
    │   ├── redis/
    │   ├── queue/
    │   └── storage/
    ├── environments/
    │   ├── dev/
    │   └── prod/
    └── README.md
```

Concepts:

- Providers
- Resources
- Variables
- Outputs
- State
- Remote state
- Modules
- Dependency graph
- Environment separation

---

## 18. CI/CD

### GitHub Actions

Pipeline responsibilities:

```text
Push / PR
   ↓
Lint
   ↓
Typecheck
   ↓
Unit tests
   ↓
Integration tests
   ↓
Build
   ↓
Docker image
   ↓
Push to ECR
   ↓
Deploy
```

Production concerns:

- Environment separation
- Database migrations
- Secrets
- Rollback
- Image versioning

---

## 19. Testing

### Vitest

Used for:

- Unit tests
- Service tests
- Runtime tests
- Scheduler tests
- Provider adapter tests

### Integration Tests

Important integration scenarios:

- API → PostgreSQL
- Scheduler → SQS
- SQS → Worker
- Worker → Docker
- Runtime → provider adapter
- Runtime → MCP tool
- Worker → checkpoint → recovery

### k6

Used for load/performance testing.

Measure:

- Throughput
- p50 / p95 / p99 latency
- Error rate
- Queue delay
- Worker saturation
- Concurrent executions

### Failure Testing

Explicitly test:

- Worker crash
- LLM timeout
- Tool timeout
- Duplicate SQS message
- Redis failure
- Container crash
- Network interruption
- Expired lease
- Partial execution failure

---

# Final Helmrun v1 Stack

```text
LANGUAGE
└── TypeScript

BACKEND
├── Node.js
├── Express.js
├── Zod
└── OpenAPI

DATA
├── PostgreSQL
│   └── pg / raw SQL
├── Redis
└── Amazon S3

MESSAGING
└── AWS SQS

AGENT INFRASTRUCTURE
├── Custom TypeScript Agent Runtime
├── LLM Provider Adapters
├── MCP
└── Docker Sandboxes

STREAMING
├── SSE
└── Redis Pub/Sub

DEVELOPER INTERFACES
├── REST API
├── TypeScript SDK
├── CLI / Commander.js
└── Minimal Next.js Dashboard

OBSERVABILITY
├── OpenTelemetry
├── Prometheus
├── Grafana
└── Pino

CLOUD
├── AWS
│   ├── EC2 / ECS
│   ├── RDS
│   ├── ElastiCache
│   ├── SQS
│   ├── S3
│   ├── ECR
│   ├── ALB
│   ├── VPC
│   ├── IAM
│   ├── Secrets Manager
│   ├── KMS
│   ├── CloudWatch
│   └── Route 53
└── Terraform

CI/CD
└── GitHub Actions

TESTING
├── Vitest
├── Integration tests
├── k6
└── Failure-injection tests
```

---

# Not in Helmrun v1

These technologies/concepts are deliberately excluded from the initial resume-ready milestone:

- Kubernetes / EKS
- Kafka
- gRPC
- Elasticsearch / OpenSearch
- Dedicated vector database
- Advanced RAG
- Multi-region deployment
- GPU scheduling
- Self-hosted model serving
- Service mesh
- Custom container runtime
- Raft / consensus implementation
- Advanced distributed scheduler
- Python SDK/runtime
- Full workflow DAG engine

This prevents Helmrun from becoming a collection of unrelated technologies.

---

# Post-v1 Upgrade

## Kubernetes / EKS

After the resume-ready Helmrun v1 is complete, migrate or extend the execution infrastructure using Kubernetes.

Topics:

- Pods
- Deployments
- Services
- Ingress
- Jobs
- ConfigMaps
- Secrets
- Resource requests/limits
- Liveness/readiness probes
- Horizontal Pod Autoscaling
- Rolling deployments
- RBAC
- Persistent storage
- Kubernetes networking
- Helm
- EKS

Kubernetes should be treated as an **infrastructure evolution of Helmrun**, not a prerequisite for finishing v1.
