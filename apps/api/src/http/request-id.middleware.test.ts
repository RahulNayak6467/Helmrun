import { createLogger } from '@helmrun/logger';
import { systemClock } from '@helmrun/shared';
import express, { type Request } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import {
  createRequestIdMiddleware,
  REQUEST_ID_HEADER,
  REQUEST_ID_MAX_LENGTH,
  requireRequestContext,
} from './request-id.middleware.js';

const silentLogger = () =>
  createLogger({ level: 'silent', pretty: false, service: 'test', environment: 'test' });

const createProbeApp = (generateRequestId?: () => string, rootLogger = silentLogger()) => {
  const app = express();
  app.use(
    generateRequestId === undefined
      ? createRequestIdMiddleware(rootLogger)
      : createRequestIdMiddleware(rootLogger, generateRequestId),
  );
  app.get('/probe', (req, res) => {
    const { requestId, clientRequestId, logger } = requireRequestContext(req);
    const bindings = logger.bindings();

    res.json({
      requestId,
      clientRequestId: clientRequestId ?? null,
      boundRequestId: bindings.requestId as unknown,
      boundClientRequestId: (bindings.clientRequestId as unknown) ?? null,
    });
  });

  return { app, rootLogger };
};

describe('request ID middleware', () => {
  it('always generates its own ID, even when the client sends a valid one', async () => {
    const generateRequestId = vi.fn(() => 'generated-request-id');
    const { app } = createProbeApp(generateRequestId);

    const response = await request(app)
      .get('/probe')
      .set(REQUEST_ID_HEADER, 'client-request_123.production');

    expect(response.status).toBe(200);
    expect(response.headers[REQUEST_ID_HEADER]).toBe('generated-request-id');
    expect(generateRequestId).toHaveBeenCalledOnce();
  });

  it('records a valid client ID separately, in the context and the child logger', async () => {
    const { app } = createProbeApp(vi.fn(() => 'generated-request-id'));

    const response = await request(app)
      .get('/probe')
      .set(REQUEST_ID_HEADER, 'client-request_123.production');

    expect(response.body).toEqual({
      requestId: 'generated-request-id',
      clientRequestId: 'client-request_123.production',
      boundRequestId: 'generated-request-id',
      boundClientRequestId: 'client-request_123.production',
    });
  });

  it('gives two requests that reuse the same client ID distinct request IDs', async () => {
    const generateRequestId = vi
      .fn<() => string>()
      .mockReturnValueOnce('generated-request-1')
      .mockReturnValueOnce('generated-request-2');
    const { app } = createProbeApp(generateRequestId);

    const first = await request(app).get('/probe').set(REQUEST_ID_HEADER, 'reused-id');
    const second = await request(app).get('/probe').set(REQUEST_ID_HEADER, 'reused-id');

    expect(first.body).toMatchObject({
      requestId: 'generated-request-1',
      clientRequestId: 'reused-id',
    });
    expect(second.body).toMatchObject({
      requestId: 'generated-request-2',
      clientRequestId: 'reused-id',
    });
  });

  it('records no client ID when the header is missing', async () => {
    const { app } = createProbeApp(vi.fn(() => 'generated-request-id'));

    const response = await request(app).get('/probe');

    expect(response.body).toEqual({
      requestId: 'generated-request-id',
      clientRequestId: null,
      boundRequestId: 'generated-request-id',
      boundClientRequestId: null,
    });
  });

  it('uses a UUID by default', async () => {
    const { app } = createProbeApp();

    const response = await request(app).get('/probe');

    expect(response.headers[REQUEST_ID_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it.each([
    ['', 'empty'],
    ['contains a space', 'space'],
    ['contains/slash', 'unsupported character'],
    ['first-id, second-id', 'duplicate-like value'],
    ['{"injected":true}', 'JSON fragment'],
    ['a'.repeat(REQUEST_ID_MAX_LENGTH + 1), 'oversized'],
  ])('drops an invalid client ID %j (%s)', async (incomingRequestId) => {
    const { app } = createProbeApp(vi.fn(() => 'generated-request-id'));

    const response = await request(app).get('/probe').set(REQUEST_ID_HEADER, incomingRequestId);

    expect(response.headers[REQUEST_ID_HEADER]).toBe('generated-request-id');
    expect(response.body).toMatchObject({ clientRequestId: null, boundClientRequestId: null });
  });

  it('accepts a client ID at the maximum length', async () => {
    const maximumLengthId = 'a'.repeat(REQUEST_ID_MAX_LENGTH);
    const { app } = createProbeApp(vi.fn(() => 'generated-request-id'));

    const response = await request(app).get('/probe').set(REQUEST_ID_HEADER, maximumLengthId);

    expect(response.body).toMatchObject({ clientRequestId: maximumLengthId });
  });

  it('creates a distinct context for each concurrent request', async () => {
    const generateRequestId = vi
      .fn<() => string>()
      .mockReturnValueOnce('generated-request-1')
      .mockReturnValueOnce('generated-request-2');
    const { app } = createProbeApp(generateRequestId);

    const responses = await Promise.all([request(app).get('/probe'), request(app).get('/probe')]);

    expect(responses.map((response) => response.headers[REQUEST_ID_HEADER]).sort()).toEqual([
      'generated-request-1',
      'generated-request-2',
    ]);
  });

  it('does not add request bindings to the root logger', async () => {
    const { app, rootLogger } = createProbeApp(vi.fn(() => 'generated-request-id'));

    await request(app).get('/probe');

    expect(rootLogger.bindings()).not.toHaveProperty('requestId');
  });
});

describe('requireRequestContext', () => {
  it('throws a clear error when the request ID middleware has not run', () => {
    expect(() => requireRequestContext({} as Request)).toThrow(
      'the request ID middleware must run first',
    );
  });
});

describe('createApp request ID integration', () => {
  it('sets its own request ID even on an unmatched route', async () => {
    const app = createApp({
      logger: silentLogger(),
      clock: systemClock,
      checkReadiness: () => Promise.resolve({ status: 'ready' }),
    });

    const response = await request(app).get('/not-configured').set(REQUEST_ID_HEADER, 'client-id');

    expect(response.status).toBe(404);
    expect(response.headers[REQUEST_ID_HEADER]).toEqual(expect.any(String));
    expect(response.headers[REQUEST_ID_HEADER]).not.toBe('client-id');
  });
});
