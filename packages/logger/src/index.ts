export { createLogger, type LoggerOptions, type LogLevel } from './logger.js';
export {
  BASE_REDACTION_PATHS,
  createRedactionOptions,
  REDACTION_CENSOR,
  SENSITIVE_FIELD_NAMES,
} from './redaction.js';

// Re-exported so apps can type loggers without depending on `pino` directly.
export type { Logger } from 'pino';
