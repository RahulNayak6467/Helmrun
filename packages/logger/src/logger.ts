import pino, { type Level, type Logger } from 'pino';

import { createRedactionOptions } from './redaction.js';

export type LogLevel = Level | 'silent';

// Typed options instead of an app config object (decisions 009, 011).
export interface LoggerOptions {
  readonly level: LogLevel;
  // Human-readable output for local development. Apps must forbid it in
  // production (it's slower and not machine-parseable).
  readonly pretty: boolean;
  // Identifies the process in every record, e.g. 'helmrun-api'.
  readonly service: string;
  readonly environment: string;
  // App-specific fields to redact on top of the generic base list.
  readonly extraRedactPaths?: readonly string[];
}

export const createLogger = (options: LoggerOptions): Logger =>
  pino({
    level: options.level,
    ...(options.pretty
      ? {
          // No severity formatter here: pino-pretty reads the standard `level`
          // field to label and colour each line.
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname',
              messageFormat: '{msg}',
              colorizeObjects: true,
            },
          },
        }
      : {
          // Machine-readable output: `severity` as an uppercase label is what
          // log platforms (CloudWatch, GCP, Grafana Loki) filter on.
          formatters: {
            level: (label: string) => ({ severity: label.toUpperCase() }),
          },
        }),
    base: {
      service: options.service,
      env: options.environment,
    },
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    redact: createRedactionOptions(options.extraRedactPaths),
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
  });
