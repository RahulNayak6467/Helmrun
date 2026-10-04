import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { checkDatabaseHealth, createPool, type DatabaseLogger } from '../../src/index.js';
import {
  assertSafeTestDatabase,
  createIntegrationPool,
  requireTestDatabaseUrl,
} from '../support/test-database.js';

const APPLICATION_NAME = 'integration-pool-under-test';

const createLogger = () =>
  ({
    debug: vi.fn<DatabaseLogger['debug']>(),
    info: vi.fn<DatabaseLogger['info']>(),
    error: vi.fn<DatabaseLogger['error']>(),
  }) satisfies DatabaseLogger;

describe('real PostgreSQL pool', () => {
  let databaseUrl: string;
  let adminPool: Pool | undefined;

  const requireAdminPool = (): Pool => {
    if (adminPool === undefined) {
      throw new Error('Admin pool was not created');
    }

    return adminPool;
  };

  beforeAll(async () => {
    databaseUrl = requireTestDatabaseUrl();
    adminPool = createIntegrationPool(databaseUrl);
    await assertSafeTestDatabase({
      databasePool: adminPool,
      databaseUrl,
      runtimeEnvironment: process.env.NODE_ENV,
    });
  });

  afterAll(async () => {
    // If setup failed before the pool existed, let the original error stand.
    await adminPool?.end();
  });

  const createPoolUnderTest = (logger: DatabaseLogger): Pool =>
    createPool(
      {
        url: databaseUrl,
        poolMax: 2,
        connectionTimeoutMs: 2_000,
        idleTimeoutMs: 30_000,
        statementTimeoutMs: 1_000,
        applicationName: APPLICATION_NAME,
      },
      logger,
    );

  it('runs the health query against the test database', async () => {
    const pool = createPoolUnderTest(createLogger());

    try {
      await expect(checkDatabaseHealth(pool)).resolves.toBeUndefined();
    } finally {
      await pool.end();
    }
  });

  it('identifies its connections with the configured application name', async () => {
    const pool = createPoolUnderTest(createLogger());

    try {
      const result = await pool.query<{ application_name: string }>(
        "SELECT current_setting('application_name') AS application_name",
      );

      expect(result.rows[0]?.application_name).toBe(APPLICATION_NAME);
    } finally {
      await pool.end();
    }
  });

  it('enforces the statement timeout on a runaway query', async () => {
    const pool = createPoolUnderTest(createLogger());

    try {
      await expect(pool.query('SELECT pg_sleep(5)')).rejects.toMatchObject({ code: '57014' });
    } finally {
      await pool.end();
    }
  });

  it('logs and survives when an idle connection is killed by the server', async () => {
    const logger = createLogger();
    const pool = createPoolUnderTest(logger);

    try {
      // Open a connection and return it to the pool, so it sits idle.
      await pool.query('SELECT 1');
      expect(pool.idleCount).toBe(1);

      // Simulate a Postgres restart for that one connection.
      await requireAdminPool().query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE application_name = $1 AND pid <> pg_backend_pid()`,
        [APPLICATION_NAME],
      );

      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ event: 'postgres_idle_client_error' }),
          expect.any(String),
        );
      });

      // The pool discarded the broken client and still serves new queries.
      await expect(checkDatabaseHealth(pool)).resolves.toBeUndefined();
    } finally {
      await pool.end();
    }
  });
});
