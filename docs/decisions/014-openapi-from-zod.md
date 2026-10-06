# 014: OpenAPI generated from Zod schemas (2026-10-07)

Phase: 0
Status: Accepted

## Decision
- The OpenAPI spec is generated from the API's Zod schemas, not handwritten,
  with `zod-openapi` (Zod 4 native `.meta()`, one plain document object, no
  global registry). Each route's request and response schemas go into the
  document; the spec is built from them.
- The generated `openapi.json` is committed. CI regenerates it and fails if
  the committed file differs, so every contract change shows up in the PR
  diff. Not served at runtime for now. The builder stays in `src/` (so it
  ships in `dist/` unused, and `zod-openapi` is a runtime dependency) on
  purpose: tests import it, and serving the spec later needs no move.
- Routes are still registered by hand, so a route-coverage test fails if an
  Express route is missing from the spec.
- Design-first still applies: sketch a new endpoint as Zod schemas before
  writing its handler.
- Phase 0 scope: tooling, API metadata, `/health/live` and `/health/ready`.
  The error-response schema waits for step 13.

## Why
- Every boundary already parses input with Zod (CLAUDE.md). A handwritten
  spec describes each endpoint twice, and request drift (a field made required
  in Zod but still optional in the YAML) isn't caught by response contract
  tests. One definition removes that class of bug instead of testing for part
  of it.

## Alternatives considered
- Handwritten YAML + response contract test + route-coverage test (the user's
  first lean): design-first, but double maintenance across phase 1's
  endpoints, and request-side drift slips through.
- `@asteasolutions/zod-to-openapi`: registry style (`registerPath` per route
  module); more API surface and a registry to inject.
- Build the spec at startup and serve `GET /openapi.json`: no reviewable diff
  of contract changes; can be added later on top of the committed file.
- Hybrid (Zod → JSON Schema for components, handwritten paths): two sources
  and more glue for no real gain at Helmrun's size.
