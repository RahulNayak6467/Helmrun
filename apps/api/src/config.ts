import * as z from 'zod';
import {
  applyLoggerRules,
  databaseEnvSchema,
  environmentEnvSchema,
  integerEnv,
  loggerEnvSchema,
  redisEnvSchema,
  type EnvironmentSource,
} from '@helmrun/config';

// API-only settings. The worker and scheduler run no HTTP server, so these
// stay here instead of in packages/config. Upper bounds keep every duration far
// below Node's timer limit (2^31-1 ms), above which setTimeout fires after 1 ms.
const serverEnvSchema = z.object({
  PORT: integerEnv('PORT', { min: 1, max: 65_535, fallback: 8010 }),
  HTTP_REQUEST_TIMEOUT_MS: integerEnv('HTTP_REQUEST_TIMEOUT_MS', {
    min: 1_000,
    max: 300_000,
    fallback: 30_000,
    unit: 'milliseconds',
  }),
  HTTP_HEADERS_TIMEOUT_MS: integerEnv('HTTP_HEADERS_TIMEOUT_MS', {
    min: 1_000,
    max: 120_000,
    fallback: 20_000,
    unit: 'milliseconds',
  }),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: integerEnv('HTTP_KEEP_ALIVE_TIMEOUT_MS', {
    min: 1_000,
    max: 120_000,
    fallback: 5_000,
    unit: 'milliseconds',
  }),
  // Above the default statement timeout (15 s): see the shutdown rule below.
  // At least 5 s: Redis alone may take 2 s to quit (packages/redis).
  SHUTDOWN_TIMEOUT_MS: integerEnv('SHUTDOWN_TIMEOUT_MS', {
    min: 5_000,
    max: 120_000,
    fallback: 20_000,
    unit: 'milliseconds',
  }),
});

// Combine first, then check rules. `.shape` copies fields only: a rule attached
// to a piece would be silently dropped, and some rules need fields from two pieces.
export const apiEnvSchema = z
  .object({
    ...environmentEnvSchema.shape,
    ...loggerEnvSchema.shape,
    ...databaseEnvSchema.shape,
    ...serverEnvSchema.shape,
    ...redisEnvSchema.shape,
  })
  .superRefine((env, context) => {
    if (env.HTTP_HEADERS_TIMEOUT_MS > env.HTTP_REQUEST_TIMEOUT_MS) {
      context.addIssue({
        code: 'custom',
        path: ['HTTP_HEADERS_TIMEOUT_MS'],
        message: 'Header timeout must not exceed request timeout',
      });
    }

    applyLoggerRules(env, context);

    if (env.DB_READINESS_TIMEOUT_MS > env.DB_STATEMENT_TIMEOUT_MS) {
      context.addIssue({
        code: 'custom',
        path: ['DB_READINESS_TIMEOUT_MS'],
        message: 'Database readiness timeout must not exceed statement timeout',
      });
    }

    // Shutdown waits for in-flight requests. One still running a query the
    // config allows must be able to finish before the deadline force-exits
    // (exit 1, pool never closed). Doesn't cover several slow queries in one
    // request; that needs per-request deadlines.
    if (env.SHUTDOWN_TIMEOUT_MS <= env.DB_STATEMENT_TIMEOUT_MS) {
      context.addIssue({
        code: 'custom',
        path: ['SHUTDOWN_TIMEOUT_MS'],
        message: 'Shutdown timeout must exceed database statement timeout',
      });
    }
  })
  // Reshape flat env names into the nested, frozen object the app uses. The
  // ApiConfig type is inferred from this, so there's no hand-written interface
  // to keep in sync.
  .transform((env) =>
    Object.freeze({
      environment: env.NODE_ENV,
      server: Object.freeze({
        port: env.PORT,
        requestTimeoutMs: env.HTTP_REQUEST_TIMEOUT_MS,
        headersTimeoutMs: env.HTTP_HEADERS_TIMEOUT_MS,
        keepAliveTimeoutMs: env.HTTP_KEEP_ALIVE_TIMEOUT_MS,
        shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
      }),
      logging: Object.freeze({
        level: env.LOG_LEVEL,
        pretty: env.LOG_PRETTY,
      }),
      database: Object.freeze({
        url: env.DATABASE_URL,
        poolMax: env.DB_POOL_MAX,
        connectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
        idleTimeoutMs: env.DB_POOL_IDLE_TIMEOUT_MS,
        statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
        readinessTimeoutMs: env.DB_READINESS_TIMEOUT_MS,
      }),
      redis: Object.freeze({
        url: env.REDIS_URL,
        commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
        connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
      }),
    }),
  );

export type ApiConfig = z.output<typeof apiEnvSchema>;

// Pure: validates any env-shaped object. Tests call this directly.
export const parseConfig = (env: EnvironmentSource): ApiConfig => apiEnvSchema.parse(env);

// The only place the API reads process.env.
export const loadConfig = (): ApiConfig => parseConfig(process.env);
