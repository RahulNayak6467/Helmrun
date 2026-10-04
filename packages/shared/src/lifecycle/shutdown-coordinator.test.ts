import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLifecycleState } from './lifecycle-state.js';
import type { ProcessShutdownRequest } from './process-handlers.js';
import { createShutdownCoordinator, type ShutdownProcessTarget } from './shutdown-coordinator.js';

const SIGTERM: ProcessShutdownRequest = { reason: 'signal', signal: 'SIGTERM', exitCode: 0 };
const TIMEOUT_MS = 10_000;

// A step whose close() stays pending until the test settles it.
const createControlledStep = (name: string) => {
  let settle: { resolve: () => void; reject: (error: Error) => void } | undefined;
  const close = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      }),
  );

  return {
    step: { name, close },
    close,
    finish: () => settle?.resolve(),
    fail: (error: Error) => settle?.reject(error),
  };
};

const createHarness = () => {
  const http = createControlledStep('http_server');
  const poolEnd = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const lifecycle = createLifecycleState();
  const logger = { info: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  const forcedExit = new Error('forced process exit');
  const exit = vi.fn((): never => {
    throw forcedExit;
  });
  const processTarget: ShutdownProcessTarget = { exitCode: undefined, exit };
  const requestShutdown = createShutdownCoordinator({
    steps: [http.step, { name: 'database_pool', close: poolEnd }],
    lifecycle,
    logger,
    timeoutMs: TIMEOUT_MS,
    processTarget,
  });

  return { http, poolEnd, lifecycle, logger, forcedExit, exit, processTarget, requestShutdown };
};

describe('createShutdownCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('marks the process draining synchronously, before any step runs', async () => {
    const harness = createHarness();

    const shutdown = harness.requestShutdown(SIGTERM);

    expect(harness.lifecycle.isDraining()).toBe(true);
    expect(harness.http.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    harness.http.finish();
    await shutdown;
  });

  it('runs steps in order: the next starts only after the previous finishes', async () => {
    const harness = createHarness();
    const shutdown = harness.requestShutdown(SIGTERM);

    await vi.advanceTimersByTimeAsync(0);
    expect(harness.http.close).toHaveBeenCalledOnce();
    expect(harness.poolEnd).not.toHaveBeenCalled();

    harness.http.finish();
    await shutdown;

    expect(harness.poolEnd).toHaveBeenCalledOnce();
    expect(harness.processTarget.exitCode).toBe(0);
  });

  it('returns the same promise and runs steps once for repeated requests', async () => {
    const harness = createHarness();
    const first = harness.requestShutdown(SIGTERM);
    const second = harness.requestShutdown({ reason: 'signal', signal: 'SIGINT', exitCode: 0 });

    expect(second).toBe(first);

    await vi.advanceTimersByTimeAsync(0);
    harness.http.finish();
    await first;

    expect(harness.http.close).toHaveBeenCalledOnce();
    expect(harness.poolEnd).toHaveBeenCalledOnce();
    expect(harness.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'shutdown_started', signal: 'SIGTERM' }),
      expect.any(String),
    );
  });

  it('keeps exit code 1 for a fatal shutdown and does not log the fatal error again', async () => {
    const harness = createHarness();
    const shutdown = harness.requestShutdown({
      reason: 'fatal_error',
      fatalEventType: 'uncaught_exception',
      error: new Error('fatal failure'),
      exitCode: 1,
    });

    await vi.advanceTimersByTimeAsync(0);
    harness.http.finish();
    await shutdown;

    expect(harness.processTarget.exitCode).toBe(1);
    expect(JSON.stringify(harness.logger.info.mock.calls)).not.toContain('fatal failure');
  });

  it('upgrades a signal shutdown to exit code 1 when a fatal event arrives mid-shutdown', async () => {
    const harness = createHarness();
    const first = harness.requestShutdown(SIGTERM);
    await vi.advanceTimersByTimeAsync(0);

    void harness.requestShutdown({
      reason: 'fatal_error',
      fatalEventType: 'unhandled_rejection',
      error: new Error('fatal during shutdown'),
      exitCode: 1,
    });
    expect(harness.processTarget.exitCode).toBe(1);

    harness.http.finish();
    await first;

    expect(harness.processTarget.exitCode).toBe(1);
  });

  it('runs later steps when one fails, logs which step failed, and exits 1', async () => {
    const harness = createHarness();
    const httpError = new Error('HTTP close failed');
    const shutdown = harness.requestShutdown(SIGTERM);

    await vi.advanceTimersByTimeAsync(0);
    harness.http.fail(httpError);
    await shutdown;

    expect(harness.poolEnd).toHaveBeenCalledOnce();
    expect(harness.processTarget.exitCode).toBe(1);
    expect(harness.logger.error).toHaveBeenCalledWith(
      { event: 'shutdown_step_failed', step: 'http_server', err: httpError },
      expect.any(String),
    );
  });

  it('treats a step that throws synchronously like a failed step', async () => {
    const lifecycle = createLifecycleState();
    const logger = { info: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    const processTarget: ShutdownProcessTarget = {
      exitCode: undefined,
      exit: () => {
        throw new Error('unexpected exit');
      },
    };
    const later = vi.fn().mockResolvedValue(undefined);
    const requestShutdown = createShutdownCoordinator({
      steps: [
        {
          name: 'broken',
          close: () => {
            throw new Error('sync failure');
          },
        },
        { name: 'later', close: later },
      ],
      lifecycle,
      logger,
      timeoutMs: TIMEOUT_MS,
      processTarget,
    });

    await requestShutdown(SIGTERM);

    expect(later).toHaveBeenCalledOnce();
    expect(processTarget.exitCode).toBe(1);
  });

  it('does not force-exit a successful shutdown before the deadline', async () => {
    const harness = createHarness();
    const shutdown = harness.requestShutdown(SIGTERM);

    await vi.advanceTimersByTimeAsync(0);
    harness.http.finish();
    await shutdown;
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);

    expect(harness.exit).not.toHaveBeenCalled();
    expect(harness.processTarget.exitCode).toBe(0);
  });

  // In a real process the backstop is unref'd and never fires if the loop
  // empties. It fires only when something no step closed keeps the process alive.
  it('keeps the deadline as a backstop after the steps finish', async () => {
    const harness = createHarness();
    const shutdown = harness.requestShutdown(SIGTERM);

    await vi.advanceTimersByTimeAsync(0);
    harness.http.finish();
    await shutdown;

    await expect(vi.advanceTimersByTimeAsync(TIMEOUT_MS)).rejects.toThrow(harness.forcedExit);
    expect(harness.exit).toHaveBeenCalledWith(1);
  });

  it('force-exits with code 1 when a step hangs past the deadline', async () => {
    const harness = createHarness();
    void harness.requestShutdown(SIGTERM);
    await vi.advanceTimersByTimeAsync(0);

    await expect(vi.advanceTimersByTimeAsync(TIMEOUT_MS)).rejects.toThrow(harness.forcedExit);

    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.processTarget.exitCode).toBe(1);
    expect(harness.poolEnd).not.toHaveBeenCalled();
    expect(harness.logger.fatal).toHaveBeenCalledWith(
      { event: 'shutdown_deadline_exceeded', timeoutMs: TIMEOUT_MS, exitCode: 1 },
      expect.any(String),
    );
  });

  it('still force-exits if the deadline log throws', async () => {
    const harness = createHarness();
    harness.logger.fatal.mockImplementation(() => {
      throw new Error('logger failed');
    });
    void harness.requestShutdown(SIGTERM);
    await vi.advanceTimersByTimeAsync(0);

    await expect(vi.advanceTimersByTimeAsync(TIMEOUT_MS)).rejects.toThrow(harness.forcedExit);
    expect(harness.exit).toHaveBeenCalledWith(1);
  });
});
