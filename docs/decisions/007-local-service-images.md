# 007: Local service images — Postgres 18 and Valkey (2026-10-03)

Phase: 0
Status: Accepted

## Decision
Local dev and test compose files use:

- **PostgreSQL:** `postgres:18.6-bookworm`
- **Valkey** (Redis-compatible): `valkey/valkey:9.1.2-alpine`

Images are pinned to exact versions, never `latest`. Code, env vars
(`REDIS_URL`), and the client (`ioredis`) keep the Redis names: Valkey speaks
the same protocol and the `redis://` URL scheme.

## Why
- Local images should match production engines (phase 7: RDS, ElastiCache).
- Redis relicensed in 2024; AWS backs Valkey, and ElastiCache offers Valkey
  plus older Redis OSS (up to 7.1). `redis:8.x` can't run on ElastiCache, so
  developing on it would drift from production.
- Helmrun's Redis usage (counters, expiry, pub/sub, simple locks) behaves the
  same across Redis 7 and Valkey 8/9.
- Postgres uses Debian, not Alpine: musl's locale handling can change text
  collation and sort order compared with RDS.

## Alternatives considered
- `redis:8.8.3-alpine`: newest Redis, but no matching managed engine on AWS.
- Redis OSS 7.x: matches ElastiCache's older Redis engine, which AWS is moving
  away from.
- `postgres:*-alpine`: smaller image, collation risk.

## Follow-up
Phase 7: confirm the Postgres major version RDS offers and the Valkey major
version ElastiCache supports in the chosen region; align local images.
