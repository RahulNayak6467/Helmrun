import * as z from 'zod';

import { integerEnv } from './integer.js';

export const databaseUrlSchema = z
  .string({
    error: 'DATABASE_URL is required',
  })
  // abort: an empty value is already known to be invalid, so skip the URL checks
  // instead of reporting a second, misleading "invalid URL" issue.
  .min(1, {
    error: 'DATABASE_URL is required',
    abort: true,
  })
  .superRefine((value, context) => {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'DATABASE_URL must be a valid PostgreSQL connection URL',
      });

      return;
    }
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      context.addIssue({
        code: 'custom',
        message: 'DATABASE_URL must use the postgres:// or postgresql:// protocol',
      });
    }
    if (url.hostname.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'DATABASE_URL must include a hostname',
      });
    }
    if (url.pathname.length <= 1) {
      context.addIssue({
        code: 'custom',
        message: 'DATABASE_URL must include a database name',
      });
    }
  });

export const databaseEnvSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  DB_POOL_MAX: integerEnv('DB_POOL_MAX', { min: 1, max: 50, fallback: 10, unit: 'connections' }),
  DB_CONNECTION_TIMEOUT_MS: integerEnv('DB_CONNECTION_TIMEOUT_MS', {
    min: 100,
    max: 30_000,
    fallback: 5_000,
    unit: 'milliseconds',
  }),
  DB_POOL_IDLE_TIMEOUT_MS: integerEnv('DB_POOL_IDLE_TIMEOUT_MS', {
    min: 1_000,
    max: 300_000,
    fallback: 10_000,
    unit: 'milliseconds',
  }),
  DB_STATEMENT_TIMEOUT_MS: integerEnv('DB_STATEMENT_TIMEOUT_MS', {
    min: 100,
    max: 120_000,
    fallback: 15_000,
    unit: 'milliseconds',
  }),
  DB_READINESS_TIMEOUT_MS: integerEnv('DB_READINESS_TIMEOUT_MS', {
    min: 100,
    max: 5_000,
    fallback: 1_000,
    unit: 'milliseconds',
  }),
});
