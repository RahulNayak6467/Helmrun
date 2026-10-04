import * as z from 'zod';

// Reusable env schema pieces. Each app combines the ones it needs in its own
// src/config.ts, then adds its cross-field rules after combining.
export { environmentEnvSchema, type NodeEnvironment } from './environment.js';
export { loggerEnvSchema } from './logging.js';
export { databaseEnvSchema, databaseUrlSchema } from './database.js';
export { integerEnv } from './integer.js';

// Raw key/value input, normally process.env. Taking it as a parameter keeps
// parsing a pure function that tests can call with any object.
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface ConfigValidationIssue {
  readonly field: string;
  readonly reason: string;
}

// Turns a Zod validation error into "field: reason" pairs for a readable
// startup error. Reports names and reasons only, never the rejected values,
// so secrets in env vars can't end up in logs.
export const toConfigValidationIssues = (
  error: unknown,
): readonly ConfigValidationIssue[] | null => {
  if (!(error instanceof z.ZodError)) {
    return null;
  }

  return error.issues.map((issue) => ({
    field: issue.path.length === 0 ? 'configuration' : issue.path.map(String).join('.'),
    reason: issue.message,
  }));
};
