import type { LifecycleState } from './lifecycle-state.js';
import type { LifecycleLogger } from './logger.js';
import type { ProcessShutdownRequest } from './process-handlers.js';

// One resource to release on shutdown. Each process lists its own, in order:
// stop taking work first, then close what that work depends on.
export interface ShutdownStep {
  // snake_case; appears in log fields (e.g. 'http_server', 'database_pool').
  readonly name: string;
  close(): Promise<void>;
}

export interface ShutdownProcessTarget {
  exitCode: number | string | null | undefined;
  exit(exitCode: number): never;
}

export interface ShutdownCoordinatorOptions {
  readonly steps: readonly ShutdownStep[];
  readonly lifecycle: Pick<LifecycleState, 'beginDraining'>;
  readonly logger: LifecycleLogger;
  readonly timeoutMs: number;
  readonly processTarget: ShutdownProcessTarget;
}

export type RequestShutdown = (request: ProcessShutdownRequest) => Promise<void>;

// Runs shutdown once, however many times it's requested (SIGTERM then SIGINT,
// or a fatal error mid-shutdown). Every step runs even if an earlier one fails;
// any failure means exit code 1. After the steps, the process exits on its own
// once nothing keeps the event loop alive. Guarantee: it is gone by the
// deadline either way. If a step hangs, or a handle no step closes (a
// forgotten client) keeps the process alive, the deadline force-exits with 1.
export const createShutdownCoordinator = ({
  steps,
  lifecycle,
  logger,
  timeoutMs,
  processTarget,
}: ShutdownCoordinatorOptions): RequestShutdown => {
  let shutdownPromise: Promise<void> | undefined;
  let exitCode: 0 | 1 = 0;

  const forceExit = (): void => {
    exitCode = 1;
    processTarget.exitCode = exitCode;

    try {
      logger.fatal(
        { event: 'shutdown_deadline_exceeded', timeoutMs, exitCode },
        'Shutdown exceeded its deadline; forcing exit',
      );
    } finally {
      processTarget.exit(exitCode);
    }
  };

  const runSteps = async (request: ProcessShutdownRequest): Promise<void> => {
    const deadline = setTimeout(forceExit, timeoutMs);

    try {
      // Log the reason, never the fatal error itself: process-handlers
      // already logged it once.
      const reasonFields =
        request.reason === 'signal'
          ? { reason: request.reason, signal: request.signal }
          : { reason: request.reason, fatalEventType: request.fatalEventType };
      logger.info({ event: 'shutdown_started', ...reasonFields, timeoutMs }, 'Shutdown started');

      let failed = false;

      for (const step of steps) {
        try {
          await step.close();
          logger.info({ event: 'shutdown_step_completed', step: step.name }, 'Shutdown step done');
        } catch (error) {
          failed = true;
          logger.error(
            { event: 'shutdown_step_failed', step: step.name, err: error },
            'Shutdown step failed',
          );
        }
      }

      if (failed) exitCode = 1;
      processTarget.exitCode = exitCode;

      logger.info({ event: 'shutdown_completed', exitCode }, 'Shutdown completed');
    } finally {
      // Keep the deadline as a backstop, but unref'd: it no longer holds the
      // process open, so a clean exit happens as soon as the loop is empty.
      deadline.unref();
    }
  };

  return (request) => {
    // A fatal request upgrades the exit code even if shutdown already started.
    if (request.exitCode === 1) exitCode = 1;
    processTarget.exitCode = exitCode;

    if (shutdownPromise !== undefined) return shutdownPromise;

    // Synchronously, so readiness reports not-ready before anything closes.
    lifecycle.beginDraining();

    // Deferred a microtask so shutdownPromise is assigned before any step runs:
    // a step that synchronously triggers another request gets this promise
    // instead of starting a second shutdown.
    shutdownPromise = Promise.resolve().then(() => runSteps(request));

    return shutdownPromise;
  };
};
