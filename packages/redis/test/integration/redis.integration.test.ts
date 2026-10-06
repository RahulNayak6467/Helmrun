import { setTimeout as sleep } from 'node:timers/promises';

import { Redis } from 'ioredis';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createRedisClient,
  type RedisConfig,
  type RedisConnection,
  type RedisLogger,
} from '../../src/index.js';
import { findClosedPort, requireTestRedisUrl } from '../support/test-redis.js';

const createLogger = () =>
  ({
    debug: vi.fn<RedisLogger['debug']>(),
    info: vi.fn<RedisLogger['info']>(),
    warn: vi.fn<RedisLogger['warn']>(),
    error: vi.fn<RedisLogger['error']>(),
  }) satisfies RedisLogger;

const loggedEvent = (event: string) =>
  [expect.objectContaining({ component: 'redis', event }), expect.any(String)] as const;

describe('real Valkey client', () => {
  let redisUrl: string;
  const openConnections: RedisConnection[] = [];
  const openAdminClients: Redis[] = [];

  beforeAll(() => {
    redisUrl = requireTestRedisUrl();
  });

  afterEach(() => {
    for (const connection of openConnections.splice(0)) connection.redisClient.disconnect();
    for (const admin of openAdminClients.splice(0)) admin.disconnect();
  });

  const connect = (logger: RedisLogger, overrides: Partial<RedisConfig> = {}): RedisConnection => {
    const connection = createRedisClient(
      { url: redisUrl, commandTimeoutMs: 500, connectTimeoutMs: 1_000, ...overrides },
      logger,
    );
    openConnections.push(connection);
    return connection;
  };

  const connectUnreachable = async (logger: RedisLogger): Promise<RedisConnection> => {
    const port = await findClosedPort();
    return connect(logger, { url: `redis://127.0.0.1:${String(port)}` });
  };

  const createAdminClient = (): Redis => {
    const admin = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    openAdminClients.push(admin);
    return admin;
  };

  it('connects to the test Valkey and logs redis_connected once', async () => {
    const logger = createLogger();

    connect(logger);

    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith(...loggedEvent('redis_connected'));
    });
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('runs a command once connected', async () => {
    const logger = createLogger();
    const { redisClient } = connect(logger);
    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith(...loggedEvent('redis_connected'));
    });

    const reply = await redisClient.ping();

    expect(reply).toBe('PONG');
  });

  it('warns redis_unavailable_at_startup only once while retrying an unreachable server', async () => {
    const logger = createLogger();
    await connectUnreachable(logger);

    // Long enough for at least two reconnect attempts at the 2 s retry cap.
    await sleep(4_500);

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      ...loggedEvent('redis_unavailable_at_startup'),
    );
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
      errorDetails: { code: 'ECONNREFUSED' },
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('rejects a command fast instead of hanging when the server is unreachable', async () => {
    const logger = createLogger();
    const { redisClient } = await connectUnreachable(logger);
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    const startedAt = performance.now();
    await expect(redisClient.ping()).rejects.toThrow();
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(200);
  });

  it('treats a wrong password as unavailable at startup and never logs either password', async () => {
    const logger = createLogger();
    const realPassword = decodeURIComponent(new URL(redisUrl).password);
    const wrongPassword = 'wrong-password-for-test';
    const wrongUrl = new URL(redisUrl);
    wrongUrl.password = wrongPassword;
    connect(logger, { url: wrongUrl.toString() });

    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(...loggedEvent('redis_unavailable_at_startup'));
    });
    // Long enough for at least one reconnect attempt at the 2 s retry cap.
    await sleep(2_500);

    expect(realPassword.length).toBeGreaterThan(0);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    const serialized = JSON.stringify([
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(serialized).not.toContain(wrongPassword);
    expect(serialized).not.toContain(realPassword);
  });

  it('closes a healthy client quickly and logs redis_closed', async () => {
    const logger = createLogger();
    const { redisClient, close } = connect(logger);
    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith(...loggedEvent('redis_connected'));
    });

    const startedAt = performance.now();
    await expect(close()).resolves.toBeUndefined();
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(1_000);
    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith(...loggedEvent('redis_closed'));
    });
    expect(redisClient.status).toBe('end');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('closes a never-connected client well within the close timeout bound', async () => {
    const logger = createLogger();
    const { close } = await connectUnreachable(logger);
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    const startedAt = performance.now();
    await expect(close()).resolves.toBeUndefined();
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(3_000);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('stops reconnecting after close() on a never-connected client', async () => {
    const logger = createLogger();
    const { redisClient, close } = await connectUnreachable(logger);
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledOnce();
    });
    const reconnectAttempts = vi.fn();
    redisClient.on('reconnecting', reconnectAttempts);

    await close();
    await sleep(2_500);

    expect(reconnectAttempts).not.toHaveBeenCalled();
  });

  it('logs redis_connection_lost then redis_connection_restored when the server drops the connection', async () => {
    const logger = createLogger();
    const { redisClient } = connect(logger);
    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith(...loggedEvent('redis_connected'));
    });
    const clientId = await redisClient.client('ID');
    const admin = createAdminClient();

    await admin.client('KILL', 'ID', String(clientId));

    await vi.waitFor(
      () => {
        expect(logger.error).toHaveBeenCalledWith(...loggedEvent('redis_connection_lost'));
      },
      { timeout: 2_000 },
    );
    await vi.waitFor(
      () => {
        expect(logger.info).toHaveBeenCalledWith(...loggedEvent('redis_connection_restored'));
      },
      { timeout: 5_000 },
    );
    const restored = logger.info.mock.calls.find(
      ([fields]) => fields.event === 'redis_connection_restored',
    );
    expect(typeof restored?.[0].downForMs).toBe('number');
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
