import { loadConfigOrExit } from '@helmrun/config';
import { createLogger, type Logger } from '@helmrun/logger';
import {
  createLifecycleState,
  createShutdownCoordinator,
  installProcessHandlers,
  isEntryPoint,
  type RequestShutdown,
  type ShutdownProcessTarget,
} from '@helmrun/shared';

import { loadConfig } from './config.js';

export const SERVICE_NAME = 'helmrun-worker';

const IDLE_HEARTBEAT_INTERVAL_MS = 60_000;

export interface RunningWorker {
  readonly logger: Logger;
  readonly requestShutdown: RequestShutdown;
}

// Tests pass their own processTarget, so a shutdown deadline can't exit the
// runner. Process-wide handlers are installed only below, when run directly.
export const startWorker = (processTarget: ShutdownProcessTarget = process): RunningWorker => {
  const config = loadConfigOrExit(SERVICE_NAME, loadConfig);
  const logger = createLogger({
    level: config.logging.level,
    pretty: config.logging.pretty,
    service: SERVICE_NAME,
    environment: config.environment,
  });
  const lifecycle = createLifecycleState();

  // Stand-in for the queue poll loop (phase 3). It's the only open handle:
  // without it the event loop is empty and Node exits 0 right after startup,
  // which an orchestrator sees as a crash loop.
  const idleLoop = setInterval(() => {
    logger.debug({ event: 'worker_idle' }, 'Worker idle');
  }, IDLE_HEARTBEAT_INTERVAL_MS);

  const requestShutdown = createShutdownCoordinator({
    steps: [
      {
        name: 'idle_loop',
        close: () => {
          clearInterval(idleLoop);
          return Promise.resolve();
        },
      },
    ],
    lifecycle,
    logger,
    timeoutMs: config.shutdownTimeoutMs,
    processTarget,
  });

  logger.info({ event: 'worker_started' }, 'Worker started');

  return { logger, requestShutdown };
};

if (isEntryPoint(import.meta.filename)) {
  const { logger, requestShutdown } = startWorker();

  // Same pattern as the API: once shutdown completes, a further Ctrl+C gets
  // Node's default behavior.
  const uninstallProcessHandlers = installProcessHandlers({
    logger,
    requestShutdown: (request) => {
      void requestShutdown(request).finally(uninstallProcessHandlers);
    },
  });
}
