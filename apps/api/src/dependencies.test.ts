import { beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  createLogger: vi.fn(),
  createPool: vi.fn(),
  createRedisClient: vi.fn(),
  logger: { kind: 'fake-logger' },
  pool: { kind: 'fake-pool' },
  redis: { kind: 'fake-redis' },
}));

vi.mock('@helmrun/logger', () => ({ createLogger: doubles.createLogger }));
vi.mock('@helmrun/database', () => ({ createPool: doubles.createPool }));
vi.mock('@helmrun/redis', () => ({ createRedisClient: doubles.createRedisClient }));

import { systemClock } from '@helmrun/shared';

import { parseConfig } from './config.js';
import { AGENT_PAYLOAD_REDACT_PATHS, createDependencies, SERVICE_NAME } from './dependencies.js';

const config = parseConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://helmrun_test:password@127.0.0.1:5441/helmrun_test',
  REDIS_URL: 'redis://:password@127.0.0.1:6391',
  LOG_LEVEL: 'debug',
});

describe('createDependencies', () => {
  beforeEach(() => {
    doubles.createLogger.mockReset().mockReturnValue(doubles.logger);
    doubles.createPool.mockReset().mockReturnValue(doubles.pool);
    doubles.createRedisClient.mockReset().mockReturnValue(doubles.redis);
  });

  it('builds one logger, one pool and one Redis client and exposes them with the config and clock', () => {
    const dependencies = createDependencies(config);

    expect(doubles.createLogger).toHaveBeenCalledOnce();
    expect(doubles.createPool).toHaveBeenCalledOnce();
    expect(doubles.createRedisClient).toHaveBeenCalledOnce();
    expect(dependencies).toEqual({
      config,
      logger: doubles.logger,
      clock: systemClock,
      databasePool: doubles.pool,
      redis: doubles.redis,
    });
  });

  it('gives the Redis client the Redis config and the logger', () => {
    createDependencies(config);

    expect(doubles.createRedisClient).toHaveBeenCalledWith(
      config.redis,
      doubles.logger,
      systemClock,
    );
  });

  it('configures the logger from config, with the service name and agent payload redaction', () => {
    createDependencies(config);

    expect(doubles.createLogger).toHaveBeenCalledWith({
      level: 'debug',
      pretty: false,
      service: SERVICE_NAME,
      environment: 'test',
      extraRedactPaths: AGENT_PAYLOAD_REDACT_PATHS,
    });
    expect(AGENT_PAYLOAD_REDACT_PATHS).toEqual(
      expect.arrayContaining(['prompt', 'messages', 'llm.input', 'llm.output']),
    );
  });

  it('gives the pool the database config, the logger, and the service name as application name', () => {
    createDependencies(config);

    expect(doubles.createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        url: config.database.url,
        poolMax: config.database.poolMax,
        statementTimeoutMs: config.database.statementTimeoutMs,
        applicationName: SERVICE_NAME,
      }),
      doubles.logger,
    );
  });
});
