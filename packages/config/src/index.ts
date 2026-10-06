// Reusable env schema pieces. Each app combines the ones it needs in its own
// src/config.ts, then adds its cross-field rules after combining.
export { environmentEnvSchema, type NodeEnvironment } from './environment.js';
export { loggerEnvSchema } from './logging.js';
export { applyLoggerRules } from './logging-rules.js';
export { databaseEnvSchema, databaseUrlSchema } from './database.js';
export { redisEnvSchema } from './redis.js';
export { integerEnv } from './integer.js';
export { toConfigValidationIssues, type ConfigValidationIssue } from './issues.js';
export { loadConfigOrExit, type ConfigExitTarget } from './load.js';

// Raw key/value input, normally process.env. Taking it as a parameter keeps
// parsing a pure function that tests can call with any object.
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;
