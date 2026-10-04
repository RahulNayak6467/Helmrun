import express, { type Express } from 'express';

import type { ApiDependencies } from './dependencies.js';
import { createHealthRoutes } from './health/health.routes.js';
import type { ReadinessChecker } from './health/readiness.js';
import { createRequestIdMiddleware } from './http/request-id.middleware.js';
import { createRequestLoggerMiddleware } from './http/request-logger.middleware.js';

// The API takes small JSON bodies; large artifacts belong in object storage.
export const MAX_REQUEST_BODY_BYTES = 1_048_576;

// Readiness depends on process state (draining) as well as clients, so main.ts
// builds the checker and passes it in; tests pass a fake.
export interface AppDependencies extends Pick<ApiDependencies, 'logger' | 'clock'> {
  readonly checkReadiness: ReadinessChecker;
}

// Builds the Express app without listening, so tests can drive it with
// Supertest and main.ts owns the process (decision 005).
export const createApp = (dependencies: AppDependencies): Express => {
  const app = express();

  // Don't advertise the framework in every response.
  app.disable('x-powered-by');

  // Request ID first, so everything after it (including body-parse failures)
  // logs with the ID.
  app.use(createRequestIdMiddleware(dependencies.logger));
  app.use(createRequestLoggerMiddleware(dependencies.clock));
  app.use(express.json({ limit: MAX_REQUEST_BODY_BYTES }));

  app.use('/health', createHealthRoutes(dependencies.checkReadiness));

  // Not-found and error handling (step 13) are added in a later chunk.

  return app;
};
