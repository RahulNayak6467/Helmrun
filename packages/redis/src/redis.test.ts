import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedisLogger } from './logger.js';

const redisTestDoubles = vi.hoisted(() => ({
  redisConstructor: vi.fn<(url: unknown, options: unknown) => void>(),
  quit: vi.fn<() => Promise<'OK'>>(),
  disconnect: vi.fn<() => void>(),
}));

vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('node:events');

  class RedisDouble extends EventEmitter {
    status = 'connecting';
    readonly quit = (): Promise<'OK'> => redisTestDoubles.quit();
    readonly disconnect = (): void => {
      redisTestDoubles.disconnect();
    };

    constructor(url: unknown, options: unknown) {
      super();
      redisTestDoubles.redisConstructor(url, options);
    }

    // Like ioredis, status changes before the matching event is emitted.
    override emit(event: string | symbol, ...args: unknown[]): boolean {
      if (event === 'ready') this.status = 'ready';
      if (event === 'close') this.status = 'reconnecting';
      if (event === 'end') this.status = 'end';
      return super.emit(event, ...args);
    }
  }

  return { Redis: RedisDouble };
});

import { createRedisClient, type RedisConfig } from './redis.js';

const SECRET_PASSWORD = 'secret-pass';

const options: RedisConfig = {
  url: `redis://:${SECRET_PASSWORD}@127.0.0.1:6379`,
  commandTimeoutMs: 150,
  connectTimeoutMs: 3_000,
};

const createLogger = () =>
  ({
    debug: vi.fn<RedisLogger['debug']>(),
    info: vi.fn<RedisLogger['info']>(),
    warn: vi.fn<RedisLogger['warn']>(),
    error: vi.fn<RedisLogger['error']>(),
  }) satisfies RedisLogger;

const createReadyClient = (logger = createLogger()) => {
  const connection = createRedisClient(options, logger);
  connection.redisClient.emit('ready');
  return connection;
};

const connectionRefused = (): Error =>
  Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
    code: 'ECONNREFUSED',
    syscall: 'connect',
    address: '127.0.0.1',
    port: 6379,
  });

const requireConstructorOptions = (): Record<string, unknown> => {
  const call = redisTestDoubles.redisConstructor.mock.calls[0];
  const constructorOptions: unknown = call?.[1];

  if (typeof constructorOptions !== 'object' || constructorOptions === null) {
    throw new Error('Expected the Redis client to be constructed with an options object');
  }

  return { ...constructorOptions };
};

const requireRetryStrategy = (): ((times: number) => unknown) => {
  const retryStrategy = requireConstructorOptions().retryStrategy;

  if (typeof retryStrategy !== 'function') {
    throw new Error('Expected a retryStrategy function');
  }

  return (times: number): unknown => Reflect.apply(retryStrategy, undefined, [times]);
};

describe('createRedisClient', () => {
  beforeEach(() => {
    redisTestDoubles.redisConstructor.mockReset();
    redisTestDoubles.quit.mockReset();
    redisTestDoubles.quit.mockResolvedValue('OK');
    redisTestDoubles.disconnect.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('client options', () => {
    it('constructs one client from the url with fail-fast options', () => {
      createRedisClient(options, createLogger());

      expect(redisTestDoubles.redisConstructor).toHaveBeenCalledOnce();
      expect(redisTestDoubles.redisConstructor).toHaveBeenCalledWith(
        options.url,
        expect.objectContaining({
          enableOfflineQueue: false,
          commandTimeout: 150,
          connectTimeout: 3_000,
        }),
      );
    });

    it('uses a low maxRetriesPerRequest so a failing command is not retried at length', () => {
      createRedisClient(options, createLogger());

      const maxRetriesPerRequest = requireConstructorOptions().maxRetriesPerRequest;

      expect(typeof maxRetriesPerRequest).toBe('number');
      expect(maxRetriesPerRequest).toBeGreaterThanOrEqual(0);
      expect(maxRetriesPerRequest).toBeLessThanOrEqual(2);
    });

    it('passes the configured timeouts through instead of fixed values', () => {
      createRedisClient(
        { ...options, commandTimeoutMs: 120, connectTimeoutMs: 1_500 },
        createLogger(),
      );

      expect(redisTestDoubles.redisConstructor).toHaveBeenCalledWith(
        options.url,
        expect.objectContaining({ commandTimeout: 120, connectTimeout: 1_500 }),
      );
    });

    it('retry strategy never gives up and never waits longer than 2000 ms', () => {
      createRedisClient(options, createLogger());
      const retryStrategy = requireRetryStrategy();

      for (const times of [1, 2, 3, 5, 10, 50, 100, 1_000, 100_000]) {
        const delay = retryStrategy(times);

        expect(typeof delay).toBe('number');
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(2_000);
      }
    });

    it('retry delay grows with each attempt, from the minimum to the cap', () => {
      createRedisClient(options, createLogger());
      const retryStrategy = requireRetryStrategy();
      vi.spyOn(Math, 'random').mockReturnValue(0);

      expect(retryStrategy(1)).toBe(50);
      expect(retryStrategy(2)).toBe(100);
      expect(retryStrategy(3)).toBe(200);
      expect(retryStrategy(20)).toBe(1_000);
    });

    it('retry delay is jittered within the upper half of its ceiling', () => {
      createRedisClient(options, createLogger());
      const retryStrategy = requireRetryStrategy();
      const random = vi.spyOn(Math, 'random');

      random.mockReturnValue(0);
      expect(retryStrategy(20)).toBe(1_000);
      random.mockReturnValue(0.999_999);
      expect(retryStrategy(20)).toBe(2_000);
      random.mockReturnValue(0.5);
      expect(retryStrategy(20)).toBe(1_500);
    });

    it('always attaches an error listener so ioredis never reports unhandled errors', () => {
      const { redisClient } = createRedisClient(options, createLogger());

      expect(redisClient.listenerCount('error')).toBeGreaterThanOrEqual(1);
    });
  });

  describe('lifecycle logging', () => {
    it('logs redis_connected when the first connection becomes ready', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);

      redisClient.emit('ready');

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(
        { component: 'redis', event: 'redis_connected' },
        expect.any(String),
      );
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('warns redis_unavailable_at_startup when the first connection attempt fails', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);

      redisClient.emit('error', connectionRefused());

      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        {
          component: 'redis',
          event: 'redis_unavailable_at_startup',
          errorDetails: {
            type: 'Error',
            message: 'connect ECONNREFUSED 127.0.0.1:6379',
            code: 'ECONNREFUSED',
            syscall: 'connect',
            address: '127.0.0.1',
            port: 6379,
          },
        },
        expect.any(String),
      );
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('stays silent on repeated errors while it has never connected', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);

      redisClient.emit('error', connectionRefused());
      redisClient.emit('error', connectionRefused());
      redisClient.emit('error', connectionRefused());

      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('logs redis_connected when a never-connected client finally becomes ready', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);
      redisClient.emit('error', connectionRefused());
      redisClient.emit('error', connectionRefused());

      redisClient.emit('ready');

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(
        { component: 'redis', event: 'redis_connected' },
        expect.any(String),
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('logs redis_connection_lost at error level when a connected client errors', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);
      redisClient.emit('ready');

      redisClient.emit('error', connectionRefused());

      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        {
          component: 'redis',
          event: 'redis_connection_lost',
          errorDetails: {
            type: 'Error',
            message: 'connect ECONNREFUSED 127.0.0.1:6379',
            code: 'ECONNREFUSED',
            syscall: 'connect',
            address: '127.0.0.1',
            port: 6379,
          },
        },
        expect.any(String),
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('stays silent on repeated errors while disconnected', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);
      redisClient.emit('ready');

      redisClient.emit('error', connectionRefused());
      redisClient.emit('error', connectionRefused());
      redisClient.emit('error', connectionRefused());

      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('logs redis_connection_restored with downForMs measured on the monotonic clock', () => {
      const logger = createLogger();
      const monotonicMs = vi.fn<() => number>();
      const { redisClient } = createRedisClient(options, logger, { monotonicMs });
      redisClient.emit('ready');
      logger.info.mockClear();
      monotonicMs.mockReturnValue(10_000);
      redisClient.emit('error', connectionRefused());
      redisClient.emit('error', connectionRefused());
      monotonicMs.mockReturnValue(13_500);

      redisClient.emit('ready');

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(
        { component: 'redis', event: 'redis_connection_restored', downForMs: 3_500 },
        expect.any(String),
      );
    });

    it('measures each outage separately across repeated lose/restore cycles', () => {
      const logger = createLogger();
      const monotonicMs = vi.fn<() => number>();
      const { redisClient } = createRedisClient(options, logger, { monotonicMs });
      redisClient.emit('ready');
      logger.info.mockClear();

      monotonicMs.mockReturnValue(1_000);
      redisClient.emit('error', connectionRefused());
      monotonicMs.mockReturnValue(1_200);
      redisClient.emit('ready');
      monotonicMs.mockReturnValue(5_000);
      redisClient.emit('error', connectionRefused());
      monotonicMs.mockReturnValue(9_000);
      redisClient.emit('ready');

      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(logger.info.mock.calls.map(([fields]) => fields)).toEqual([
        { component: 'redis', event: 'redis_connection_restored', downForMs: 200 },
        { component: 'redis', event: 'redis_connection_restored', downForMs: 4_000 },
      ]);
    });

    it('keeps lifecycle state per client so two clients do not affect each other', () => {
      const firstLogger = createLogger();
      const secondLogger = createLogger();
      const first = createRedisClient(options, firstLogger);
      const second = createRedisClient(options, secondLogger);

      first.redisClient.emit('ready');
      second.redisClient.emit('error', connectionRefused());

      expect(firstLogger.info).toHaveBeenCalledExactlyOnceWith(
        { component: 'redis', event: 'redis_connected' },
        expect.any(String),
      );
      expect(firstLogger.warn).not.toHaveBeenCalled();
      expect(secondLogger.warn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ event: 'redis_unavailable_at_startup' }),
        expect.any(String),
      );
      expect(secondLogger.info).not.toHaveBeenCalled();
      expect(secondLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('connection closed without an error', () => {
    it('logs redis_connection_lost once when a connected client closes without an error', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);
      redisClient.emit('ready');

      redisClient.emit('close');

      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        { component: 'redis', event: 'redis_connection_lost' },
        expect.any(String),
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('treats the client as disconnected after a close, so a following error is silent', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);
      redisClient.emit('ready');
      redisClient.emit('close');

      redisClient.emit('error', connectionRefused());
      redisClient.emit('close');

      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('logs redis_connection_restored with downForMs measured from the close', () => {
      const logger = createLogger();
      const monotonicMs = vi.fn<() => number>();
      const { redisClient } = createRedisClient(options, logger, { monotonicMs });
      redisClient.emit('ready');
      logger.info.mockClear();
      monotonicMs.mockReturnValue(20_000);
      redisClient.emit('close');
      monotonicMs.mockReturnValue(22_750);

      redisClient.emit('ready');

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(
        { component: 'redis', event: 'redis_connection_restored', downForMs: 2_750 },
        expect.any(String),
      );
    });

    it('does not log redis_connection_lost on a close while still connecting', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);

      redisClient.emit('close');

      expect(logger.error).not.toHaveBeenCalled();
    });

    it('does not log redis_connection_lost on a close after a failed startup', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);
      redisClient.emit('error', connectionRefused());

      redisClient.emit('close');

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('does not log redis_connection_lost again on a close while already disconnected', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);
      redisClient.emit('ready');
      redisClient.emit('error', connectionRefused());

      redisClient.emit('close');

      expect(logger.error).toHaveBeenCalledOnce();
    });

    it('does not log redis_connection_lost on a close after close() was called', async () => {
      const logger = createLogger();
      const { redisClient, close } = createRedisClient(options, logger);
      redisClient.emit('ready');
      await close();

      redisClient.emit('close');

      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('error field allowlist', () => {
    const errorWithSecrets = (): Error =>
      Object.assign(new Error('NOAUTH Authentication required'), {
        name: 'ReplyError',
        code: 'NOAUTH',
        command: { name: 'auth', args: [SECRET_PASSWORD] },
        previousErrors: [new Error(`AUTH ${SECRET_PASSWORD}`)],
        options: { password: SECRET_PASSWORD },
      });

    it('logs only allowlisted fields and command.name for a startup error', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);

      redisClient.emit('error', errorWithSecrets());

      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        {
          component: 'redis',
          event: 'redis_unavailable_at_startup',
          errorDetails: {
            type: 'ReplyError',
            message: 'NOAUTH Authentication required',
            code: 'NOAUTH',
            command: 'auth',
          },
        },
        expect.any(String),
      );
    });

    it('logs only allowlisted fields and command.name for a lost connection', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);
      redisClient.emit('ready');

      redisClient.emit('error', errorWithSecrets());

      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        {
          component: 'redis',
          event: 'redis_connection_lost',
          errorDetails: {
            type: 'ReplyError',
            message: 'NOAUTH Authentication required',
            code: 'NOAUTH',
            command: 'auth',
          },
        },
        expect.any(String),
      );
    });

    it('never puts command args, the stack, or the raw error into any log call', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);
      const startupError = errorWithSecrets();
      const lostError = errorWithSecrets();

      redisClient.emit('error', startupError);
      redisClient.emit('ready');
      redisClient.emit('error', lostError);

      const allCalls = [
        ...logger.debug.mock.calls,
        ...logger.info.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ];
      const serialized = JSON.stringify(allCalls);
      expect(serialized).not.toContain(SECRET_PASSWORD);
      expect(serialized).not.toContain('args');
      expect(serialized).not.toContain('stack');
      const loggedErrors = allCalls.map(([fields]) => fields.errorDetails);
      expect(loggedErrors).not.toContain(startupError);
      expect(loggedErrors).not.toContain(lostError);
    });

    it('omits allowlisted fields that are missing or not strings or numbers', () => {
      const logger = createLogger();
      const { redisClient } = createRedisClient(options, logger);
      const error = Object.assign(new Error('weird'), {
        code: { nested: SECRET_PASSWORD },
        command: { name: 42, args: [SECRET_PASSWORD] },
      });

      redisClient.emit('error', error);

      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        {
          component: 'redis',
          event: 'redis_unavailable_at_startup',
          errorDetails: { type: 'Error', message: 'weird' },
        },
        expect.any(String),
      );
    });
  });

  describe('close', () => {
    it('quits gracefully and does not force a disconnect when quit succeeds', async () => {
      vi.useFakeTimers();
      const { close } = createReadyClient();

      await expect(close()).resolves.toBeUndefined();

      expect(redisTestDoubles.quit).toHaveBeenCalledOnce();
      expect(redisTestDoubles.disconnect).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('forces a disconnect after about 2 s when quit never settles, leaving no timers', async () => {
      vi.useFakeTimers();
      const { close } = createReadyClient();
      redisTestDoubles.quit.mockReturnValue(new Promise<'OK'>(() => undefined));
      let settled = false;

      const closing = close().then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(500);

      expect(redisTestDoubles.disconnect).not.toHaveBeenCalled();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(2_000);
      await closing;

      expect(redisTestDoubles.disconnect).toHaveBeenCalledOnce();
      expect(settled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('resolves well before a 20 s shutdown deadline when quit hangs', async () => {
      vi.useFakeTimers();
      const { close } = createReadyClient();
      redisTestDoubles.quit.mockReturnValue(new Promise<'OK'>(() => undefined));
      let settled = false;

      const closing = close().then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(5_000);

      expect(settled).toBe(true);
      await closing;
    });

    it('disconnects and does not throw when quit rejects, leaving no timers', async () => {
      vi.useFakeTimers();
      const { close } = createReadyClient();
      redisTestDoubles.quit.mockRejectedValue(
        new Error("Stream isn't writeable and enableOfflineQueue options is false"),
      );

      await expect(close()).resolves.toBeUndefined();

      expect(redisTestDoubles.disconnect).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('disconnects and does not throw when quit throws synchronously', async () => {
      vi.useFakeTimers();
      const { close } = createReadyClient();
      redisTestDoubles.quit.mockImplementation(() => {
        throw new Error('Connection is closed.');
      });

      await expect(close()).resolves.toBeUndefined();

      expect(redisTestDoubles.disconnect).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('resolves without throwing when quit rejects and the fallback disconnect throws', async () => {
      vi.useFakeTimers();
      const { close } = createReadyClient();
      redisTestDoubles.quit.mockRejectedValue(new Error('Connection is closed.'));
      redisTestDoubles.disconnect.mockImplementation(() => {
        throw new Error('disconnect failed');
      });

      await expect(close()).resolves.toBeUndefined();

      expect(redisTestDoubles.disconnect).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('resolves without throwing when quit times out and the fallback disconnect throws', async () => {
      vi.useFakeTimers();
      const { close } = createReadyClient();
      redisTestDoubles.quit.mockReturnValue(new Promise<'OK'>(() => undefined));
      redisTestDoubles.disconnect.mockImplementation(() => {
        throw new Error('disconnect failed');
      });

      const outcome = close().then(
        () => 'resolved',
        () => 'rejected',
      );
      await vi.advanceTimersByTimeAsync(2_500);

      await expect(outcome).resolves.toBe('resolved');
      expect(redisTestDoubles.disconnect).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('logs redis_closed when the client ends after close()', async () => {
      const logger = createLogger();
      const { redisClient, close } = createRedisClient(options, logger);
      redisClient.emit('ready');
      logger.info.mockClear();
      await close();

      redisClient.emit('end');

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(
        { component: 'redis', event: 'redis_closed' },
        expect.any(String),
      );
    });

    it('stays silent on error, close, and ready events after close() was called', async () => {
      const logger = createLogger();
      const { redisClient, close } = createRedisClient(options, logger);
      redisClient.emit('ready');
      logger.info.mockClear();
      await close();

      redisClient.emit('error', connectionRefused());
      redisClient.emit('close');
      redisClient.emit('ready');

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('marks the client as closing before quit, so errors during quit are not an outage', async () => {
      const logger = createLogger();
      const { redisClient, close } = createRedisClient(options, logger);
      redisClient.emit('ready');
      redisTestDoubles.quit.mockImplementation(() => {
        redisClient.emit('error', connectionRefused());
        redisClient.emit('end');
        return Promise.resolve('OK');
      });

      await close();

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenLastCalledWith(
        { component: 'redis', event: 'redis_closed' },
        expect.any(String),
      );
    });

    it('disconnects a client that is not ready without trying quit or warning', async () => {
      vi.useFakeTimers();
      const logger = createLogger();
      const { redisClient, close } = createRedisClient(options, logger);
      redisClient.emit('error', connectionRefused());
      logger.warn.mockClear();

      await expect(close()).resolves.toBeUndefined();

      expect(redisTestDoubles.quit).not.toHaveBeenCalled();
      expect(redisTestDoubles.disconnect).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('returns the same pending close to a second caller and quits only once', async () => {
      const { close } = createReadyClient();
      let finishQuit: (value: 'OK') => void = () => undefined;
      redisTestDoubles.quit.mockReturnValue(
        new Promise<'OK'>((resolve) => {
          finishQuit = resolve;
        }),
      );
      let secondSettled = false;

      const first = close();
      const second = close().then(() => {
        secondSettled = true;
      });
      await Promise.resolve();

      expect(secondSettled).toBe(false);

      finishQuit('OK');
      await Promise.all([first, second]);

      expect(secondSettled).toBe(true);
      expect(redisTestDoubles.quit).toHaveBeenCalledOnce();
    });

    it('warns once with safe error fields when quit fails on a ready client', async () => {
      const logger = createLogger();
      const { close } = createReadyClient(logger);
      const quitError = Object.assign(new Error('Connection is closed.'), {
        command: { name: 'quit', args: [SECRET_PASSWORD] },
      });
      redisTestDoubles.quit.mockRejectedValue(quitError);

      await close();

      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        {
          component: 'redis',
          event: 'redis_quit_failed',
          errorDetails: { type: 'Error', message: 'Connection is closed.', command: 'quit' },
        },
        expect.any(String),
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(SECRET_PASSWORD);
      expect(redisTestDoubles.disconnect).toHaveBeenCalledOnce();
    });

    it('closing a never-connected client does not log an outage or a reconnection', async () => {
      const logger = createLogger();
      const { redisClient, close } = createRedisClient(options, logger);
      redisClient.emit('error', connectionRefused());
      redisTestDoubles.quit.mockRejectedValue(new Error('Stream not writeable'));

      await close();
      redisClient.emit('error', connectionRefused());
      redisClient.emit('ready');

      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
