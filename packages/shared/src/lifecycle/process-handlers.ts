import nodeProcess from 'node:process';

import type { LifecycleLogger } from './logger.js';

const FATAL_EXIT_CODE = 1 as const;

export type FatalEventType = 'uncaught_exception' | 'unhandled_rejection';
export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

export interface SignalShutdownRequest {
  readonly reason: 'signal';
  readonly signal: ShutdownSignal;
  readonly exitCode: 0;
}

export interface FatalShutdownRequest {
  readonly reason: 'fatal_error';
  readonly fatalEventType: FatalEventType;
  readonly error: Error;
  readonly exitCode: typeof FATAL_EXIT_CODE;
}

export type ProcessShutdownRequest = SignalShutdownRequest | FatalShutdownRequest;

export interface ProcessHandlerOptions {
  readonly logger: Pick<LifecycleLogger, 'fatal'>;
  readonly requestShutdown: (request: ProcessShutdownRequest) => void;
}

// The slice of `process` the handlers touch, so tests can pass an EventEmitter.
export interface FatalProcessTarget {
  exitCode: number | string | null | undefined;
  on(event: 'uncaughtException', listener: NodeJS.UncaughtExceptionListener): this;
  on(event: 'unhandledRejection', listener: NodeJS.UnhandledRejectionListener): this;
  on(event: ShutdownSignal, listener: NodeJS.SignalsListener): this;
  off(event: 'uncaughtException', listener: NodeJS.UncaughtExceptionListener): this;
  off(event: 'unhandledRejection', listener: NodeJS.UnhandledRejectionListener): this;
  off(event: ShutdownSignal, listener: NodeJS.SignalsListener): this;
}

export type UninstallProcessHandlers = () => void;

// A rejection reason can be anything, including user data or a revoked Proxy
// whose inspection throws. Keep a real Error; replace everything else with a
// fixed message so the value itself never reaches logs.
const normalizeRejectionReason = (reason: unknown): Error => {
  try {
    if (reason instanceof Error) return reason;
  } catch {
    // Fall through to the generic error.
  }

  return new Error('Promise rejected with a non-Error reason');
};

// Turns signals and fatal process events into one shutdown request. Only the
// first fatal event starts shutdown: after an uncaught exception the process
// state is unknown, so later ones are logged but not acted on (the shutdown
// deadline is the backstop). Installs nothing at import time; main.ts calls this.
export const installProcessHandlers = (
  options: ProcessHandlerOptions,
  processTarget: FatalProcessTarget = nodeProcess,
): UninstallProcessHandlers => {
  let fatalHandlingStarted = false;
  let installed = true;

  const handleFatalError = (fatalEventType: FatalEventType, error: Error): void => {
    // Our listener is still installed, so Node won't print a later failure
    // either: log it, or a second, different bug during shutdown is invisible.
    if (fatalHandlingStarted) {
      try {
        options.logger.fatal(
          { event: 'process_fatal_error_during_shutdown', fatalEventType, err: error },
          'Another fatal process error during shutdown; not acted on',
        );
      } catch {
        // Same rule as below: never throw out of the listener.
      }
      return;
    }

    fatalHandlingStarted = true;
    // Set before logging, so a throwing logger can't leave a success exit code.
    processTarget.exitCode = FATAL_EXIT_CODE;

    // A throwing logger must not escape: a throw inside an uncaughtException
    // listener makes Node exit at once (code 7), skipping graceful shutdown.
    try {
      options.logger.fatal(
        { event: 'process_fatal_error', fatalEventType, err: error, exitCode: FATAL_EXIT_CODE },
        'Fatal process error; shutting down',
      );
    } catch {
      // Nothing better to log to; shutdown still runs and exits 1.
    } finally {
      options.requestShutdown({
        reason: 'fatal_error',
        fatalEventType,
        error,
        exitCode: FATAL_EXIT_CODE,
      });
    }
  };

  const onUncaughtException: NodeJS.UncaughtExceptionListener = (error, origin) => {
    handleFatalError(
      origin === 'unhandledRejection' ? 'unhandled_rejection' : 'uncaught_exception',
      error,
    );
  };

  const onUnhandledRejection: NodeJS.UnhandledRejectionListener = (reason) => {
    handleFatalError('unhandled_rejection', normalizeRejectionReason(reason));
  };

  const onSignal: NodeJS.SignalsListener = (signal) => {
    if (signal !== 'SIGINT' && signal !== 'SIGTERM') return;

    options.requestShutdown({ reason: 'signal', signal, exitCode: 0 });
  };

  processTarget.on('uncaughtException', onUncaughtException);
  processTarget.on('unhandledRejection', onUnhandledRejection);
  processTarget.on('SIGINT', onSignal);
  processTarget.on('SIGTERM', onSignal);

  return () => {
    if (!installed) return;

    installed = false;
    processTarget.off('uncaughtException', onUncaughtException);
    processTarget.off('unhandledRejection', onUnhandledRejection);
    processTarget.off('SIGINT', onSignal);
    processTarget.off('SIGTERM', onSignal);
  };
};
