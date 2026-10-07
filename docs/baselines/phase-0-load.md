# Phase 0 load baseline (2026-10-07)

A reference point for later phases (phase 0 spec §21), not a performance claim.

## Setup

- Built API (`node apps/api/dist/main.js`), `NODE_ENV=production`,
  `LOG_LEVEL=info`, logs written to a file.
- Local test stack: PostgreSQL 18 and Valkey 9 in Docker, pool max 10.
- macOS laptop, Node 24.21.0, single API process.
- `autocannon@8 -c 200 -d 10` per endpoint, run back to back (`/health/live`
  first, so it includes JIT warm-up).

## Results

| Endpoint | Requests | Avg req/s | p50 | p97.5 | p99 | Max | Non-2xx |
|---|---|---|---|---|---|---|---|
| `GET /health/live` | 244k | 22,189 | 8 ms | 16 ms | 18 ms | 632 ms (warm-up) | 0 |
| `GET /health/ready` | 285k | 28,442 | 6 ms | 11 ms | 12 ms | 40 ms | 0 |

- All 528,883 responses were 200; no `ERROR` log lines; no pool exhaustion.
- `/health/ready` hits PostgreSQL yet ran faster than `/live`: concurrent
  probes share one in-flight `SELECT 1` (decision 012), and `/live` absorbed the
  warm-up.
- SIGTERM after the run: `http_server → database_pool → redis`, exit 0.

## Not measured yet

Real DB queries per request, multiple instances, and network latency to a
managed database. Phase 1 adds DB-backed endpoints; repeat this then and
compare.
