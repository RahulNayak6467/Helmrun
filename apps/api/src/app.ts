import express, { type Express } from 'express';

import type { ApiDependencies } from './dependencies.js';
import { createRequestIdMiddleware } from './http/request-id.middleware.js';
import { createRequestLoggerMiddleware } from './http/request-logger.middleware.js';

// The API takes small JSON bodies; large artifacts belong in object storage.
export const MAX_REQUEST_BODY_BYTES = 1_048_576;

// Builds the Express app without listening, so tests can drive it with
// Supertest and main.ts owns the process (decision 005).
export const createApp = (dependencies: Pick<ApiDependencies, 'logger' | 'clock'>): Express => {
  const app = express();

  // Don't advertise the framework in every response.
  app.disable('x-powered-by');

  // Request ID first, so everything after it (including body-parse failures)
  // logs with the ID.
  app.use(createRequestIdMiddleware(dependencies.logger));
  app.use(createRequestLoggerMiddleware(dependencies.clock));
  app.use(express.json({ limit: MAX_REQUEST_BODY_BYTES }));

  // Health routes (step 14), not-found and error handling (step 13) are added
  // in later chunks.

  return app;
};
