# Helmrun Phase 7 — AWS Infrastructure, Terraform & Production Deployment

## Phase Status

Phase 7 takes Helmrun from a locally reproducible distributed system to a real cloud deployment on AWS.

By the end of Phase 6, Helmrun already has:

- a production-oriented control plane,
- distributed execution through SQS,
- scheduler and worker processes,
- durable leases and heartbeats,
- checkpoint-based recovery,
- stale-worker fencing,
- Docker sandbox isolation,
- SSE streaming,
- structured logs,
- OpenTelemetry tracing,
- Prometheus metrics,
- Grafana dashboards.

Phase 7 answers:

> Can this architecture be deployed, operated, recovered, and changed safely in real cloud infrastructure?

This phase introduces:

- AWS networking,
- VPC/subnets/security groups,
- Application Load Balancer,
- container image registry,
- API deployment,
- scheduler deployment,
- dedicated worker hosts,
- RDS PostgreSQL,
- ElastiCache Redis,
- SQS,
- S3,
- IAM,
- Secrets Manager,
- KMS,
- CloudWatch,
- Route 53,
- Terraform,
- GitHub Actions,
- environment separation,
- rollout strategy,
- infrastructure failure testing,
- deployment rollback,
- worker scaling,
- backups and recovery basics.

The goal is not to use every AWS service.

The goal is:

> **Deploy Helmrun's existing architecture faithfully, securely, reproducibly, and with a clear operational model.**

---

# 1. Phase Goal

At the end of Phase 7, the production-style flow should be:

```text
Internet
   │
   ▼
Route 53
   │
   ▼
Application Load Balancer
   │
   ▼
Helmrun API
   │
   ├──────────────┬─────────────┬──────────────┐
   ▼              ▼             ▼              ▼
RDS Postgres   ElastiCache     SQS             S3
                  Redis
   │                              │
   │                              ▼
   │                         Worker Fleet
   │                              │
   │                              ▼
   │                       Docker Sandboxes
   │
   ▼
Scheduler
```

Infrastructure should be created using Terraform, and application deployment should be automated using GitHub Actions.

---

# 2. Estimated Duration

Recommended:

```text
3 weeks
```

Approximate effort:

```text
55–70 hours
```

Suggested split:

| Area | Approx. hours |
|---|---:|
| AWS/VPC/IAM theory | 8–10 h |
| Terraform foundations | 7–9 h |
| Network + database/cache infra | 9–11 h |
| API/scheduler deployment | 6–8 h |
| Worker-host deployment | 7–9 h |
| Secrets/KMS/S3/ECR | 5–7 h |
| CI/CD | 5–7 h |
| Failure/recovery testing | 5–7 h |
| Docs/refactoring | 3–4 h |

---

# 3. Important Deployment Decision

Helmrun's worker is unusual.

A normal backend worker can simply run inside a container.

Helmrun's worker must also launch, monitor, kill, and clean up per-run Docker sandboxes.

Therefore worker deployment must preserve access to a host container runtime.

For v1, the preferred cloud design is:

```text
Dedicated EC2 worker hosts
        │
        ▼
Worker Service
        │
        ▼
Host Docker Engine
        │
        ▼
Per-run Helmrun sandboxes
```

rather than forcing the worker into a generic managed container environment.

API and scheduler can be deployed more conventionally.

---

# 4. Recommended v1 AWS Topology

```text
                            Internet
                               │
                               ▼
                           Route 53
                               │
                               ▼
                       Application Load
                           Balancer
                               │
                               ▼
                     ┌─────────────────┐
                     │   Helmrun API   │
                     │   ECS/EC2       │
                     └───────┬─────────┘
                             │
          ┌──────────────────┼───────────────────┐
          │                  │                   │
          ▼                  ▼                   ▼
    RDS PostgreSQL      ElastiCache Redis       S3
          │                                      │
          │                                      │
          ▼                                      │
    Scheduler Service                             │
          │                                      │
          ▼                                      │
         SQS                                     │
          │                                      │
          ▼                                      │
  ┌────────────────────┐                         │
  │ Dedicated EC2      │                         │
  │ Worker Auto Scaling│                         │
  │ Group              │                         │
  └─────────┬──────────┘                         │
            │                                    │
            ▼                                    │
      Helmrun Worker                             │
            │                                    │
            ▼                                    │
      Docker Engine                              │
            │                                    │
      ┌─────┼─────┐                              │
      ▼     ▼     ▼                              │
   Sandbox Sandbox Sandbox ───────────────────────┘
```

This is the current recommended v1 deployment model.

Exact ECS/EC2 details can change during implementation.

---

# 5. Frozen vs Conceptual

## Frozen architectural direction

The following are part of Helmrun v1:

- AWS is the primary cloud.
- Terraform provisions infrastructure.
- GitHub Actions performs CI/CD.
- PostgreSQL runs on Amazon RDS.
- Redis runs on Amazon ElastiCache.
- SQS remains the execution queue.
- S3 stores artifacts/checkpoint payloads.
- ECR stores container images.
- ALB fronts the external API.
- Route 53 provides DNS.
- IAM follows least privilege.
- Secrets Manager stores production secrets.
- KMS provides encryption key management where relevant.
- Worker compute is isolated from public ingress.
- Databases/caches are not publicly exposed.
- Worker hosts are independently scalable.
- Production resources live inside a VPC.
- API and worker secrets are not committed to CI or source code.
- Deployment should be reproducible from Terraform.

## Conceptual / not frozen

The following can evolve:

- exact CIDR ranges,
- exact number of availability zones,
- exact ECS task sizes,
- exact EC2 worker instance type,
- exact RDS instance class,
- exact ElastiCache node type,
- exact autoscaling thresholds,
- exact worker AMI strategy,
- exact API ECS capacity provider,
- exact scheduler placement,
- exact NAT strategy,
- exact Terraform module boundaries,
- exact domain name,
- exact CloudWatch retention,
- exact backup retention,
- exact CI deployment workflow.

---

# 6. Theory Module A — AWS Shared Responsibility

Understand the boundary between AWS-managed infrastructure and Helmrun-managed application/configuration/security concerns.

Helmrun must still manage:

- IAM permissions,
- database users,
- schema migrations,
- encryption choices,
- security groups,
- secrets,
- application vulnerabilities.

---

# 7. Theory Module B — Regions and Availability Zones

Understand:

```text
Region
  └── Availability Zones
```

For v1, deploy within one AWS region across multiple AZs where practical.

Do not build multi-region yet.

---

# 8. Theory Module C — VPC

Study:

- VPC CIDR,
- subnets,
- route tables,
- internet gateway,
- NAT gateway,
- security groups,
- public vs private subnet,
- VPC endpoints conceptually.

Core Helmrun goal:

```text
public ingress only where needed
```

---

# 9. Public vs Private Subnets

Recommended topology:

```text
VPC
│
├── Public Subnets
│   ├── ALB
│   └── NAT Gateway
│
└── Private Subnets
    ├── API tasks/instances
    ├── Scheduler
    ├── Worker hosts
    ├── RDS
    └── ElastiCache
```

No direct public IP should be required for RDS, ElastiCache, workers, or scheduler.

---

# 10. Theory Module D — Security Groups

Think of security groups as application-level network boundaries.

Example:

```text
Internet
   ↓ :443
ALB SG
   ↓ API port
API SG
   ↓ :5432
RDS SG
```

Do not expose internal databases/caches to `0.0.0.0/0`.

---

# 11. Theory Module E — NAT and VPC Endpoints

Private services may need outbound internet for:

- LLM APIs,
- approved MCP tools,
- image/package operations.

Understand NAT Gateway behavior and cost.

Also study VPC endpoints for services such as:

```text
S3
SQS
ECR
Secrets Manager
```

Add endpoints only where they make sense.

---

# 12. Theory Module F — IAM

Understand:

- roles,
- policies,
- resource permissions,
- temporary credentials,
- task/instance roles,
- least privilege.

Critical principle:

> Applications should use roles, not long-lived AWS access keys.

---

# 13. IAM Boundaries

Different Helmrun components should have different permissions.

### API

May need selected Secrets Manager/S3 operations, but not EC2 or IAM administration.

### Scheduler

Needs SQS send permissions and required database connectivity.

### Worker

Likely needs:

```text
SQS ReceiveMessage
SQS DeleteMessage
SQS ChangeMessageVisibility
S3 checkpoint/artifact access
Secrets Manager scoped reads
CloudWatch/telemetry access as needed
```

Do not give one shared administrator role to all components.

---

# 14. Theory Module G — ECS

Study:

- cluster,
- task definitions,
- services,
- desired count,
- rolling deployment,
- EC2 vs Fargate conceptually,
- task roles,
- execution roles,
- health checks.

API is a good candidate for ECS.

---

# 15. API Deployment

Conceptually:

```text
ECR
 ↓
ECS Task Definition
 ↓
ECS Service
 ↓
ALB Target Group
```

API instances should remain stateless.

---

# 16. Scheduler Deployment

Scheduler can initially run as an ECS service with desired count 1.

However, Phase 3 already made scheduler behavior concurrency-safe enough that overlapping instances should not corrupt state.

---

# 17. Worker Deployment

Preferred v1:

```text
EC2 Auto Scaling Group
        │
        ▼
worker host bootstrap
        │
        ├── Docker Engine
        ├── Helmrun worker
        └── runtime image
```

The worker can run as a systemd-managed process or a carefully designed host-level container with access to the host Docker daemon.

The exact mechanism remains conceptual.

---

# 18. Why Dedicated Worker Hosts

Dedicated EC2 workers make these Phase 5 requirements explicit:

- per-run container launch,
- Docker lifecycle control,
- sandbox cleanup,
- CPU/memory limits,
- orphan reconciliation,
- host-level capacity accounting.

This is clearer for Helmrun v1 than adding unnecessary nested orchestration complexity.

---

# 19. Worker Auto Scaling Group

Worker hosts belong to an Auto Scaling Group.

Potential future scaling signals:

```text
SQS queue depth
oldest message age
active execution capacity
```

Start simple.

Do not build a custom autoscaling control plane.

---

# 20. Worker Host Bootstrap

On startup:

```text
install/start Docker
pull Helmrun worker/runtime image
load configuration
start worker
initialize telemetry
```

A simple user-data bootstrap is acceptable initially.

Later, a versioned AMI can reduce startup variance.

---

# 21. Theory Module H — RDS PostgreSQL

Study:

- subnet groups,
- security groups,
- backups,
- snapshots,
- Multi-AZ,
- storage,
- connection limits,
- parameter groups conceptually.

RDS remains private.

---

# 22. RDS Production Baseline

Use:

- private subnets,
- encryption,
- automatic backups,
- deletion protection where appropriate,
- controlled security groups.

Exact instance size should remain cost-conscious.

---

# 23. Multi-AZ and Cost

Understand the production benefit of Multi-AZ.

For a student/portfolio environment, running single-AZ may be reasonable due to cost.

Document the difference between:

```text
production recommendation
```

and:

```text
cost-conscious deployed demo
```

---

# 24. RDS Connection Pooling

Calculate:

```text
API tasks × API pool size
+
scheduler pool
+
worker hosts × worker DB pool
```

and compare against database capacity.

Do not tune each service independently.

---

# 25. Theory Module I — ElastiCache Redis

Deploy Redis privately.

Use it for:

- caching,
- rate limiting,
- Pub/Sub,
- ephemeral coordination.

PostgreSQL remains authoritative.

---

# 26. Redis Failure Semantics

Actual cloud deployment should preserve the previous invariant:

```text
Redis unavailable
    ↓
degraded caching/events
    ↓
durable execution still correct
```

Test this.

---

# 27. Theory Module J — S3

Study:

- buckets,
- object prefixes,
- IAM,
- encryption,
- lifecycle rules,
- versioning conceptually,
- multipart upload conceptually.

Helmrun uses S3 for:

- checkpoint payloads,
- artifacts,
- large results.

---

# 28. S3 Prefix Strategy

Conceptually:

```text
checkpoints/<tenant>/<run>/...
artifacts/<tenant>/<run>/...
```

Application authorization still controls tenant access.

---

# 29. S3 Encryption and Lifecycle

Use server-side encryption.

Add lifecycle policies where useful for:

- temporary artifacts,
- stale checkpoints,
- old scratch data.

Do not retain everything forever.

---

# 30. Theory Module K — ECR

Store images such as:

```text
helmrun-api
helmrun-scheduler
helmrun-worker
helmrun-runtime
```

Use immutable tags/digests where possible.

Example:

```text
git SHA
release version
```

Avoid relying only on `latest`.

---

# 31. ECR Lifecycle

Use lifecycle policies to avoid unlimited stale image accumulation.

---

# 32. Theory Module L — Secrets Manager

Production secrets may include:

- model-provider keys,
- external tool credentials,
- database app secret if required.

Do not place them in source, container images, or committed `.env` files.

---

# 33. Secret Rotation

Understand how to:

- create new secret version,
- update application,
- restart/reload safely,
- revoke old secret.

Full automated rotation is optional.

---

# 34. Theory Module M — KMS

Understand managed encryption and key usage at a practical level.

Use KMS through managed integrations rather than implementing custom cryptography.

---

# 35. Theory Module N — ALB

Study:

- listeners,
- target groups,
- health checks,
- TLS termination,
- idle timeout,
- routing.

SSE makes idle-timeout testing important.

---

# 36. ALB and SSE

Phase 6 keepalive behavior must work with ALB idle timeouts.

Test:

```text
long-running idle SSE stream
```

and verify it remains connected.

---

# 37. TLS and Route 53

External API should use HTTPS.

Conceptually:

```text
Route 53
 ↓
ACM Certificate
 ↓
ALB :443
```

Exact domain is not important to architecture.

---

# 38. CloudWatch

Use CloudWatch for AWS-native infrastructure visibility such as:

- ECS/EC2 service logs,
- infrastructure metrics,
- alarms,
- AWS service metrics.

This complements Prometheus/Grafana and OpenTelemetry.

---

# 39. Terraform Theory

Learn:

- provider,
- resource,
- data source,
- variables,
- outputs,
- modules,
- state,
- plan,
- apply,
- destroy,
- dependency graph.

Do not start with a huge module framework.

---

# 40. Terraform State

Never commit Terraform state.

Use remote state.

Protect it because it may contain sensitive infrastructure metadata.

Exact backend configuration can follow the current Terraform/AWS implementation chosen during development.

---

# 41. Terraform Environments

Recommended:

```text
dev
production-like
```

Avoid creating many environments that add no value.

---

# 42. Suggested Terraform Layout

```text
infrastructure/terraform/
│
├── modules/
│   ├── network/
│   ├── database/
│   ├── cache/
│   ├── queue/
│   ├── storage/
│   ├── api/
│   └── workers/
│
└── environments/
    ├── dev/
    └── prod/
```

Modules should represent meaningful boundaries, not individual AWS resources.

---

# 43. Implementation Sequence

Recommended:

```text
1. Terraform fundamentals
2. VPC/network
3. RDS
4. ElastiCache
5. SQS/DLQ
6. S3
7. ECR
8. API deployment
9. scheduler deployment
10. worker EC2 ASG
11. IAM
12. Secrets Manager/KMS
13. Route 53/TLS
14. observability wiring
15. GitHub Actions
16. migrations/deployments
17. scaling
18. failure/load tests
19. docs/runbooks
```

---

# 44. Step 1 — Network

Provision:

- VPC,
- public subnets,
- private subnets,
- route tables,
- internet gateway,
- NAT,
- security groups.

Validate before adding application compute.

---

# 45. Network Tests

Verify:

### Private API/worker

Can reach:

- RDS,
- Redis,
- SQS,
- S3,
- approved external LLM APIs.

### Internet

Cannot directly reach:

- RDS,
- ElastiCache,
- scheduler,
- worker host services.

---

# 46. Step 2 — Managed Data Services

Provision:

```text
RDS PostgreSQL
ElastiCache Redis
SQS
SQS DLQ
S3
```

Test each independently before application deployment.

---

# 47. Database Migration Strategy

Do not let every API replica execute migrations blindly.

Preferred conceptual deployment order:

```text
build
 ↓
run migration job
 ↓
deploy application
```

Use backward-compatible migrations where practical.

---

# 48. Safe Migration Pattern

For risky production schema changes:

```text
expand
 ↓
deploy compatible code
 ↓
backfill/migrate
 ↓
contract later
```

Not every simple migration needs ceremony, but understand the pattern.

---

# 49. Step 3 — ECR

Create repositories and push versioned images.

Example:

```text
helmrun-api:<git-sha>
helmrun-scheduler:<git-sha>
helmrun-worker:<git-sha>
helmrun-runtime:<git-sha>
```

---

# 50. Step 4 — API Deployment

Deploy API behind ALB.

Requirements:

- private compute,
- `/health`,
- `/ready`,
- rolling deployment,
- validated configuration,
- task/instance role,
- Secrets Manager integration,
- RDS/Redis connectivity.

---

# 51. Multi-Instance API Test

Start multiple API instances.

Verify:

- API-key auth,
- run creation,
- rate limiting behavior,
- Redis cache,
- SSE,
- Redis Pub/Sub,
- reconnect behavior.

No hidden in-memory singleton should be required.

---

# 52. Step 5 — Scheduler Deployment

Deploy scheduler separately.

Restart it while runs are being submitted.

Expected:

- run intent remains in PostgreSQL,
- dispatch resumes,
- no run is lost.

---

# 53. Step 6 — Worker EC2 Fleet

Provision:

```text
Launch Template
Auto Scaling Group
private subnet placement
worker security group
IAM instance role
```

Bootstrap Docker and Helmrun worker.

---

# 54. Worker IAM

Scope worker permissions to required resources.

Avoid `AdministratorAccess`.

The worker role should not imply that sandboxes inherit those permissions.

---

# 55. Sandbox IAM Isolation

Mandatory rule:

> Per-run sandboxes must not automatically inherit broad EC2 instance-role credentials.

Protect access to EC2 metadata credentials.

---

# 56. IMDS / Metadata Service

Understand Instance Metadata Service.

A sandbox must not be able to freely query host role credentials via:

```text
169.254.169.254
```

This should be explicitly tested.

---

# 57. Metadata Isolation Test

From a sandbox, attempt metadata-service access.

Expected:

```text
blocked / unavailable
```

unless a deliberately designed broker exists.

---

# 58. Step 7 — Real S3 Checkpoints

Move checkpoint payloads to the production S3 bucket.

Test:

- write,
- read,
- checksum,
- missing object,
- permission denied,
- retry policy.

---

# 59. Step 8 — Secrets Manager

Production secret path:

```text
secret reference
    ↓
trusted Helmrun component
    ↓
Secrets Manager
    ↓
scoped execution secret
    ↓
sandbox
```

Secret values must not enter:

- SQS messages,
- logs,
- traces,
- metrics.

---

# 60. Step 9 — Production Observability

Wire existing Phase 6 instrumentation into the AWS environment.

Possible components:

```text
OpenTelemetry Collector
Prometheus/Grafana
CloudWatch logs/metrics
```

Do not create a highly available monitoring platform for a portfolio deployment.

---

# 61. Step 10 — GitHub Actions CI/CD

Extend CI:

```text
lint
 ↓
typecheck
 ↓
tests
 ↓
build images
 ↓
push ECR
 ↓
terraform plan/apply
 ↓
migrations
 ↓
deploy
 ↓
smoke test
```

Use environment controls around production-like apply.

---

# 62. AWS Authentication from GitHub

Prefer:

```text
GitHub OIDC
   ↓
AWS STS
   ↓
temporary IAM role
```

over long-lived AWS keys stored as repository secrets.

---

# 63. CI IAM

Give deployment role only required permissions.

If broader permissions are temporarily used while learning, reduce them before finalizing Phase 7 and document why.

---

# 64. Terraform in CI

Pull requests should run:

```text
terraform fmt -check
terraform validate
terraform plan
```

Apply should come only from trusted workflows/branches.

---

# 65. Rolling Deployment

API deployments should allow old and new versions to coexist briefly.

This means:

- schema changes must be compatible,
- event/cache formats should be considered,
- SSE reconnect works.

---

# 66. Scheduler Deployment Safety

Old/new schedulers may overlap during rollout.

Phase 3 concurrency controls must keep this safe.

---

# 67. Worker Deployment Safety

Old/new worker versions may coexist.

Therefore maintain compatibility for:

- SQS message contract,
- checkpoint schema,
- sandbox protocol,
- run-state semantics.

---

# 68. Runtime Image Versioning

Record runtime image version/digest with execution attempt metadata.

This helps debugging and rollback.

---

# 69. Step 11 — Rollback

Rollback should be tested.

Example:

```text
deploy version B
 ↓
detect failure
 ↓
redeploy version A
```

Schema migration design must not make routine rollback impossible.

---

# 70. Step 12 — Worker Scaling

Use simple worker ASG scaling.

Potential signals:

- SQS queue depth,
- age of oldest message,
- available worker capacity.

Avoid advanced custom autoscaling logic in v1.

---

# 71. Scale-In Safety

Worker scale-down must respect active runs.

Preferred flow:

```text
worker enters draining
 ↓
stops polling
 ↓
finishes/releases active runs
 ↓
instance terminates
```

ASG lifecycle hooks are worth studying.

Implementation can remain simple if safe behavior is achieved.

---

# 72. Step 13 — Backups

Enable/document:

### RDS

- automated backup,
- snapshot process.

### S3

- lifecycle/retention,
- versioning if useful.

### Terraform state

- remote storage,
- protection/versioning.

Do not build multi-region disaster recovery.

---

# 73. Database Restore Experiment

At least once in dev:

```text
snapshot
 ↓
restore separate RDS instance
 ↓
verify schema/data
```

This is valuable cloud practice.

---

# 74. Step 14 — Alarms

Create a small set of high-value alarms.

Examples:

- ALB unhealthy targets,
- API 5xx rate,
- SQS oldest-message age,
- worker fleet unavailable,
- high run failure rate,
- RDS resource pressure.

Do not create dozens of low-value alarms.

---

# 75. AWS Failure Test — Worker Termination

Terminate a worker EC2 host during execution.

Expected:

```text
heartbeat stops
 ↓
lease expires
 ↓
ASG eventually replaces capacity
 ↓
run requeued/recovered
 ↓
new worker restores checkpoint
 ↓
run completes
```

This is one of Helmrun's strongest integration tests.

---

# 76. AWS Failure Test — API Termination

Kill one API instance.

Expected:

- ALB routes around failure,
- run execution unaffected,
- SSE client reconnects to surviving instance.

---

# 77. AWS Failure Test — Scheduler Restart

Restart scheduler.

Expected:

- durable queued runs remain,
- scheduling resumes,
- no lost execution intent.

---

# 78. AWS Failure Test — Redis Restart

Expected:

- caching/event fan-out degrades temporarily,
- execution correctness remains,
- reconnect/recovery works.

---

# 79. AWS Failure Test — SQS Permission Denied

Temporarily deny scheduler `SendMessage`.

Expected:

- dispatch fails,
- run remains eligible for dispatch,
- failure logged/measured,
- no false successful dispatch state.

---

# 80. AWS Failure Test — S3 Denied

Temporarily deny checkpoint writes.

Expected:

- checkpoint failure handled according to Phase 4 policy,
- no metadata points to missing object.

---

# 81. AWS Failure Test — Secrets Manager Failure

If required secret resolution fails:

- run fails safely or retries according to policy,
- no blank/missing secret leaks into confusing downstream behavior.

---

# 82. AWS Failure Test — Database Unavailable

Expected:

### API

Readiness becomes unhealthy.

### Scheduler

Stops dispatching authoritative work.

### Worker

Does not claim new work without DB authority.

Active runs follow lease/ownership safety rules.

---

# 83. Cloud Load Test

Use k6 against deployed environment.

Test:

- run creation,
- status reads,
- SSE connections,
- fake execution backlog.

Measure:

- ALB latency,
- API p95/p99,
- DB pool,
- Redis latency,
- SQS backlog,
- worker utilization,
- sandbox startup,
- recovery behavior.

---

# 84. Cost Awareness

Track major cost drivers:

```text
NAT Gateway
EC2 workers
RDS
ElastiCache
ALB
observability compute
```

The deployed portfolio environment should be cost-conscious.

---

# 85. Cost-Control Strategy

Potential choices:

- smaller RDS/Redis instances,
- worker ASG minimum 0/1 where practical,
- destroy unused dev environment,
- S3 lifecycle rules,
- avoid unnecessary NAT traffic,
- modest observability deployment.

Do not weaken security boundaries just to save a small amount.

---

# 86. Environment Strategy

Recommended:

```text
local
AWS dev
AWS production-like
```

If cost requires, dev and production-like environments may be created/destroyed as needed from the same Terraform modules.

---

# 87. Resource Naming and Tagging

Use consistent names and tags.

Example:

```text
project = helmrun
environment = dev
managed_by = terraform
component = worker
```

This improves cost visibility and operations.

---

# 88. Security Baseline

Phase 7 should include:

- private RDS,
- private ElastiCache,
- private workers,
- HTTPS,
- least-privilege security groups,
- IAM roles,
- GitHub OIDC,
- Secrets Manager,
- encryption at rest,
- no committed production secrets,
- EC2 metadata protection from sandboxes,
- no permanently public SSH dependency.

---

# 89. Terraform Security

Remember:

```text
Terraform state can contain sensitive values.
```

Protect remote state access.

Avoid placing raw secrets into Terraform configuration/state where possible.

---

# 90. Observability Relationship

Use:

```text
CloudWatch
```

for AWS-native infrastructure visibility.

Use:

```text
Prometheus/Grafana/OpenTelemetry
```

for Helmrun application-level observability.

They complement each other.

---

# 91. Health and Readiness

### API

ALB uses process health endpoint.

Application readiness checks critical dependencies.

### Scheduler

Not public; expose internal health/metrics as needed.

### Worker

Worker health should reflect:

- process alive,
- Docker available,
- DB/SQS available enough to safely accept work.

---

# 92. Graceful Termination

Cloud termination signals must reuse earlier shutdown logic.

### API

- stop new connections,
- close SSE,
- flush telemetry,
- exit.

### Scheduler

- stop dispatch/recovery scans,
- finish current operation,
- exit.

### Worker

- stop polling,
- drain sandboxes,
- continue lease heartbeats while draining,
- safely release/abort remaining work,
- exit.

---

# 93. Phase 0–6 Living Infrastructure Updates

## Database

Update connection configuration, migrations, backup/restore docs and pool sizing.

## Configuration

Add AWS resource identifiers, endpoints, environment names and deployment metadata.

## Logging

Add:

- environment,
- AWS region,
- service version,
- deployment version.

## Error model

Add infrastructure/dependency failure categories where necessary.

## Tests

Add real AWS integration and cloud failure tests.

## CI

Add ECR, Terraform, migrations, deployment and smoke tests.

## Docker/local development

Keep local workflow fully usable.

## Health/readiness

Align with ALB, ECS/EC2 and worker-host lifecycle.

## OpenAPI

Ensure deployed API docs remain accurate.

## Documentation

Add AWS architecture, IAM, deployment and runbooks.

## Shared packages

AWS infrastructure concerns should not leak unnecessarily into runtime/domain packages.

## Graceful shutdown

Validate actual ECS/EC2 termination behavior.

## Failure testing

Add managed-service and host-level failures.

---

# 94. Suggested Week 1

Focus:

```text
AWS/VPC/IAM theory
Terraform
network
RDS
ElastiCache
SQS
S3
ECR
```

Target:

> Core AWS infrastructure can be reproduced from Terraform.

---

# 95. Suggested Week 2

Focus:

```text
API deployment
ALB
TLS
Route 53
scheduler
worker EC2 ASG
IAM
Secrets Manager
real S3 checkpoints
```

Target:

> Helmrun executes a real end-to-end run on AWS.

---

# 96. Suggested Week 3

Focus:

```text
GitHub Actions
OIDC
migrations
rolling deploy
rollback
worker scaling
AWS failure tests
cloud load tests
alarms
documentation
```

Target:

> Helmrun deployment is automated, testable, and operationally understandable.

---

# 97. End-to-End AWS Demo

A strong demo:

```text
1. Terraform creates environment.
2. GitHub Actions builds Helmrun images.
3. Images are pushed to ECR.
4. API deploys behind HTTPS ALB.
5. Scheduler dispatches run to SQS.
6. Worker EC2 host receives the run.
7. Worker launches Docker sandbox.
8. Sandbox executes agent.
9. Checkpoint payload reaches S3.
10. SSE streams events.
11. Metrics/traces/logs show the lifecycle.
12. API exposes final result.
```

---

# 98. Worker Failure Demo

During an active run:

```text
terminate worker EC2
```

Then show:

```text
lease expiry
 ↓
recovery
 ↓
new worker
 ↓
checkpoint restore
 ↓
completion
```

This connects nearly every major Helmrun subsystem.

---

# 99. Deployment Demo

Push a new release:

```text
GitHub Actions
 ↓
tests
 ↓
build
 ↓
ECR
 ↓
migration
 ↓
rolling deployment
 ↓
smoke test
```

Then demonstrate rollback.

---

# 100. Exit Criteria

Phase 7 is complete only when:

## Networking

- [ ] VPC provisioned with Terraform.
- [ ] Public/private subnet model implemented.
- [ ] ALB is the intended public ingress.
- [ ] RDS is private.
- [ ] ElastiCache is private.
- [ ] worker hosts are private.
- [ ] security-group rules are scoped.
- [ ] HTTPS works.

## Managed services

- [ ] RDS PostgreSQL deployed.
- [ ] ElastiCache Redis deployed.
- [ ] SQS + DLQ deployed.
- [ ] S3 checkpoint/artifact bucket deployed.
- [ ] ECR repositories deployed.
- [ ] Route 53 configured if using a domain.

## API and scheduler

- [ ] API deployed independently.
- [ ] multiple API instances work.
- [ ] ALB health checks work.
- [ ] scheduler deployed separately.
- [ ] scheduler restart does not lose runs.
- [ ] overlapping schedulers remain safe.

## Workers

- [ ] dedicated worker-host model works.
- [ ] worker hosts launch Phase 5 sandboxes.
- [ ] worker IAM is scoped.
- [ ] sandboxes cannot obtain broad host IAM credentials.
- [ ] worker ASG exists.
- [ ] worker-host termination/recovery tested.
- [ ] scale-down/draining behavior documented.

## Security

- [ ] application services use IAM roles.
- [ ] CI uses temporary AWS credentials/OIDC.
- [ ] production secrets live in Secrets Manager.
- [ ] storage/database encryption enabled where appropriate.
- [ ] production secrets are not committed.
- [ ] metadata-service exposure from sandbox is tested.
- [ ] public SSH is not a permanent architecture requirement.

## Terraform

- [ ] infrastructure is reproducible.
- [ ] remote state configured.
- [ ] state is protected.
- [ ] Terraform formatting/validation run in CI.
- [ ] Terraform plan runs for infrastructure changes.
- [ ] core infrastructure is organized into meaningful modules.
- [ ] naming/tags are consistent.

## CI/CD

- [ ] tests run before deployment.
- [ ] images build automatically.
- [ ] images push to ECR.
- [ ] database migration step exists.
- [ ] deployment is automated enough for v1.
- [ ] smoke test runs after deployment.
- [ ] rollback has been tested.

## Reliability

- [ ] API instance termination tested.
- [ ] scheduler restart tested.
- [ ] worker-host termination and recovery tested.
- [ ] Redis restart tested.
- [ ] SQS permission failure tested.
- [ ] S3 failure tested.
- [ ] database connectivity failure tested.
- [ ] Secrets Manager failure tested.
- [ ] cloud load test performed.

## Operations

- [ ] useful AWS alarms exist.
- [ ] CloudWatch/AWS metrics are visible.
- [ ] Prometheus/Grafana/OpenTelemetry remain functional.
- [ ] backup strategy enabled/documented.
- [ ] operational runbooks exist.
- [ ] cloud architecture diagram matches deployment.

---

# 101. Explicitly Out of Scope

Do not add:

- Kubernetes,
- EKS,
- Helm,
- service mesh,
- multi-region deployment,
- cross-region failover,
- global databases,
- custom autoscaler,
- GPU worker fleets,
- self-hosted LLM inference,
- advanced FinOps,
- enterprise disaster recovery,
- Kafka,
- gRPC solely for infrastructure reasons.

These belong to post-v1 or other projects.

---

# 102. Things We Should Resist

Do not turn Phase 7 into:

```text
"Learn every AWS service."
```

Do not add services because they are popular.

Avoid adding:

- Lambda without a requirement,
- DynamoDB without a data-model reason,
- Step Functions when Helmrun owns execution semantics,
- EventBridge when SQS already solves dispatch,
- EKS before v1 completion.

---

# 103. Core Phase 7 Invariants

### Invariant 1 — Terraform defines infrastructure

Manual console changes are exceptional, not normal operations.

### Invariant 2 — Public ingress is explicit

Only intended external endpoints are publicly reachable.

### Invariant 3 — Roles replace long-lived AWS keys

Applications and CI use temporary role credentials where possible.

### Invariant 4 — Worker IAM does not become sandbox IAM

Agent sandboxes do not inherit broad host permissions.

### Invariant 5 — Managed-service failures preserve Helmrun's correctness model

AWS outages map into known retry/recovery behavior.

### Invariant 6 — Deployments have a rollback path

Application releases must be operationally reversible enough for v1.

### Invariant 7 — Cloud topology follows application architecture

AWS services support Helmrun boundaries rather than redefining them.

### Invariant 8 — Cost-conscious deployment does not invalidate architecture

Production-oriented design and small portfolio resource sizes can coexist.

---

# 104. Definition of Done

Phase 7 is successful when:

> Helmrun's API, scheduler, PostgreSQL, Redis, SQS, S3, worker fleet, Docker sandboxes, secrets, networking, and observability run on AWS; the infrastructure is reproducibly provisioned with Terraform; GitHub Actions builds and deploys versioned images using temporary AWS credentials; worker hosts recover durable executions after infrastructure failure; public/private networking and IAM boundaries are enforced; and deployments, rollbacks, backups, scaling, and major managed-service failures have been tested and documented.

At that point Helmrun is a real cloud-deployed distributed system rather than only a locally demonstrated architecture.

The final phase can focus on **developer experience, SDK/CLI/dashboard, systematic performance testing, documentation, demo quality, and resume-ready hardening**.
