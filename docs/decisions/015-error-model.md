# 015: Error model: kinds in shared, HTTP mapping in the API (2026-10-07)

Phase: 0
Status: Accepted

## Decision
- **`AppError` lives in `packages/shared`** and is transport-neutral: `kind`,
  `code` (any string), `message` (safe to show a client), optional `cause`.
  No HTTP status on it. Settles decision 005's open question: the API maps
  errors to HTTP status, because the worker throws the same errors.
- **A closed list of 9 kinds.** Only the API maps kind → HTTP status, and the
  map must be exhaustive (a new kind without a status doesn't compile):

  | Kind | Status | Retryable | Example |
  |---|---|---|---|
  | `invalid_input` | 400 | no | bad JSON, missing field, Zod failure |
  | `unauthenticated` | 401 | no | API key missing or wrong |
  | `quota_exceeded` | 403 | no (until something changes) | 50-agent limit reached |
  | `not_found` | 404 | no | unknown route; agent missing or another tenant's |
  | `conflict` | 409 | no | agent name already taken |
  | `payload_too_large` | 413 | no | oversized body |
  | `rate_limited` | 429 | yes | too many requests per minute |
  | `internal` | 500 | no | bug in our code |
  | `unavailable` | 503 | yes | Postgres or Redis down |

- **Codes live per feature** (e.g. `AGENT_NOT_FOUND` next to the agent errors),
  not in a catalog in `shared`. Phase 0 codes (`INVALID_JSON`,
  `PAYLOAD_TOO_LARGE`, `ROUTE_NOT_FOUND`, `INTERNAL_ERROR`) live in
  `apps/api/src/http/`. Codes are a client contract: never renamed, only added.
- **Client envelope:** `{ error: { code, message, requestId } }`. Known errors
  send their own message; anything else is a 500 with a generic message.
  `invalid_input` from Zod adds a list of `{ path, message }`, at most 10,
  never the rejected values.
- **Logging:** one Pino line per error, with the request ID. Error fields go
  through an allowlist, everywhere (no per-environment difference): `name`,
  `message`, `stack`, `code`, `constraint`, `table`, and `cause` filtered the
  same way. Never `detail` (pg puts row values there).
- **Edge cases:** an error after headers were sent is logged and handed to
  Express (the connection closes); a non-Error thrown value is treated as
  unknown; the error middleware itself must never throw (the whole handler
  runs inside a try/catch that falls back to a fixed 500 envelope).

## Update (2026-10-07, after the fresh review)
- **Body-parser errors are recognised as a group:** known `type`s map to
  their own codes (`INVALID_JSON`, `PAYLOAD_TOO_LARGE`,
  `UNSUPPORTED_CONTENT_ENCODING`, `UNSUPPORTED_CHARSET`, `REQUEST_ABORTED`,
  `INVALID_REQUEST_BODY`); any other exposed 4xx becomes `invalid_input`.
  415 cases use `invalid_input` (400) rather than a 10th kind. No body-parser
  error is kept as `cause`: their messages echo client input.
- **The log allowlist also bounds sizes:** `message`, `stack`, and
  `code`/`constraint`/`table` are truncated, and the latter three must be
  strings or numbers. A `ZodError` is not kept as `cause` (its message lists
  every issue, unbounded). Client-facing issue paths and messages are capped
  too.
- **Open before phase 1:** library messages can carry values (pg `22P02`);
  and only boundary parsing should count as `invalid_input` (a `ZodError`
  from parsing a DB row inside a handler is our bug).

## Why
- The client gets a stable shape it can code against; operators get the
  details, linked by the request ID.
- `err.message` from libraries can leak schema names, so only messages we
  wrote reach the client.
- `detail` holds customer data; an allowlist can't leak a field nobody
  thought of, a blocklist can.
- Separate statuses for "your fault", "try later", and "our bug" let clients
  react correctly (fix input, retry, or report).

## Alternatives considered
- `statusCode` on `AppError` (the phase spec's sketch): ties a shared,
  worker-used type to HTTP.
- One code catalog in `shared`: puts Helmrun names in a generic package. A
  Helmrun-specific package can be revisited in phase 3 when the worker needs
  the same codes.
- Log everything in development, allowlist in production: the production
  path goes untested, and a dev API pointed at copied production data leaks.
- Validation errors as a bare "Invalid input": clients can't tell what to
  fix. Echoing rejected values: reflects secrets and huge strings.
- 401 vs 400 for a bad key: 400 sends clients looking at their body; 401 is
  what SDKs handle as "credentials".
