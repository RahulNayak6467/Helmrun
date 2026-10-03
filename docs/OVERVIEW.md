# Helmrun — Overview

## A. What Helmrun Is

Helmrun is a distributed platform for running AI agents reliably on managed infrastructure. Developers define an agent, choose its model and tools, and Helmrun handles execution, scheduling, recovery, isolation, scaling, and observability around that agent.

The project is focused on **agent execution infrastructure**, not on building a chatbot, model-training system, or generic AI application.

---

## B. Who Uses It and the Main Flows

Helmrun is primarily for **developers building AI agents** who do not want to build the execution infrastructure themselves.

A typical user flow is:

```text
Create an account / tenant
        ↓
Create an API key
        ↓
Create an agent
        ↓
Create an immutable agent version
        ↓
Configure model + tools
        ↓
Start a run
        ↓
Helmrun queues and schedules it
        ↓
A worker executes it inside an isolated sandbox
        ↓
The user watches live execution events
        ↓
The run completes, fails, or is recovered after a crash
        ↓
The user inspects the result, logs, usage, and execution history
```

Developers can interact with Helmrun through:

- REST API
- TypeScript SDK
- CLI
- Minimal dashboard

The main platform flows are:

### Agent Management

```text
Create Agent
   ↓
Create Version
   ↓
Configure Model / Tools
```

### Run Execution

```text
Create Run
   ↓
Queue
   ↓
Schedule
   ↓
Worker Claim
   ↓
Sandbox
   ↓
Agent Runtime
   ↓
Model / Tool Calls
   ↓
Result
```

### Recovery

```text
Worker crashes
   ↓
Heartbeat stops
   ↓
Lease expires
   ↓
Run is recovered
   ↓
New worker restores checkpoint
   ↓
Execution resumes
```

### Monitoring

```text
Run
 ↓
SSE events
Logs
Metrics
Traces
Dashboard
```

---

## C. In Scope — Helmrun V1

Helmrun V1 includes the following.

### Control Plane

- Multi-tenant architecture
- API-key authentication
- API-key hashing, revocation, and rotation
- RBAC / authorization
- Tenant isolation
- Agent CRUD
- Immutable agent versions
- Run creation and inspection
- Basic quotas
- Rate limiting
- Idempotent run creation
- OpenAPI documentation

### Agent Runtime

- Custom TypeScript agent runtime
- Agent execution loop
- Multi-provider LLM abstraction
- OpenAI support
- Anthropic support
- Google Gemini support
- Tool calling
- MCP integration
- Tool authorization
- Tool argument validation
- Structured outputs
- Timeouts
- Cancellation
- Usage tracking

### Distributed Execution

- Separate scheduler
- AWS SQS execution queue
- Separate worker processes
- Atomic worker claiming
- Bounded worker concurrency
- Backpressure
- Retries
- Dead-letter queue
- Distributed cancellation

### Durable Execution

- Execution attempts
- Leases
- Heartbeats
- Fencing tokens
- Checkpoints
- Checkpoint restoration
- Worker crash recovery
- Stale-worker protection
- Recovery retry limits
- Idempotent state transitions
- Side-effect-aware retry behavior

### Isolation and Security

- Per-run Docker sandbox
- Non-root execution
- CPU limits
- Memory limits
- PID limits
- Execution time limits
- Restricted filesystem access
- Controlled network access
- Scoped secrets
- Tool permissions
- Sandbox cleanup
- Orphan sandbox reconciliation

### Streaming and Observability

- Server-Sent Events for live run events
- Redis Pub/Sub for internal event fan-out
- Structured logging with Pino
- OpenTelemetry tracing
- Prometheus metrics
- Grafana dashboards
- Correlation across API, scheduler, worker, sandbox, model, and tool execution

### Cloud Infrastructure

- AWS deployment
- Amazon EC2
- Amazon ECS where appropriate
- Amazon RDS PostgreSQL
- Amazon ElastiCache Redis
- Amazon SQS
- Amazon S3
- Amazon ECR
- Application Load Balancer
- Amazon VPC
- IAM
- Secrets Manager
- KMS
- CloudWatch
- Route 53
- Terraform
- GitHub Actions CI/CD

### Developer Experience

- REST API
- TypeScript SDK
- CLI
- Minimal dashboard
- Local development environment
- Documentation
- Runbooks
- Load testing
- Failure testing
- Security review
- Deployment and rollback flow

---

## D. Out of Scope — Helmrun V1

The following are deliberately **not part of V1**.

They should not be added while implementing the core project unless the V1 scope is explicitly changed.

### Infrastructure

- Kubernetes
- Amazon EKS
- Helm charts
- Service mesh
- Multi-region deployment
- Cross-region failover
- Global scheduling
- Custom autoscaler
- GPU worker fleets

### Messaging / Distributed Systems

- Kafka
- gRPC purely for architecture complexity
- Custom consensus protocols
- Raft
- Custom distributed log
- Exactly-once guarantees for arbitrary external APIs

### AI / ML

- Model training
- Fine-tuning
- Core ML research
- Self-hosted model inference
- GPU model serving
- Advanced RAG
- Vector database
- Embedding infrastructure
- Advanced multi-agent orchestration
- Full workflow DAG engine

### Security / Isolation

- Firecracker or microVMs
- Custom container runtime
- Custom kernel sandbox
- Custom eBPF security platform
- Enterprise zero-trust platform

### Product Features

- Advanced billing system
- Full payment infrastructure
- Enterprise SSO
- MFA platform
- Complex organization/invitation system
- Visual workflow builder
- Agent marketplace
- Plugin marketplace
- Full consumer authentication product
- Large admin portal

### Observability

- Custom logging backend
- Custom tracing backend
- Elasticsearch/OpenSearch logging platform
- Full enterprise alert-routing system

### General Rule

If a feature does not directly improve one of these:

```text
execution
reliability
isolation
security
observability
developer experience
cloud deployment
```

it should probably remain outside V1.

When schedule pressure appears:

> **remove optional features before reducing correctness, security, or reliability work.**

---

## E. Goals

Helmrun is primarily a **learning and resume project**, not an attempt to build a commercial platform with every possible feature.

The project should optimize for engineering depth.

### 1. Backend Engineering

Learn and demonstrate:

- API design
- authentication and authorization
- PostgreSQL schema design
- transactions
- locking
- concurrency control
- raw SQL
- connection pooling
- rate limiting
- idempotency
- error design
- production backend structure

### 2. Distributed Systems

Learn and demonstrate:

- asynchronous execution
- queues
- at-least-once delivery
- idempotent consumers
- worker pools
- backpressure
- distributed ownership
- leases
- heartbeats
- fencing tokens
- failure recovery
- checkpointing
- distributed race conditions

### 3. Cloud Engineering

Learn and demonstrate:

- AWS networking
- IAM
- RDS
- ElastiCache
- SQS
- S3
- EC2
- ECS
- ECR
- Secrets Manager
- KMS
- Terraform
- CI/CD
- deployment
- rollback
- scaling

### 4. Gen-AI Infrastructure

Learn and demonstrate:

- LLM provider abstractions
- agent runtimes
- tool execution
- MCP
- provider failures
- token/usage tracking
- long-running agent execution
- recovery of agent state

The project intentionally focuses on **Gen-AI application infrastructure rather than core ML**.

### 5. Security and Reliability

Learn and demonstrate:

- multi-tenant isolation
- API-key security
- secret handling
- least privilege
- sandbox isolation
- resource limits
- failure injection
- graceful degradation
- crash recovery

### 6. Observability

Learn and demonstrate:

- structured logging
- metrics
- distributed tracing
- SSE streaming
- dashboards
- debugging distributed execution

### 7. Interview Signal

Helmrun should give strong material for backend, cloud, distributed-systems, and Gen-AI engineering interviews.

The goal is to be able to clearly explain decisions such as:

```text
Why SQS instead of BullMQ or Kafka?
Why PostgreSQL is the source of truth?
Why Redis is only ephemeral?
Why use leases and heartbeats?
Why are fencing tokens needed?
Why checkpoint execution?
Why use Docker sandboxes?
Why SSE instead of WebSockets?
Why modular monolith instead of microservices?
Why dedicated EC2 worker hosts?
How does crash recovery work?
How are duplicate executions prevented?
How are external side effects handled safely?
```

### 8. Depth Over Feature Count

The main project rule is:

> **Prefer fewer features implemented deeply and correctly over many technologies used superficially.**

That means important systems should be:

```text
implemented
    ↓
tested normally
    ↓
tested under concurrency
    ↓
tested under failure
    ↓
load-tested where relevant
    ↓
observed
    ↓
documented
```

Helmrun is successful if it shows that the developer understands **why the system works and how it fails**, not merely that many technologies appear in the README.
