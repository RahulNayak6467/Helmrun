# Review queue

## Open

## Done
- [x] packages/config/src/environment.ts — `NODE_ENV` required (no default); missing value fails closed instead of running as development (fixed 2026-10-04)
- [x] apps/api/src/config.ts — server durations bounded (≤ 300,000 ms, far below Node's 2^31-1 ms timer limit) with field-specific messages, via shared `integerEnv` (fixed 2026-10-04)
- [x] packages/config/src/database.ts — empty `DATABASE_URL` reports one issue (`abort: true` on `.min(1)`) (fixed 2026-10-04)
- [x] packages/config/src/integer.ts — numeric env values accept plain digits only (rejects `0x1F90`, `1e3`, padded values) (fixed 2026-10-04)
- [x] packages/config/package.json + apps/*/package.json — `zod` declared once via pnpm `catalog:`; peer dependency of `@helmrun/config`. Original concern (instanceof across copies) was wrong for Zod 4, which checks a trait; real risk is a major-version split or mixing schema pieces across copies (fixed 2026-10-04)
- [x] docker-compose.yml:14,41 + docker-compose.test.yml:14,41 — bind address hardcoded to `127.0.0.1`; `*_HOST` variables removed (fixed 2026-10-04)
- [x] docker-compose.test.yml:14 — misleading `DB_HOST` / `DB_PORT` error messages (resolved by the same change, 2026-10-04)
- [x] docker-compose.yml:14,41 + docker-compose.test.yml:14,41 — `:?` required checks restored on port variables (fixed 2026-10-04)
- [x] docker-compose.test.yml — test stack starts empty every run: Postgres on tmpfs, Valkey with `--save ""` and no AOF/volume, `restart: "no"` on both (fixed 2026-10-04)
