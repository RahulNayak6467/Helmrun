import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseLogger } from './logger.js';

const poolTestDoubles = vi.hoisted(() => ({
  handlers: new Map<string, (...arguments_: unknown[]) => void>(),
  poolConstructor: vi.fn<(options: unknown) => void>(),
}));

vi.mock('pg', () => ({
  Pool: class PoolDouble {
    readonly totalCount = 4;
    readonly idleCount = 2;
    readonly waitingCount = 1;

    constructor(options: unknown) {
      poolTestDoubles.poolConstructor(options);
    }

    on(event: string, listener: (...arguments_: unknown[]) => void): this {
      poolTestDoubles.handlers.set(event, listener);
      return this;
    }
  },
}));

import { createPool, type DatabaseOptions } from './pool.js';

const options: DatabaseOptions = {
  url: 'postgresql://app:secret-password@127.0.0.1:5432/app_test',
  poolMax: 12,
  connectionTimeoutMs: 4_000,
  idleTimeoutMs: 11_000,
  statementTimeoutMs: 16_000,
  applicationName: 'example-api',
};

const logger = {
  debug: vi.fn<DatabaseLogger['debug']>(),
  info: vi.fn<DatabaseLogger['info']>(),
  error: vi.fn<DatabaseLogger['error']>(),
} satisfies DatabaseLogger;

const requireHandler = (event: string): ((...arguments_: unknown[]) => void) => {
  const handler = poolTestDoubles.handlers.get(event);

  if (handler === undefined) {
    throw new Error(`Expected a ${event} pool event handler`);
  }

  return handler;
};

describe('createPool', () => {
  beforeEach(() => {
    poolTestDoubles.handlers.clear();
    poolTestDoubles.poolConstructor.mockReset();
    logger.debug.mockReset();
    logger.info.mockReset();
    logger.error.mockReset();
  });

  it('constructs one pool with the complete bounded configuration', () => {
    createPool(options, logger);

    expect(poolTestDoubles.poolConstructor).toHaveBeenCalledOnce();
    expect(poolTestDoubles.poolConstructor).toHaveBeenCalledWith({
      connectionString: options.url,
      max: 12,
      connectionTimeoutMillis: 4_000,
      idleTimeoutMillis: 11_000,
      statement_timeout: 16_000,
      query_timeout: 18_000,
      application_name: 'example-api',
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
  });

  it('sets the client-side query deadline just above the server-side statement timeout', () => {
    createPool({ ...options, statementTimeoutMs: 5_000 }, logger);

    expect(poolTestDoubles.poolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ statement_timeout: 5_000, query_timeout: 7_000 }),
    );
  });

  it('logs only non-secret pool settings when the pool is configured', () => {
    createPool(options, logger);

    expect(logger.info).toHaveBeenCalledWith(
      {
        component: 'postgres',
        event: 'postgres_pool_configured',
        applicationName: 'example-api',
        maxConnections: 12,
        connectionTimeoutMs: 4_000,
        idleTimeoutMs: 11_000,
        statementTimeoutMs: 16_000,
      },
      expect.stringContaining('pool configured'),
    );

    const serialized = JSON.stringify(logger.info.mock.calls);
    expect(serialized).not.toContain(options.url);
    expect(serialized).not.toContain('secret-password');
  });

  it('registers an idle-client error listener so idle errors cannot crash the process', () => {
    createPool(options, logger);

    expect(poolTestDoubles.handlers.has('error')).toBe(true);
  });

  it('logs an idle-client error with safe pool state and does not throw', () => {
    createPool(options, logger);
    const error = Object.assign(new Error('connection terminated unexpectedly'), {
      code: '57P01',
    });

    expect(() => requireHandler('error')(error)).not.toThrow();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      {
        component: 'postgres',
        event: 'postgres_idle_client_error',
        err: {
          type: 'Error',
          message: 'connection terminated unexpectedly',
          stack: error.stack,
          code: '57P01',
        },
        totalConnections: 4,
        idleConnections: 2,
        waitingRequests: 1,
      },
      expect.stringContaining('idle client emitted an error'),
    );
  });

  it('does not log the connection string or internal client on an idle-client error', () => {
    createPool(options, logger);
    const error = Object.assign(new Error('connection terminated unexpectedly'), {
      client: { connectionParameters: { connectionString: options.url } },
    });

    requireHandler('error')(error);

    const serialized = JSON.stringify(logger.error.mock.calls);
    expect(serialized).not.toContain(options.url);
    expect(serialized).not.toContain('secret-password');
    expect(serialized).not.toContain('connectionParameters');
  });

  it('logs new connections at debug level', () => {
    createPool(options, logger);

    requireHandler('connect')();

    expect(logger.debug).toHaveBeenCalledWith(
      { component: 'postgres', event: 'postgres_connection_opened' },
      expect.any(String),
    );
  });
});
