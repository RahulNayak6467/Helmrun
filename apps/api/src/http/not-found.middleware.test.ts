import { createLogger } from '@helmrun/logger';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createErrorMiddleware } from './error.middleware.js';
import { notFoundMiddleware } from './not-found.middleware.js';
import { createRequestIdMiddleware } from './request-id.middleware.js';

describe('not found middleware', () => {
  it('turns an unknown route into a 404 ROUTE_NOT_FOUND envelope', async () => {
    const logger = createLogger({
      level: 'silent',
      pretty: false,
      service: 'test',
      environment: 'test',
    });
    const app = express();
    app.use(createRequestIdMiddleware(logger, () => 'request-123'));
    app.get('/known', (_req, res) => {
      res.status(204).end();
    });
    app.use(notFoundMiddleware);
    app.use(createErrorMiddleware(logger));

    const response = await request(app).get('/unknown');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found', requestId: 'request-123' },
    });
  });
});
