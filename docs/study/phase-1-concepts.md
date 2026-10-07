# Phase 1 concept map

Which concept to learn before which step, read just in time (theory → small
experiment → build). Session plans pull each concept in as a task when its
step comes (`docs/guides/workflow.md` §3). Don't read ahead: spare time goes
to the current week's plan. Total ≈ 18–19 h across the phase.

Highest interview value: **E** (isolation and locks), **H** (API-key
security), **G** (broken object-level authorization), and **idempotency**.

## Stage 1: schema design

| Concept | Learn | Experiment | Source | Est. |
|---|---|---|---|---|
| **A. Relational modeling** | primary and foreign keys, unique and `CHECK` constraints, `NOT NULL`, one-to-many, normalization, `timestamptz`, UUID vs integer IDs, enum vs `CHECK`, when JSONB fits (agent config), ownership (`tenant_id` on every row), `ON DELETE` cascade vs restrict, soft delete | toy `tenants` / `agents` / `agent_versions`: agent for a missing tenant, duplicate version, delete a parent, invalid status, null in a required column; note what Postgres stops | Postgres docs ch. 5 "Data Definition" (5.4 Constraints) | 2 h |
| **B. Indexing** | B-tree, primary-key and unique indexes, composite indexes and the leftmost-prefix rule, selectivity, partial indexes, write cost | indexes for the real access patterns: `(tenant_id, id)`, `(tenant_id, created_at DESC, id DESC)` | *Use The Index, Luke*, ch. 1–2 | 1.5 h |
| **C. `EXPLAIN ANALYZE`** | seq vs index scan, bitmap scan (concept), estimated vs actual rows, timing | 100k toy agents: list query before and after the index | Postgres docs 14.1 "Using EXPLAIN" | 1 h |

Builds: schema design check, migrations.

## Stage 2: transactions

| Concept | Learn | Experiment | Source | Est. |
|---|---|---|---|---|
| **D. Transactions** | `BEGIN` / `COMMIT` / `ROLLBACK`, atomicity, boundaries, failure halfway, a transaction belongs to a connection | agent + version 1 in one transaction; make the second insert fail; nothing remains | Postgres docs 3.4 "Transactions"; node-postgres "Transactions" | 1 h |
| **F. Connection pooling** (deeper) | transaction lifetime, why long transactions hurt, instances × pool size, a leaked connection mid-transaction | `DB_POOL_MAX=2`, a transaction that throws without releasing | node-postgres "Pooling" | 0.5 h |

Builds: transactions inline first; `withTransaction` after review, as the
production practice.

## Stage 3: tenants, API keys, authorization

| Concept | Learn | Experiment | Source | Est. |
|---|---|---|---|---|
| **G. Authentication vs authorization** | who are you vs what may you do; a valid key isn't access to everything; broken object-level authorization | two tenants: request tenant A's agent with B's key | OWASP API Security Top 10 2023, API1 + API2 | 0.75 h |
| **H. API-key security** | secure random generation, prefixes, hashing (why SHA-256 fits random keys), constant-time comparison, show once, revocation, expiry, `last_used_at`, rotation, never logging keys | plaintext-leak experiment; hash twice; `===` vs `timingSafeEqual` | GitHub blog "Behind GitHub's new authentication token formats"; OWASP Password Storage Cheat Sheet; Node `crypto` docs | 1.5 h |
| **Tenant context** | where the request's tenant lives (`req.tenant` from the auth middleware); never from the body | — | phase 0 `requestContext` code | 0.25 h |

Builds: tenants, API-key creation, auth middleware, ownership checks.

## Stage 4: agents and versions

| Concept | Learn | Experiment | Source | Est. |
|---|---|---|---|---|
| **I. REST design** (needed parts) | resource routes (`/v1/agents/:agentId`), method semantics, 201 / 204 / 404 / 409, `/v1` versioning | — | Stripe API reference (any resource); MDN HTTP status codes | 0.75 h |
| **Pagination** | offset vs keyset (cursor), a unique tie-breaker, opaque cursors, `limit + 1` | 10k agents paged both ways; insert while paging, watch offset skip | *Use The Index, Luke*, "Paging Through Results" | 1 h |
| **E. Isolation and concurrency** | `READ COMMITTED`, lost update, non-repeatable read, row locks (`FOR UPDATE`), conditional updates (`UPDATE … WHERE … RETURNING`), optimistic concurrency (concept) | two-terminal version race: duplicates, then the fix | Postgres docs 13.2 "Transaction Isolation" + 13.3 "Explicit Locking"; DDIA ch. 7 (lost updates) | 2 h |
| **Immutability** | versions never change; enforce it in the DB too | try to `UPDATE` a version row | — | 0.25 h |

Builds: agent CRUD, list pagination, immutable versions with safe numbering.

## Stage 5: runs

| Concept | Learn | Experiment | Source | Est. |
|---|---|---|---|---|
| **Version pinning** | snapshot the exact version at creation; "latest" breaks history | — | phase 1 spec §23 | 0.25 h |
| **Idempotency keys** | retries, the check-then-act race, the unique constraint decides, request hash, key retention | two parallel creates with the same key | Brandur Leach, "Implementing Stripe-like Idempotency Keys in Postgres" | 1 h |
| **Run states** (first look) | a small set of states as a concept; not frozen until phases 3–4 | — | phase 1 spec §22 | 0.25 h |

Builds: run creation in a transaction, pinned and idempotent.

## Stage 6: quotas and rate limiting

| Concept | Learn | Experiment | Source | Est. |
|---|---|---|---|---|
| **Quotas** | count under a lock vs a counter column; no constraint can express "≤ N" | the 49 → 51 race in two terminals | stage 4 notes on locks | 0.5 h |
| **Rate limiting** | fixed window vs sliding window vs token bucket; `INCR` + `EXPIRE NX`; 429 + `Retry-After`; fail open vs fail closed | TTL leak in `redis-cli`; the window-boundary burst | Redis `INCR` docs "Pattern: rate limiter"; Stripe "Scaling your API with rate limiters" | 1 h |

## Stage 7: proving it

| Concept | Learn | Source | Est. |
|---|---|---|---|
| **Integration testing with a real DB** | per-test data and cleanup, testing races with parallel requests, tenant isolation sweeps | phase 0 integration tests | 0.5 h |
| **Failure experiments** | Postgres down mid-request, Redis down, pool exhaustion, load test vs `docs/baselines/phase-0-load.md` | phase 1 spec §57–60 | (in the experiments) |

The phase 1 study pack (end of phase) reviews these same concepts against
what was built.
