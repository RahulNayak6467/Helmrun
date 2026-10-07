import { Pool, type PoolConfig } from 'pg';

import type { DatabaseLogger } from './logger.js';

// Typed options instead of env variable names (decision 009). Each app maps its
// parsed config onto this.
export interface DatabaseOptions {
  readonly url: string;
  readonly poolMax: number;
  readonly connectionTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly statementTimeoutMs: number;
  // Shown in pg_stat_activity, so every connection can be traced to its process
  // (e.g. 'helmrun-api', 'helmrun-worker').
  readonly applicationName: string;
}

const KEEP_ALIVE_INITIAL_DELAY_MS = 10_000;
// How long after the server-side statement timeout the client gives up.
const QUERY_TIMEOUT_MARGIN_MS = 2_000;

// One pool per process: build it once in the composition root and inject it.
export const createPool = (options: DatabaseOptions, logger: DatabaseLogger): Pool => {
  const pool = new Pool({
    connectionString: options.url,
    max: options.poolMax,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    idleTimeoutMillis: options.idleTimeoutMs,
    // Server-side: Postgres cancels a slow query, so it can't hold a pooled
    // connection forever.
    statement_timeout: options.statementTimeoutMs,
    // Client-side backstop: if the network dies mid-query, the server's cancel
    // never arrives and the query would hang until OS keepalive gives up
    // (minutes). Derived, not configured, so it always sits just above the
    // statement timeout and the server's clearer error wins for slow queries.
    query_timeout: options.statementTimeoutMs + QUERY_TIMEOUT_MARGIN_MS,
    application_name: options.applicationName,
    keepAlive: true,
    keepAliveInitialDelayMillis: KEEP_ALIVE_INITIAL_DELAY_MS,
  } satisfies PoolConfig);

  pool.on('connect', () => {
    logger.debug(
      { component: 'postgres', event: 'postgres_connection_opened' },
      'PostgreSQL pool opened a connection',
    );
  });

  // Without this listener, an error on an idle pooled connection (Postgres
  // restart, network drop) is an unhandled 'error' event and crashes the
  // process. The pool discards the broken client; we only log it. Only safe
  // fields are copied: the raw error can reference the client and its
  // connection string, which contains the password.
  pool.on('error', (error) => {
    logger.error(
      {
        component: 'postgres',
        event: 'postgres_idle_client_error',
        errorDetails: {
          name: error.name,
          message: error.message,
          stack: error.stack,
          ...('code' in error && typeof error.code === 'string' ? { code: error.code } : {}),
        },
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingRequests: pool.waitingCount,
      },
      'PostgreSQL idle client emitted an error',
    );
  });

  logger.info(
    {
      component: 'postgres',
      event: 'postgres_pool_configured',
      applicationName: options.applicationName,
      maxConnections: options.poolMax,
      connectionTimeoutMs: options.connectionTimeoutMs,
      idleTimeoutMs: options.idleTimeoutMs,
      statementTimeoutMs: options.statementTimeoutMs,
    },
    'PostgreSQL pool configured',
  );

  return pool;
};
