import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

const defaultProcessDouble = vi.hoisted(() => ({
  exitCode: undefined as number | string | null | undefined,
  on: vi.fn(),
  off: vi.fn(),
}));

vi.mock('node:process', () => ({ default: defaultProcessDouble }));

import { installProcessHandlers, type ProcessShutdownRequest } from './process-handlers.js';

const importTimeOnCalls = defaultProcessDouble.on.mock.calls.length;

class ProcessDouble extends EventEmitter {
  exitCode: number | string | null | undefined = undefined;
}

const createHarness = (processTarget = new ProcessDouble()) => {
  const fatal = vi.fn<(fields: Record<string, unknown>, message: string) => void>();
  const requestShutdown = vi.fn<(request: ProcessShutdownRequest) => void>();
  const uninstall = installProcessHandlers({ logger: { fatal }, requestShutdown }, processTarget);

  return { fatal, processTarget, requestShutdown, uninstall };
};

const fatalRequest = (request: ProcessShutdownRequest | undefined) => {
  if (request?.reason !== 'fatal_error') throw new Error('Expected a fatal shutdown request');
  return request;
};

describe('installProcessHandlers', () => {
  it('installs nothing at import time', () => {
    expect(importTimeOnCalls).toBe(0);
  });

  it('installs exactly one listener per supported event', () => {
    const { processTarget } = createHarness();

    for (const event of ['uncaughtException', 'unhandledRejection', 'SIGINT', 'SIGTERM']) {
      expect(processTarget.listenerCount(event)).toBe(1);
    }
  });

  it.each(['SIGINT', 'SIGTERM'] as const)('requests a graceful shutdown on %s', (signal) => {
    const { fatal, processTarget, requestShutdown } = createHarness();

    processTarget.emit(signal, signal);

    expect(requestShutdown).toHaveBeenCalledExactlyOnceWith({
      reason: 'signal',
      signal,
      exitCode: 0,
    });
    expect(fatal).not.toHaveBeenCalled();
    expect(processTarget.exitCode).toBeUndefined();
  });

  it('handles an uncaught exception with one fatal log and one shutdown request', () => {
    const { fatal, processTarget, requestShutdown } = createHarness();
    const error = new Error('unexpected synchronous failure');

    processTarget.emit('uncaughtException', error, 'uncaughtException');

    expect(processTarget.exitCode).toBe(1);
    expect(fatal).toHaveBeenCalledExactlyOnceWith(
      {
        event: 'process_fatal_error',
        fatalEventType: 'uncaught_exception',
        err: error,
        exitCode: 1,
      },
      expect.any(String),
    );
    expect(requestShutdown).toHaveBeenCalledExactlyOnceWith({
      reason: 'fatal_error',
      fatalEventType: 'uncaught_exception',
      error,
      exitCode: 1,
    });
  });

  it('uses the Node origin when a rejection is promoted to uncaughtException', () => {
    const { processTarget, requestShutdown } = createHarness();

    processTarget.emit('uncaughtException', new Error('promoted'), 'unhandledRejection');

    expect(fatalRequest(requestShutdown.mock.calls[0]?.[0]).fatalEventType).toBe(
      'unhandled_rejection',
    );
  });

  it('keeps an Error rejection reason as is', () => {
    const { processTarget, requestShutdown } = createHarness();
    const error = new Error('unexpected asynchronous failure');

    processTarget.emit('unhandledRejection', error, Promise.resolve());

    expect(fatalRequest(requestShutdown.mock.calls[0]?.[0]).error).toBe(error);
  });

  it.each([
    ['string', 'private-rejection-value'],
    ['number', 42],
    ['null', null],
    ['undefined', undefined],
    ['object', { password: 'private-password' }],
  ])('replaces a non-Error %s rejection without keeping its value', (_label, reason) => {
    const { fatal, processTarget, requestShutdown } = createHarness();

    processTarget.emit('unhandledRejection', reason, Promise.resolve());

    const { error } = fatalRequest(requestShutdown.mock.calls[0]?.[0]);
    expect(error.message).toBe('Promise rejected with a non-Error reason');
    expect(JSON.stringify(fatal.mock.calls)).not.toContain('private-rejection-value');
    expect(JSON.stringify(fatal.mock.calls)).not.toContain('private-password');
  });

  it('survives a rejection value that throws when inspected', () => {
    const { processTarget, requestShutdown } = createHarness();
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    expect(() =>
      processTarget.emit('unhandledRejection', revocable.proxy, Promise.resolve()),
    ).not.toThrow();
    expect(requestShutdown).toHaveBeenCalledOnce();
  });

  it('sets exit code 1 before logging, then requests shutdown', () => {
    const processTarget = new ProcessDouble();
    processTarget.exitCode = 0;
    const order: string[] = [];
    installProcessHandlers(
      {
        logger: {
          fatal: () => {
            expect(processTarget.exitCode).toBe(1);
            order.push('log');
          },
        },
        requestShutdown: () => order.push('shutdown'),
      },
      processTarget,
    );

    processTarget.emit('uncaughtException', new Error('fatal'), 'uncaughtException');

    expect(order).toEqual(['log', 'shutdown']);
  });

  it('acts on the first fatal event only, including re-entrant ones, but logs the later ones', () => {
    const processTarget = new ProcessDouble();
    const fatal = vi.fn();
    const requestShutdown = vi.fn(() => {
      processTarget.emit('unhandledRejection', new Error('re-entrant'), Promise.resolve());
    });
    installProcessHandlers({ logger: { fatal }, requestShutdown }, processTarget);
    const third = new Error('third');

    processTarget.emit('uncaughtException', new Error('first'), 'uncaughtException');
    processTarget.emit('uncaughtException', third, 'uncaughtException');

    expect(requestShutdown).toHaveBeenCalledOnce();
    expect(processTarget.exitCode).toBe(1);
    expect(fatal.mock.calls.map(([fields]) => (fields as { event: string }).event)).toEqual([
      'process_fatal_error',
      'process_fatal_error_during_shutdown',
      'process_fatal_error_during_shutdown',
    ]);
    expect(fatal).toHaveBeenLastCalledWith(
      {
        event: 'process_fatal_error_during_shutdown',
        fatalEventType: 'uncaught_exception',
        err: third,
      },
      expect.any(String),
    );
  });

  it('never throws out of the listener when logging a later fatal event fails', () => {
    const { fatal, processTarget } = createHarness();
    processTarget.emit('uncaughtException', new Error('first'), 'uncaughtException');
    fatal.mockImplementation(() => {
      throw new Error('logging failed');
    });

    expect(() =>
      processTarget.emit('uncaughtException', new Error('second'), 'uncaughtException'),
    ).not.toThrow();
  });

  // A throw out of an uncaughtException listener makes Node exit at once
  // (code 7) before the deferred shutdown steps run.
  it('does not throw out of the listener and still requests shutdown if logging throws', () => {
    const { fatal, processTarget, requestShutdown } = createHarness();
    fatal.mockImplementation(() => {
      throw new Error('logging failed');
    });

    expect(() =>
      processTarget.emit('uncaughtException', new Error('fatal'), 'uncaughtException'),
    ).not.toThrow();
    expect(processTarget.exitCode).toBe(1);
    expect(requestShutdown).toHaveBeenCalledOnce();
  });

  it('removes only its own listeners, and uninstall is idempotent', () => {
    const processTarget = new ProcessDouble();
    const unrelated = vi.fn();
    processTarget.on('uncaughtException', unrelated);
    const { fatal, uninstall } = createHarness(processTarget);

    uninstall();
    uninstall();
    processTarget.emit('uncaughtException', new Error('after uninstall'), 'uncaughtException');

    expect(processTarget.listeners('uncaughtException')).toEqual([unrelated]);
    expect(processTarget.listenerCount('SIGTERM')).toBe(0);
    expect(unrelated).toHaveBeenCalledOnce();
    expect(fatal).not.toHaveBeenCalled();
  });
});
