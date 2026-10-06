import * as z from 'zod';
import {
  applyLoggerRules,
  environmentEnvSchema,
  integerEnv,
  loggerEnvSchema,
  type EnvironmentSource,
} from '@helmrun/config';

// Shell until phase 3: no database, Redis, or queue yet, so only what start,
// log, and shut down need.
const workerEnvSchema = z.object({
  SHUTDOWN_TIMEOUT_MS: integerEnv('SHUTDOWN_TIMEOUT_MS', {
    min: 1_000,
    max: 120_000,
    fallback: 10_000,
    unit: 'milliseconds',
  }),
});

// Combine first, then check rules (decision 009).
export const workerConfigSchema = z
  .object({
    ...environmentEnvSchema.shape,
    ...loggerEnvSchema.shape,
    ...workerEnvSchema.shape,
  })
  .superRefine(applyLoggerRules)
  .transform((env) =>
    Object.freeze({
      environment: env.NODE_ENV,
      shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
      logging: Object.freeze({
        level: env.LOG_LEVEL,
        pretty: env.LOG_PRETTY,
      }),
    }),
  );

export type WorkerConfig = z.output<typeof workerConfigSchema>;

// Pure: validates any env-shaped object. Tests call this directly.
export const parseConfig = (env: EnvironmentSource): WorkerConfig => workerConfigSchema.parse(env);

// The only place the worker reads process.env.
export const loadConfig = (): WorkerConfig => parseConfig(process.env);
