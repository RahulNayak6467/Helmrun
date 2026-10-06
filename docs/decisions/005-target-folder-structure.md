# 005: Target folder structure (2026-10-03)

Phase: 0
Status: Accepted

## Decision
The full V1 layout below is the target. Each folder is created only in the
phase where it's needed. Phase 0 creates only what decision 004 lists.

```text
helmrun/
├── apps/
│   ├── api/                       P0  control plane
│   │   ├── src/
│   │   │   ├── main.ts            process: start, signals, graceful shutdown
│   │   │   ├── app.ts             builds the Express app, never listens
│   │   │   ├── http/              middleware, error model, request IDs, OpenAPI
│   │   │   ├── health/            liveness + readiness
│   │   │   └── modules/           P1 auth, tenants, agents, agent-versions, runs
│   │   │                          P6 events (SSE)
│   │   └── test/{integration,support}/
│   ├── scheduler/                 P0 shell → P3 real
│   ├── worker/                    P0 shell → P3 real, P5 sandbox management
│   ├── runtime/                   P5  sandbox entrypoint → helmrun-runtime image
│   ├── dashboard/                 P8
│   └── cli/                       P8
├── packages/
│   ├── config/ logger/ shared/    P0
│   ├── database/  (migrations/)   P0
│   ├── agent-runtime/             P2
│   ├── model-providers/           P2
│   ├── tool-protocol/             P2
│   ├── queue/                     P3
│   ├── observability/             P6
│   └── sdk/                       P8
├── docker/                        Dockerfiles per app + runtime image
├── tests/e2e/                     P3
├── infrastructure/terraform/      P7
└── docs/
```

Root: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
`docker-compose.yml`, `docker-compose.test.yml`, `.env.example`,
`.env.test.example`.

### Phase 0 layout

Only this is created in phase 0. File names inside `src/` are a starting
point, not frozen: function-level design happens when each part is built.

```text
helmrun/
├── .github/workflows/ci.yml          install → lint → typecheck → test → build
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── main.ts               process: config, connect, listen, graceful shutdown
│   │   │   ├── app.ts                createApp(deps) → Express app, never listens
│   │   │   ├── config.ts             api's env schema
│   │   │   ├── dependencies.ts       composition root: builds pool/redis/logger once
│   │   │   ├── redis.ts              Redis client + lifecycle (see Open)
│   │   │   ├── http/                 request-id, request-logger, not-found, error
│   │   │   │                         middleware; openapi/
│   │   │   └── health/               /health/live, /health/ready
│   │   ├── test/{integration,support}/
│   │   └── package.json, tsconfig.json, vitest.config.ts
│   ├── scheduler/                    shell: src/main.ts + src/config.ts
│   └── worker/                       shell: src/main.ts + src/config.ts
├── packages/
│   ├── config/                       loader + reusable env fragments
│   ├── logger/                       logger factory + redaction
│   ├── database/                     pool, transaction helper, health query;
│   │                                 migrations/ (bootstrap only); test/integration/
│   └── shared/                       app error base, graceful-shutdown helper
├── docker-compose.yml  docker-compose.test.yml
├── .env.example  .env.test.example  .gitignore  .nvmrc
├── eslint.config.js  .prettierrc  .prettierignore
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  vitest.config.ts
└── docs/  CLAUDE.md  README.md
```

Rules for phase 0:
- Each app owns its env schema; `packages/config` only provides the loader and
  reusable pieces (the worker must not require `PORT`).
- `shared` depends on nothing. Helpers that need logging take a minimal
  logger interface as a parameter.
- No `modules/`, `docker/`, or `tests/` until the phase that needs them.

Every app uses the same process shape: `src/main.ts` owns the process
lifecycle; app construction lives in a separate file so tests can build it
without starting the process.

Deviations from the phase specs:
- `apps/runtime/` (not in any spec): phase 5 needs a runtime entrypoint for
  the `helmrun-runtime` image. It's a separate process, so it's an app.
- `http/` merges the phase 0 spec's `middleware/` and `errors/` into one HTTP
  layer.
- `main.ts` instead of `server.ts` for the API, matching scheduler/worker in
  phase 3.
- `tsconfig.base.json` holds shared compiler options; each workspace extends it.

## Why
- Writing down the whole target keeps every phase heading the same way.
  Creating folders only when needed avoids empty workspaces to maintain and
  guessed boundaries. Each package's shape gets decided when its problem is
  understood.
- Scheduler and worker shells exist from phase 0 so the process lifecycle
  pattern (startup, shutdown, health, config) is proven on more than one app.

## Alternatives considered
- Create all folders now: empty workspaces add build/config churn, and early
  boundaries are usually wrong.
- Decide the structure phase by phase with no target: risks layouts that
  don't fit together across phases.

## Open
- Error model: the spec sketches `AppError` with an HTTP `statusCode`, but
  `AppError` lives in `shared` and the worker/runtime will throw errors too.
  Decide who maps errors to HTTP status. Settle when building the error model
  in phase 0.
- ~~Redis client: inside `apps/api` vs a package now.~~ Settled: `packages/redis`
  (decision 013, 2026-10-07); there is no `apps/api/src/redis.ts`.
- Where run-state transition logic lives once API, scheduler, worker, and
  recovery all change run state. Not `packages/runs` yet (phase 0 spec). Decide
  in phase 3; tracked in Deferred items.
