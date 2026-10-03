# 006: Workspace packages resolve to source in dev, dist in production (2026-10-03)

Phase: 0
Status: Accepted

## Decision
Every workspace package exports two entry points:

```json
"exports": {
  ".": {
    "@helmrun/source": "./src/index.ts",
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

- Typechecking, ESLint, editors: `customConditions: ["@helmrun/source"]` in
  `tsconfig.base.json` → source.
- Tests: Vitest `resolve.conditions` and `ssr.resolve.conditions` include
  `@helmrun/source` → source.
- Dev runs: `node --conditions=@helmrun/source --import tsx src/main.ts` → source.
- Builds: each `tsconfig.build.json` sets `customConditions: []` → packages are
  consumed from `dist/`, built in dependency order by `pnpm -r build`.
- Production: `node dist/main.js` has no custom condition → `dist/`.

`src/index.ts` is each package's only public entry point; anything not
exported from it is private to the package.

## Why
With compiled-output-only packages, every change needs a rebuild or a watch
process before apps see it, and forgetting means testing stale code. Source
resolution removes that build step everywhere except real builds, while
production still runs plain compiled JavaScript.

Verified in a scratch copy (2026-10-03): typecheck, lint, tests, build, prod
start (resolves `dist/`), and dev run (resolves `src/`). Without the Vitest
`ssr.resolve.conditions` setting, tests fail to resolve workspace packages.

## Alternatives considered
- Compiled output only: simplest model, but needs build/watch steps in dev.
- TypeScript project references (`tsc -b`): solves build ordering, but adds
  `composite`/references config in every workspace; `pnpm -r build` already
  builds in dependency order.
- Bundling apps (tsup/esbuild): not needed until deployment requires it.
