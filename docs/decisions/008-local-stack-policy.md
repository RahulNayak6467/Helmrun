# 008: Local stacks: dev persists, test starts empty; Valkey requires auth (2026-10-04)

Phase: 0
Status: Accepted

## Decision
- **Dev stack** (`docker-compose.yml`, project `helmrun-dev`): named volumes,
  Valkey append-only persistence, `restart: unless-stopped`.
- **Test stack** (`docker-compose.test.yml`, project `helmrun-test`): starts
  empty on every run. Postgres data on `tmpfs` (`/var/lib/postgresql`), Valkey
  with `--save ""` and no AOF or volume, `restart: "no"`. Run
  `pnpm db:migrate:test` after each `up`.
- Both stacks bind ports to a hardcoded `127.0.0.1` (not configurable via
  env), with required `:?` checks on every interpolated variable.
- Valkey requires a password in both stacks (`--requirepass`); the health
  check authenticates via `REDISCLI_AUTH`, never `-a` on the command line.
- No custom Compose networks in phase 0.

## Why
- Persisted test data between runs causes failures unrelated to the change
  under test (crashed-run leftovers, stale schema after editing migrations)
  and diverges from CI, which always starts empty.
- Within a run, tests still clean up after themselves; this decision only
  covers state between runs.
- ElastiCache requires auth; requiring it locally exercises password-bearing
  URLs and log redaction from day one.
- A hardcoded loopback bind can't be widened to the network by an env edit.
- Apps run on the host and reach services via published ports; no
  container-to-container traffic exists yet for networks to isolate.

## Alternatives considered
- Persistent test volumes with cleanup left to tests: faster startup, but
  stale state between runs and a local/CI gap.
- Configurable bind address (`DB_HOST`): flexible, but one edit away from
  exposing services; the name also suggests the app's connection host.
- Segmented Compose networks: useful once apps run in containers (phase 7)
  and for sandbox isolation (phase 5, via the Docker API).

## Notes
- Postgres 18 images expect the volume at `/var/lib/postgresql`, not
  `/var/lib/postgresql/data`; the old path makes the container refuse to start.
