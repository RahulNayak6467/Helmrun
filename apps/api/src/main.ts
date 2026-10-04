import { realpathSync } from 'node:fs';
import http from 'node:http';

import { toConfigValidationIssues } from '@helmrun/config';
import type { Logger } from '@helmrun/logger';
import {
  createLifecycleState,
  createShutdownCoordinator,
  installProcessHandlers,
  type RequestShutdown,
  type ShutdownProcessTarget,
} from '@helmrun/shared';

import { createApp } from './app.js';
import { loadConfig, type ApiConfig } from './config.js';
import { createDependencies, SERVICE_NAME } from './dependencies.js';
import { createReadinessChecker } from './health/readiness.js';
import { createHttpServerCloser } from './http/server-closer.js';

// Time for the fatal log line to flush before a startup failure force-exits.
const STARTUP_FAILURE_EXIT_DELAY_MS = 1_000;

// Invalid config means nothing else can safely run. No logger exists yet, so
// write one structured line to stderr (field names and reasons only, never the
// rejected values) and exit non-zero.
const loadConfigOrExit = (): ApiConfig => {
  try {
    return loadConfig();
  } catch (error) {
    const issues = toConfigValidationIssues(error);

    if (issues === null) {
      throw error;
    }

    process.stderr.write(
      `${JSON.stringify({
        severity: 'FATAL',
        service: SERVICE_NAME,
        event: 'config_invalid',
        issues,
        msg: 'Invalid configuration; refusing to start',
      })}\n`,
    );

    return process.exit(1);
  }
};

export interface RunningApi {
  readonly server: http.Server;
  readonly logger: Logger;
  readonly requestShutdown: RequestShutdown;
}

// Builds and starts the API. Process-wide handlers (signals, fatal errors) are
// installed only when this file is the entry point, so tests can start a
// server without adding listeners to the test runner's process. Tests also
// pass their own processTarget, so a shutdown deadline can't exit the runner.
export const startServer = (processTarget: ShutdownProcessTarget = process): RunningApi => {
  const config = loadConfigOrExit();
  const dependencies = createDependencies(config);
  const { logger } = dependencies;
  const lifecycle = createLifecycleState();
  const checkReadiness = createReadinessChecker({
    databasePool: dependencies.databasePool,
    lifecycle,
    timeoutMs: config.database.readinessTimeoutMs,
    logger,
  });
  const app = createApp({ logger, clock: dependencies.clock, checkReadiness });

  const server = http.createServer(
    {
      requestTimeout: config.server.requestTimeoutMs,
      headersTimeout: config.server.headersTimeoutMs,
      keepAliveTimeout: config.server.keepAliveTimeoutMs,
    },
    app,
  );
  const closeHttpServer = createHttpServerCloser(server);

  // Startup failure (e.g. EADDRINUSE): nothing useful can run, so log it and
  // stop. Closing the pool frees its handles; the exit timer is the backstop so
  // a half-started process can't linger if something else keeps the event loop
  // alive. Unref'd: it never keeps the process alive by itself.
  const onStartupError = (error: Error): void => {
    logger.fatal({ event: 'http_server_start_failed', err: error }, 'HTTP server failed to start');
    process.exitCode = 1;
    void dependencies.databasePool.end();
    setTimeout(() => process.exit(1), STARTUP_FAILURE_EXIT_DELAY_MS).unref();
  };

  server.once('error', onStartupError);

  server.listen(config.server.port, () => {
    // Once listening, errors are runtime errors (e.g. EMFILE on accept): log
    // and keep serving. A permanent listener also means a second error can't
    // become an unhandled 'error' event that crashes the process.
    server.off('error', onStartupError);
    server.on('error', (error) => {
      logger.error({ event: 'http_server_error', err: error }, 'HTTP server error');
    });

    logger.info(
      { event: 'http_server_listening', port: config.server.port },
      'HTTP server listening',
    );
  });

  // HTTP first, so no new request starts needing the database; then the pool
  // the finished requests were using.
  const requestShutdown = createShutdownCoordinator({
    steps: [
      { name: 'http_server', close: closeHttpServer },
      { name: 'database_pool', close: () => dependencies.databasePool.end() },
    ],
    lifecycle,
    logger,
    timeoutMs: config.server.shutdownTimeoutMs,
    processTarget,
  });

  return { server, logger, requestShutdown };
};

// Start only when this file is run directly (`pnpm dev` / `pnpm start`), never
// when a test imports it. `import.meta.main` is undefined under tsx, which
// `pnpm dev` uses, so compare the entry path instead.
const isEntryPoint = (): boolean => {
  const entryPath = process.argv[1];

  if (entryPath === undefined) return false;

  try {
    return realpathSync(entryPath) === import.meta.filename;
  } catch {
    // argv[1] isn't a real file (a wrapper, or a path without its extension):
    // then this module isn't the entry point.
    return false;
  }
};

if (isEntryPoint()) {
  const { logger, requestShutdown } = startServer();

  // While shutdown runs, repeated signals join it (the deadline bounds it).
  // Once it completes, the handlers are removed: if something still holds the
  // process open, the next Ctrl+C gets Node's default behavior and kills it.
  const uninstallProcessHandlers = installProcessHandlers({
    logger,
    requestShutdown: (request) => {
      void requestShutdown(request).finally(uninstallProcessHandlers);
    },
  });
}
