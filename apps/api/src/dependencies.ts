import { createPool, type Pool } from '@helmrun/database';
import { createLogger, type Logger } from '@helmrun/logger';
import { systemClock, type Clock } from '@helmrun/shared';

import type { ApiConfig } from './config.js';

// Identifies this process in logs and in pg_stat_activity.
export const SERVICE_NAME = 'helmrun-api';

// Helmrun handles agent prompts and model output: user data that must never
// reach logs. The logger package's base list covers generic secrets; these are
// Helmrun's own additions (decision 011).
export const AGENT_PAYLOAD_REDACT_PATHS = [
  'prompt',
  'prompts',
  'messages',
  'completion',
  'completions',
  'modelInput',
  'modelOutput',
  'llm.prompt',
  'llm.prompts',
  'llm.messages',
  'llm.input',
  'llm.output',
] as const;

export interface ApiDependencies {
  readonly config: ApiConfig;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly databasePool: Pool;
}

// Composition root: every long-lived client is built here, once, and injected
// everywhere else. Nothing else in the API constructs a logger or a pool.
export const createDependencies = (config: ApiConfig): ApiDependencies => {
  const logger = createLogger({
    level: config.logging.level,
    pretty: config.logging.pretty,
    service: SERVICE_NAME,
    environment: config.environment,
    extraRedactPaths: AGENT_PAYLOAD_REDACT_PATHS,
  });

  // pg connects lazily: no connection is opened until the first query.
  const databasePool = createPool({ ...config.database, applicationName: SERVICE_NAME }, logger);

  return { config, logger, clock: systemClock, databasePool };
};
