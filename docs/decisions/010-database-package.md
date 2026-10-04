# 010: Database package: typed pool, own logger interface, two query deadlines (2026-10-04)

Phase: 0
Status: Accepted

## Decision
- `createPool(options, logger)` takes a typed `DatabaseOptions`
  (`url`, `poolMax`, timeouts, `applicationName`) per decision 009. The app
  sets `applicationName` (`helmrun-api`, `helmrun-worker`) so connections are
  traceable in `pg_stat_activity`.
- The package defines its own minimal `DatabaseLogger` (`debug`, `info`,
  `error`); Pino satisfies it structurally. No Pino dependency.
- Two query deadlines: server-side `statement_timeout`, and a client-side
  `query_timeout` derived as statement timeout + 2 s (not a separate setting).
- The pool always registers an `'error'` listener and logs only safe fields
  (never the connection string).
- `index.ts` re-exports the `Pool` type so apps don't depend on `pg` directly.
- Bootstrap migration sets the database timezone to UTC.
- Migration integration tests replay the real migrations onto a throwaway
  database created and dropped by the test, never the shared test database;
  runner flags are read from the `migrate:test:up` script.
- Transaction helper deferred to phase 1 (first real transaction); the user
  writes it.

## Why
- Generic, testable package: no env names, no logging library coupling.
- `statement_timeout` can't help when the network dies mid-query (the
  server's cancel never arrives); without a client deadline the query holds
  its pool slot until OS keepalive gives up (~11 min). Deriving the client
  deadline keeps it correctly ordered and removes a misconfigurable knob.
- An idle-client error with no listener is an unhandled `'error'` event and
  crashes the process.
- Replaying migrations onto an already-migrated database passes only while
  every migration is idempotent; the first `CREATE TABLE` breaks it.

## Alternatives considered
- Importing Pino's `Logger` type: couples the package to Pino.
- A configurable `DB_QUERY_TIMEOUT_MS`: one more setting that could be set
  below the statement timeout.
- Writing the transaction helper now: nothing in phase 0 uses it.
- Dummy bootstrap table: proves the workflow but adds nothing real.
