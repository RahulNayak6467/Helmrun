import { realpathSync } from 'node:fs';
import http from 'node:http';

import { toConfigValidationIssues } from '@helmrun/config';

import { createApp } from './app.js';
import { loadConfig, type ApiConfig } from './config.js';
import { createDependencies, SERVICE_NAME } from './dependencies.js';

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

export const startServer = (): http.Server => {
  const config = loadConfigOrExit();
  const dependencies = createDependencies(config);
  const { logger } = dependencies;
  const app = createApp(dependencies);

  const server = http.createServer(
    {
      requestTimeout: config.server.requestTimeoutMs,
      headersTimeout: config.server.headersTimeoutMs,
      keepAliveTimeout: config.server.keepAliveTimeoutMs,
    },
    app,
  );

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

  // Graceful shutdown (step 15) is wired in a later chunk.

  return server;
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
  startServer();
}
