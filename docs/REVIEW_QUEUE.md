# Review queue

## Open

## Done
- [x] docker-compose.test.yml — test stack starts empty every run: Postgres on tmpfs, Valkey with `--save ""` and no AOF/volume, `restart: "no"` on both (fixed 2026-10-04)
- [x] docker-compose.yml:14,41 + docker-compose.test.yml:14,41 — `:?` required checks restored on port variables (fixed 2026-10-04)
- [x] docker-compose.yml:14,41 + docker-compose.test.yml:14,41 — bind address hardcoded to `127.0.0.1`; `*_HOST` variables removed (fixed 2026-10-04)
- [x] docker-compose.test.yml:14 — misleading `DB_HOST` / `DB_PORT` error messages (resolved by the same change, 2026-10-04)
