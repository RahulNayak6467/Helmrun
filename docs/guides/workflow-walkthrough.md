# Workflow walkthrough: caching API-key lookups

An end-to-end example of how one feature goes through the Helmrun workflow.
The feature is real (phase 1 auth), but this code is **illustrative**: it
shows the process, not the implementation you must copy. When phase 1
arrives, you design and write your own.

```text
/problem → design check → build (blocker flags) → /review (rounds) → tests → /wrap
                                                             phase end → /review fresh → /drill
```

---

## Step 1: `/problem`

You type `/problem api key lookup caching`. My reply:

> Every authenticated request runs the auth middleware, which hashes the key
> and looks it up in `api_keys`. That's a Postgres round trip on every single
> request, before any real work happens. At a few hundred requests a second,
> auth alone becomes your biggest DB load. Caching the lookup in Redis takes
> that load away.
>
> What breaks without care: caching auth data is caching a *security
> decision*. Picture it: a customer's key leaks, they revoke it, and it keeps
> working for an hour because the "valid" answer is sitting in Redis. A cache
> bug here is a security incident, not a stale page.
>
> The naive version: `redis.get(apiKey)` → on miss, query the DB →
> `redis.set(apiKey, row)`. It has three traps: the raw secret becomes a Redis
> key (visible to anyone who runs `KEYS *` or reads a Redis snapshot),
> revocation doesn't take effect, and when Redis goes down, every request
> fails, even though Postgres is fine.
>
> Concepts you need: cache-aside, TTL vs explicit invalidation,
> fail-open vs fail-closed, cache stampede, why SHA-256 is fine for API keys
> but not for passwords.
>
> Read before coding:
> - Redis docs, "Client-side caching" intro + `SET` with `EX`: the TTL
>   semantics you'll rely on.
> - AWS Builders' Library, "Caching challenges and strategies": stampedes,
>   negative caching, cache as a dependency.
> - OWASP API Security Top 10, API2 (Broken Authentication): what goes
>   wrong in key handling.
>
> Before you code, answer these in a few bullets:
> 1. What exactly is the cache key, and what's in the cached value?
> 2. A key is revoked. How long can it keep working, worst case?
> 3. Redis is down. Does a request with a valid key succeed or fail?
> 4. Someone sends 10,000 random keys. What does each one cost you?

---

## Step 2: Design check

This feature touches state and security, so a design check is required.
You reply with bullets:

> - Cache key: `apikey:<sha256 of key>`, value: the `api_keys` row.
> - TTL 1 hour. On revoke, delete the cache entry.
> - Redis down: return 503, auth can't run without the cache.
> - Random keys: they miss the cache and the DB returns nothing, fine.

My design review: 2 issues, most severe first.

> Revocation first. You delete on revoke, good, but what if that delete
> fails? Redis blips, the delete throws, and the revoked key works for up to
> an hour. Your worst case is set by the TTL, not by the delete. So what TTL
> can you defend to a customer whose key just leaked?
>
> Second, Redis down → 503. That turns an optional speed-up into a hard
> dependency: Redis dies and your whole API goes with it, while Postgres,
> the actual source of truth, is healthy. The phase 0 rule was "Redis is
> disposable". What should the fallback be?
>
> Small things: cache only the fields auth needs (`id`, `tenant_id`,
> `scopes`, `expires_at`), not the row. `key_hash` doesn't belong in a
> cache value or on `req`. Question 4 isn't "fine": every random key is a DB
> query, so 10k random keys = 10k queries. Think about it, but rate limiting
> (also phase 1) is the main defence.

Your revised design:

> - Cache key `v1:apikey:<sha256>`. Value: `{ keyId, tenantId, scopes, expiresAt }`.
> - TTL 60s (+ jitter). Delete on revoke, after the DB update commits.
>   Worst case revocation delay = 60s if the delete fails. Documented as a decision.
> - Redis down or slow → fall back to Postgres. Never "allow" without the DB.
> - Cache "not found" for 10s so repeated bad keys don't all hit the DB.
> - Expiry checked on every request, not only via TTL.

That design is solid. Now you build.

---

## Step 3: Build (blocker flags only)

Halfway through, you show me the cache write and ask "does this look
right?":

```ts
await redis.set(`v1:apikey:${apiKey}`, JSON.stringify(entry), 'EX', 60);
```

I answer the question and flag only the blocker:

> Heads up, blocker: that's the raw key in the Redis key, not the hash.
> Your design says sha256. Worth fixing now, since everything downstream
> uses this key.

Nothing else gets mentioned mid-build. The rest waits for `/review`.

### Your first complete version

`apps/api/src/modules/auth/auth.middleware.ts`

```ts
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Pool } from 'pg';

const POSITIVE_TTL = 60;
const NEGATIVE_TTL = 10;

export function createAuthMiddleware(pool: Pool, redis: Redis, logger: Logger) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) {
      return res.status(401).json({ error: 'missing api key' });
    }

    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    const cacheKey = `v1:apikey:${keyHash}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      const entry = JSON.parse(cached);
      if (entry.missing) {
        return res.status(401).json({ error: 'invalid api key' });
      }
      req.auth = entry;
      return next();
    }

    const { rows } = await pool.query(
      `SELECT * FROM api_keys
        WHERE key_hash = $1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())`,
      [keyHash],
    );

    if (rows.length === 0) {
      logger.warn({ apiKey }, 'invalid api key');
      await redis.set(cacheKey, JSON.stringify({ missing: true }), 'EX', NEGATIVE_TTL);
      return res.status(401).json({ error: 'invalid api key' });
    }

    const row = rows[0];
    const entry = {
      keyId: row.id,
      tenantId: row.tenant_id,
      scopes: row.scopes,
      expiresAt: row.expires_at,
    };
    await redis.set(cacheKey, JSON.stringify(entry), 'EX', POSITIVE_TTL);

    req.auth = entry;
    next();
  };
}
```

`apps/api/src/modules/auth/api-key.service.ts` (revoke)

```ts
export async function revokeApiKey(pool: Pool, redis: Redis, tenantId: string, keyId: string) {
  const { rows } = await pool.query(
    'SELECT key_hash FROM api_keys WHERE id = $1 AND tenant_id = $2',
    [keyId, tenantId],
  );
  if (rows.length === 0) throw new Error('not found');

  await redis.del(`v1:apikey:${rows[0].key_hash}`);
  await pool.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [keyId]);
}
```

It works locally: valid keys pass, bad keys get 401, the second request is
served from Redis. This is a normal, good first version. Now `/review`.

---

## Step 4: `/review`, round 1

The review finds 9 things and queues all of them. You see this:

> Checked: security, failure, concurrency, data integrity, performance,
> observability. Skipped: scalability (only the cache itself is shared
> state, and it's in Redis).
>
> **1. The raw API key is written to logs.** `auth.middleware.ts:44`:
> `logger.warn({ apiKey }, ...)`. Every failed attempt, including a
> customer's real key with a typo in one character, ends up in your log
> pipeline, readable by anyone with log access and kept for weeks. Logs are
> the most common place secrets leak from. What could you log instead that
> still lets you debug a failed auth?
>
> **2. Redis failures take down every authenticated request.**
> `auth.middleware.ts:23`: `redis.get` isn't guarded. If Redis is
> unreachable, it throws, and since this is an async handler, the rejection
> either hangs the request (Express 4) or becomes a 500 (Express 5). Your
> design said "fall back to Postgres", but the code doesn't. Where should
> the try/catch sit so a cache failure means "cache miss" rather than
> "request failed"?
>
> Small fixes:
> - `:13`: `as string` hides that headers can be `string[]`. Use `req.get()`.
> - `:15`, `:26`, `:47`: build the error envelope through `AppError` +
>   error middleware, not inline `res.json`.
> - `:31`: `SELECT *` pulls `key_hash` and future columns. Name the columns.
>
> 4 important issues left. Next: a race between revoke and a concurrent
> request.

`docs/REVIEW_QUEUE.md` now holds all 9. You fix 1 and 2 plus the small
fixes, then type `/review next`.

## Step 5: `/review next`, round 2

> Fixed: log leak ✓, Redis guard ✓, all 3 small fixes ✓.
>
> **3. Revoke deletes the cache *before* the DB update, which re-opens the
> key.** `api-key.service.ts:8-9`. Timeline: revoke deletes the cache entry
> → a request arrives, misses the cache, reads the DB (not revoked yet), and
> writes "active" back to Redis → revoke's UPDATE commits. The key is now
> revoked in Postgres but cached as valid for 60s. Under load this isn't
> rare. Which order closes most of this window, and what window is left even
> then?
>
> **4. Expiry is only checked in SQL, never on a cache hit.**
> `auth.middleware.ts:25-31`. A key that expires at 12:00:30, cached at
> 12:00:00, works until 12:01:00. Your design said "expiry checked on every
> request". Where does that check need to live?
>
> 2 left. Next: many concurrent misses on the same key.

## Step 6: `/review next`, round 3

> Fixed: revoke order ✓ (and you noted the leftover window in the decision,
> good), expiry ✓.
>
> **5. Cache stampede on hot keys.** When a busy customer's entry expires,
> every request in that instant misses and queries Postgres: 200 in-flight
> requests = 200 identical queries. TTL jitter spreads expiries across keys
> but not across requests for the *same* key. How could one instance make
> sure only one DB lookup per key is in flight?
>
> **6. Cached JSON is trusted blindly.** `JSON.parse` returns `any` and goes
> straight onto `req.auth`. After a deploy that changes the entry shape, or
> any corrupted value, auth runs on garbage. Validate with Zod on read, and
> treat a bad entry as a miss.
>
> Queue empty after these.

---

## The production version (after all rounds)

Same feature, now split by responsibility. Every line here you wrote, one
review round at a time.

`apps/api/src/redis.ts` (client config that makes "fall back" actually fast)

```ts
import { Redis } from 'ioredis';

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    // Fail commands fast instead of queueing them while disconnected.
    // Without this, a Redis outage makes every request wait, not fall back.
    enableOfflineQueue: false,
    commandTimeout: 50,
    maxRetriesPerRequest: 1,
  });
}
```

`apps/api/src/modules/auth/api-key.hash.ts`

```ts
import { createHash } from 'node:crypto';

// hr_live_<8-char prefix>_<43-char base64url secret>
const API_KEY_FORMAT = /^hr_live_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/;

export function isWellFormedApiKey(value: string): boolean {
  return API_KEY_FORMAT.test(value);
}

// SHA-256 (not bcrypt) is correct here: keys are 256-bit random, so there is
// nothing to brute-force, and auth runs on every request so it must be cheap.
// Passwords are low-entropy and need a slow hash; API keys don't.
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}
```

`apps/api/src/modules/auth/api-key.cache.ts`

```ts
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { z } from 'zod';

const KEY_PREFIX = 'v1:apikey:';
const ACTIVE_TTL_SECONDS = 60;
const MISSING_TTL_SECONDS = 10;
const MAX_JITTER_SECONDS = 10;

const cacheEntrySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('active'),
    keyId: z.string().uuid(),
    tenantId: z.string().uuid(),
    scopes: z.array(z.string()),
    expiresAt: z.string().datetime().nullable(),
  }),
  z.object({ status: z.literal('missing') }),
]);

export type ApiKeyCacheEntry = z.infer<typeof cacheEntrySchema>;

export interface ApiKeyCache {
  get(keyHash: string): Promise<ApiKeyCacheEntry | null>;
  set(keyHash: string, entry: ApiKeyCacheEntry): Promise<void>;
  delete(keyHash: string): Promise<boolean>;
}

interface ApiKeyCacheDeps {
  redis: Redis;
  logger: Logger;
}

export function createApiKeyCache({ redis, logger }: ApiKeyCacheDeps): ApiKeyCache {
  const toCacheKey = (keyHash: string) => `${KEY_PREFIX}${keyHash}`;

  async function remove(keyHash: string): Promise<boolean> {
    try {
      await redis.del(toCacheKey(keyHash));
      return true;
    } catch (err) {
      logger.warn({ err }, 'api key cache delete failed');
      return false;
    }
  }

  return {
    async get(keyHash) {
      let raw: string | null;
      try {
        raw = await redis.get(toCacheKey(keyHash));
      } catch (err) {
        logger.warn({ err }, 'api key cache read failed, falling back to database');
        return null;
      }
      if (raw === null) return null;

      const parsed = cacheEntrySchema.safeParse(parseJson(raw));
      if (!parsed.success) {
        logger.warn('discarding malformed api key cache entry');
        await remove(keyHash);
        return null;
      }
      return parsed.data;
    },

    async set(keyHash, entry) {
      const baseTtl = entry.status === 'active' ? ACTIVE_TTL_SECONDS : MISSING_TTL_SECONDS;
      const ttl = baseTtl + Math.floor(Math.random() * MAX_JITTER_SECONDS);
      try {
        await redis.set(toCacheKey(keyHash), JSON.stringify(entry), 'EX', ttl);
      } catch (err) {
        logger.warn({ err }, 'api key cache write failed');
      }
    },

    delete: remove,
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
```

`apps/api/src/modules/auth/api-key.repository.ts`

```ts
import type { Pool } from 'pg';

export interface ActiveApiKey {
  keyId: string;
  tenantId: string;
  scopes: string[];
  expiresAt: Date | null;
}

interface ActiveApiKeyRow {
  id: string;
  tenant_id: string;
  scopes: string[];
  expires_at: Date | null;
}

export interface ApiKeyRepository {
  findActiveByHash(keyHash: string): Promise<ActiveApiKey | null>;
  revoke(tenantId: string, keyId: string): Promise<{ keyHash: string } | null>;
}

export function createApiKeyRepository(pool: Pool): ApiKeyRepository {
  return {
    async findActiveByHash(keyHash) {
      const { rows } = await pool.query<ActiveApiKeyRow>(
        `SELECT id, tenant_id, scopes, expires_at
           FROM api_keys
          WHERE key_hash = $1
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())`,
        [keyHash],
      );
      const row = rows[0];
      if (!row) return null;

      return {
        keyId: row.id,
        tenantId: row.tenant_id,
        scopes: row.scopes,
        expiresAt: row.expires_at,
      };
    },

    // One statement: the tenant check, the "not already revoked" check, and
    // the write are atomic. It returns the hash so the caller can invalidate.
    async revoke(tenantId, keyId) {
      const { rows } = await pool.query<{ key_hash: string }>(
        `UPDATE api_keys
            SET revoked_at = now()
          WHERE id = $1
            AND tenant_id = $2
            AND revoked_at IS NULL
          RETURNING key_hash`,
        [keyId, tenantId],
      );
      const row = rows[0];
      return row ? { keyHash: row.key_hash } : null;
    },
  };
}
```

`apps/api/src/modules/auth/auth.service.ts`

```ts
import type { Logger } from 'pino';

import type { ApiKeyCache, ApiKeyCacheEntry } from './api-key.cache.js';
import { hashApiKey, isWellFormedApiKey } from './api-key.hash.js';
import type { ApiKeyRepository } from './api-key.repository.js';
import { ApiKeyNotFoundError, InvalidApiKeyError } from './auth.errors.js';

export interface Principal {
  keyId: string;
  tenantId: string;
  scopes: string[];
}

interface AuthServiceDeps {
  repository: ApiKeyRepository;
  cache: ApiKeyCache;
  logger: Logger;
  now?: () => number;
}

export function createAuthService({ repository, cache, logger, now = Date.now }: AuthServiceDeps) {
  // Single-flight: concurrent misses for the same key share one DB lookup
  // per instance instead of stampeding Postgres.
  const inFlight = new Map<string, Promise<ApiKeyCacheEntry>>();

  async function loadFromDatabase(keyHash: string): Promise<ApiKeyCacheEntry> {
    const key = await repository.findActiveByHash(keyHash);
    const entry: ApiKeyCacheEntry = key
      ? {
          status: 'active',
          keyId: key.keyId,
          tenantId: key.tenantId,
          scopes: key.scopes,
          expiresAt: key.expiresAt?.toISOString() ?? null,
        }
      : { status: 'missing' };

    await cache.set(keyHash, entry);
    return entry;
  }

  function loadOnce(keyHash: string): Promise<ApiKeyCacheEntry> {
    const pending = inFlight.get(keyHash);
    if (pending) return pending;

    const load = loadFromDatabase(keyHash).finally(() => inFlight.delete(keyHash));
    inFlight.set(keyHash, load);
    return load;
  }

  return {
    async authenticate(rawKey: string): Promise<Principal> {
      // Reject garbage before touching Redis or Postgres.
      if (!isWellFormedApiKey(rawKey)) throw new InvalidApiKeyError();

      const keyHash = hashApiKey(rawKey);
      const entry = (await cache.get(keyHash)) ?? (await loadOnce(keyHash));

      if (entry.status === 'missing') throw new InvalidApiKeyError();

      // Checked on every request: the cache TTL must never extend a key's life.
      if (entry.expiresAt !== null && Date.parse(entry.expiresAt) <= now()) {
        throw new InvalidApiKeyError();
      }

      return { keyId: entry.keyId, tenantId: entry.tenantId, scopes: entry.scopes };
    },

    async revoke(tenantId: string, keyId: string): Promise<void> {
      // DB first (it commits on return), cache second. Deleting first lets a
      // concurrent request re-cache the key as active before the revoke lands.
      const revoked = await repository.revoke(tenantId, keyId);
      if (!revoked) throw new ApiKeyNotFoundError();

      const invalidated = await cache.delete(revoked.keyHash);
      if (!invalidated) {
        // Decision 0NN: worst-case revocation delay is the active TTL (≤70s).
        logger.error({ keyId, tenantId }, 'api key revoked but cache invalidation failed');
      }
    },
  };
}
```

`apps/api/src/modules/auth/auth.middleware.ts`

```ts
import type { RequestHandler } from 'express';

import { MissingApiKeyError } from './auth.errors.js';
import type { createAuthService } from './auth.service.js';

type AuthService = ReturnType<typeof createAuthService>;

export function createAuthMiddleware(authService: AuthService): RequestHandler {
  return async (req, _res, next) => {
    try {
      const rawKey = parseBearerToken(req.get('authorization'));
      if (!rawKey) throw new MissingApiKeyError();

      req.auth = await authService.authenticate(rawKey);
      next();
    } catch (err) {
      // The error middleware maps auth errors to 401 with the standard
      // envelope, and logs keyId/requestId, never the key.
      next(err);
    }
  };
}

function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token, ...rest] = header.split(' ');
  if (scheme !== 'Bearer' || !token || rest.length > 0) return null;
  return token;
}
```

What changed from your first version, and which review round caught it:

| Change | Lens | Round |
|---|---|---|
| Hash, never the raw key, in Redis | Security | Build (blocker) |
| No secrets in logs | Security | 1 |
| Every Redis call fails to "miss", fast (`enableOfflineQueue: false`) | Failure | 1 |
| Errors through `AppError` + `next(err)` | Design | 1 (small) |
| Named columns, tenant-scoped atomic revoke | Data integrity | 1 (small) |
| DB update before cache delete; leftover window documented | Concurrency | 2 |
| Expiry checked on every request | Correctness | 2 |
| Single-flight per key | Concurrency / performance | 3 |
| Zod-validated cache entries | Security / correctness | 3 |
| Format check before any I/O | Performance | (your own idea) |

---

## Step 7: Tests

You write your cases in plain English:

> 1. Valid key authenticates and returns its tenant.
> 2. Revoked key is rejected.
> 3. Second request is served from cache (DB not queried).
> 4. Redis down: valid key still authenticates from the DB.

Then: *"Use the tester on `apps/api/src/modules/auth` with these cases."*
It writes them, runs them, and reports:

> Written: `auth.service.test.ts`, 4 cases (all yours). 4/4 pass.
>
> Cases you didn't cover:
> 1. 50 concurrent misses for one key → exactly 1 DB query (catches a broken
>    single-flight).
> 2. Revoke then authenticate on the same instance → rejected immediately
>    (catches cache-before-DB ordering regressions).
> 3. Key cached as active, then passes its `expiresAt` → rejected before the
>    TTL ends.
> 4. Malformed cache entry → falls back to DB and deletes the entry.
> 5. Cache delete fails during revoke → revoke still succeeds and logs an error.
> 6. Badly formatted key → no cache or DB call at all.

You pick 1, 2, 3 and 5. It writes them. Part of the result:

`apps/api/src/modules/auth/auth.service.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';

import type { ApiKeyCache, ApiKeyCacheEntry } from './api-key.cache.js';
import type { ActiveApiKey, ApiKeyRepository } from './api-key.repository.js';
import { InvalidApiKeyError } from './auth.errors.js';
import { createAuthService } from './auth.service.js';

const VALID_KEY = `hr_live_abcd1234_${'a'.repeat(43)}`;
const logger = pino({ level: 'silent' });

const activeKey: ActiveApiKey = {
  keyId: '0b9c3a52-6a3e-4a8c-9f0a-1c2d3e4f5a6b',
  tenantId: '7f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
  scopes: ['runs:write'],
  expiresAt: null,
};

function createInMemoryCache(): ApiKeyCache {
  const store = new Map<string, ApiKeyCacheEntry>();
  return {
    get: async (hash) => store.get(hash) ?? null,
    set: async (hash, entry) => void store.set(hash, entry),
    delete: async (hash) => store.delete(hash) || true,
  };
}

function createUnavailableCache(): ApiKeyCache {
  // Mirrors the real cache's contract under a Redis outage: misses, never throws.
  return {
    get: async () => null,
    set: async () => undefined,
    delete: async () => false,
  };
}

function createRepository(key: ActiveApiKey | null): ApiKeyRepository {
  return {
    findActiveByHash: vi.fn(async () => key),
    revoke: vi.fn(async () => (key ? { keyHash: 'hash' } : null)),
  };
}

describe('auth service', () => {
  it('serves the second request from cache without querying the database', async () => {
    const repository = createRepository(activeKey);
    const service = createAuthService({ repository, cache: createInMemoryCache(), logger });

    await service.authenticate(VALID_KEY);
    const principal = await service.authenticate(VALID_KEY);

    expect(principal.tenantId).toBe(activeKey.tenantId);
    expect(repository.findActiveByHash).toHaveBeenCalledTimes(1);
  });

  it('authenticates from the database when the cache is unavailable', async () => {
    const repository = createRepository(activeKey);
    const service = createAuthService({ repository, cache: createUnavailableCache(), logger });

    const principal = await service.authenticate(VALID_KEY);

    expect(principal).toEqual({
      keyId: activeKey.keyId,
      tenantId: activeKey.tenantId,
      scopes: activeKey.scopes,
    });
  });

  it('runs one database lookup for 50 concurrent misses on the same key', async () => {
    const repository = createRepository(activeKey);
    const service = createAuthService({ repository, cache: createInMemoryCache(), logger });

    await Promise.all(Array.from({ length: 50 }, () => service.authenticate(VALID_KEY)));

    expect(repository.findActiveByHash).toHaveBeenCalledTimes(1);
  });

  it('rejects a cached key once it passes its expiry, before the TTL ends', async () => {
    let currentTime = Date.parse('2027-01-01T12:00:00Z');
    const expiring = { ...activeKey, expiresAt: new Date('2027-01-01T12:00:30Z') };
    const service = createAuthService({
      repository: createRepository(expiring),
      cache: createInMemoryCache(),
      logger,
      now: () => currentTime,
    });

    await service.authenticate(VALID_KEY);
    currentTime = Date.parse('2027-01-01T12:00:31Z');

    await expect(service.authenticate(VALID_KEY)).rejects.toBeInstanceOf(InvalidApiKeyError);
  });
});
```

Notice the `now` dependency in `createAuthService`: case 3 needed a
controllable clock, which is why the production code takes `now` as a
parameter instead of calling `Date.now()` directly. Tests often push design
improvements back into the code.

---

## Step 8: `/wrap`

> Updated:
> - `docs/progress/phase-1.md`: API-key cache done; next step is rate
>   limiting.
> - `docs/decisions/0NN-api-key-cache.md`: 60s TTL + delete-after-commit.
>   Worst-case revocation delay ≤70s if the cache delete fails. Alternatives:
>   no cache (DB load on every request), pub/sub invalidation (more moving
>   parts than the risk justifies for V1).
> - `docs/REVIEW_QUEUE.md`: 6 items moved to Done.
>
> Commit message:
> ```
> Cache API-key lookups with fail-open Redis and bounded revocation
>
> Cache-aside on the key hash with 60s TTL + jitter, negative caching,
> per-instance single-flight, and Zod-validated entries. Redis failures
> fall back to Postgres. Revocation updates the DB before invalidating.
> ```

You commit.

---

## At the end of the phase

`/review fresh` sends the whole phase to the `reviewer` subagent, which
sees the code with no knowledge of our discussions. Then `/drill`:

> "Walk me through what happens when a customer revokes a key while three
> API instances are serving requests with it."
>
> *(you answer)*
>
> "And if the Redis delete fails at that moment?"

If you can answer that cleanly, including the 70-second worst case and why
you accepted it, the feature is done in the way that matters for interviews.
