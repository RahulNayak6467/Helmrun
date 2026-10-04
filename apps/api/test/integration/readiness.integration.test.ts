import { createServer, type AddressInfo } from 'node:net';
import { once } from 'node:events';

import { createPool, type Pool } from '@helmrun/database';
import { createLogger } from '@helmrun/logger';
import { createLifecycleState, systemClock } from '@helmrun/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createReadinessChecker } from '../../src/health/readiness.js';

const READINESS_TIMEOUT_MS = 500;
const CONNECTION_TIMEOUT_MS = 3_000;

// Integration tests read TEST_DATABASE_URL only, never DATABASE_URL, so a value
// exported in the shell can't point them at the dev database.
const requireTestDatabaseUrl = (): string => {
  const url = process.env.TEST_DATABASE_URL;

  if (url === undefined || url.length === 0) {
    throw new Error('TEST_DATABASE_URL is required for integration tests (see .env.test.example)');
  }

  return url;
};

// A port with nothing listening: connections are refused.
const findClosedPort = async (): Promise<number> => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
};

const logger = createLogger({
  level: 'silent',
  pretty: false,
  service: 'test',
  environment: 'test',
});

describe('readiness against real PostgreSQL', () => {
  const pools: Pool[] = [];

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  // The real wiring: config-shaped pool, the readiness checker, the app route.
  const createReadinessApp = (url: string, poolMax = 2) => {
    const pool = createPool(
      {
        url,
        poolMax,
        connectionTimeoutMs: CONNECTION_TIMEOUT_MS,
        idleTimeoutMs: 1_000,
        statementTimeoutMs: 5_000,
        applicationName: 'helmrun-api-readiness-test',
      },
      logger,
    );
    pools.push(pool);
    const lifecycle = createLifecycleState();
    const checkReadiness = createReadinessChecker({
      databasePool: pool,
      lifecycle,
      timeoutMs: READINESS_TIMEOUT_MS,
      logger,
    });
    const app = createApp({ logger, clock: systemClock, checkReadiness });

    return { app, pool, lifecycle };
  };

  it('is ready (200) when PostgreSQL is available', async () => {
    const { app } = createReadinessApp(requireTestDatabaseUrl());

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
  });

  it('is not ready (503) when PostgreSQL refuses connections', async () => {
    const url = new URL(requireTestDatabaseUrl());
    url.port = String(await findClosedPort());
    const { app } = createReadinessApp(url.toString());

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready' });
  });

  // Every pool connection busy: the health query waits for a free client. The
  // probe must answer by its own deadline, not the pool's connection timeout.
  it('answers 503 by the readiness deadline when the pool is exhausted', async () => {
    const { app, pool } = createReadinessApp(requireTestDatabaseUrl(), 1);
    const blocker = pool.query('SELECT pg_sleep(2)');

    try {
      const startedAt = performance.now();
      const response = await request(app).get('/health/ready');
      const elapsedMs = performance.now() - startedAt;

      expect(response.status).toBe(503);
      expect(elapsedMs).toBeGreaterThanOrEqual(READINESS_TIMEOUT_MS - 50);
      expect(elapsedMs).toBeLessThan(CONNECTION_TIMEOUT_MS);
    } finally {
      await blocker;
    }
  });

  it('reports not ready (503) while draining, even with PostgreSQL up', async () => {
    const { app, lifecycle } = createReadinessApp(requireTestDatabaseUrl());
    lifecycle.beginDraining();

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
  });
});
