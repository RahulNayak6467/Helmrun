import { createLogger } from '@helmrun/logger';
import { systemClock } from '@helmrun/shared';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp, MAX_REQUEST_BODY_BYTES } from './app.js';
import type { ReadinessChecker } from './health/readiness.js';
import { REQUEST_ID_HEADER } from './http/request-id.middleware.js';

const alwaysReady: ReadinessChecker = () => Promise.resolve({ status: 'ready' });

const createTestApp = (checkReadiness: ReadinessChecker = alwaysReady) =>
  createApp({
    logger: createLogger({ level: 'silent', pretty: false, service: 'test', environment: 'test' }),
    clock: systemClock,
    checkReadiness,
  });

const createLoggingTestApp = () => {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
  const app = createApp({
    logger: createLogger({ level: 'info', pretty: false, service: 'test', environment: 'test' }),
    clock: systemClock,
    checkReadiness: alwaysReady,
  });
  const errorLines = () =>
    chunks
      .join('')
      .split('\n')
      .filter((line) => line.includes('"event":"request_failed"'));

  return { app, errorLines };
};

describe('createApp', () => {
  it('builds an app without opening a port', () => {
    const app = createTestApp();

    expect(typeof app.listen).toBe('function');
    expect(app.get('x-powered-by')).toBe(false);
  });

  it('does not advertise the framework in responses', async () => {
    const response = await request(createTestApp()).get('/anything');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('sets a request ID on every response', async () => {
    const response = await request(createTestApp()).get('/anything');

    expect(response.headers[REQUEST_ID_HEADER]).toEqual(expect.any(String));
  });

  it('rejects a JSON body over the size limit with 413', async () => {
    const oversized = JSON.stringify({ data: 'x'.repeat(MAX_REQUEST_BODY_BYTES) });

    const response = await request(createTestApp())
      .post('/anything')
      .set('content-type', 'application/json')
      .send(oversized);

    expect(response.status).toBe(413);
    expect(response.headers[REQUEST_ID_HEADER]).toEqual(expect.any(String));
    expect(response.body).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
        requestId: response.headers[REQUEST_ID_HEADER],
      },
    });
  });

  it('answers an unknown route with a 404 JSON envelope carrying the request ID', async () => {
    const response = await request(createTestApp()).get('/nope');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/json\b/u);
    expect(response.body).toEqual({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route not found',
        requestId: response.headers[REQUEST_ID_HEADER],
      },
    });
  });

  it('uses the generated request ID, not the client one, in the error body and its log line', async () => {
    const { app, errorLines } = createLoggingTestApp();

    const response = await request(app).get('/nope').set(REQUEST_ID_HEADER, 'client-chosen-id');

    const generatedId = response.headers[REQUEST_ID_HEADER];
    expect(generatedId).toEqual(expect.any(String));
    expect(generatedId).not.toBe('client-chosen-id');
    expect(response.body).toEqual({
      error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found', requestId: generatedId },
    });
    expect(errorLines()).toHaveLength(1);
    expect(errorLines()[0]?.match(/"requestId":/gu)).toHaveLength(1);
    expect(errorLines()[0]).toContain(`"requestId":"${String(generatedId)}"`);
  });

  it('answers an unsupported Content-Encoding with 400 UNSUPPORTED_CONTENT_ENCODING, logged at info', async () => {
    const { app, errorLines } = createLoggingTestApp();

    const response = await request(app)
      .post('/health/live')
      .set('content-type', 'application/json')
      .set('content-encoding', 'foo')
      .send('{"a":1}');

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/^application\/json\b/u);
    expect(response.body).toEqual({
      error: {
        code: 'UNSUPPORTED_CONTENT_ENCODING',
        message: 'Request Content-Encoding is not supported',
        requestId: response.headers[REQUEST_ID_HEADER],
      },
    });
    expect(errorLines()).toHaveLength(1);
    expect(errorLines()[0]).toContain('"severity":"INFO"');
  });

  it('answers an unsupported charset with 400 UNSUPPORTED_CHARSET', async () => {
    const response = await request(createTestApp())
      .post('/health/live')
      .set('content-type', 'application/json; charset=latin1')
      .send('{"a":1}');

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/^application\/json\b/u);
    expect(response.body).toEqual({
      error: {
        code: 'UNSUPPORTED_CHARSET',
        message: 'Request charset is not supported',
        requestId: response.headers[REQUEST_ID_HEADER],
      },
    });
  });

  it('answers broken JSON with a 400 JSON envelope carrying the request ID', async () => {
    const response = await request(createTestApp())
      .post('/health/live')
      .set('content-type', 'application/json')
      .send('{"broken": ');

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/^application\/json\b/u);
    expect(response.body).toEqual({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
        requestId: response.headers[REQUEST_ID_HEADER],
      },
    });
  });

  it.each([
    ['unknown route', () => request(createTestApp()).get('/nope')],
    [
      'broken JSON',
      () =>
        request(createTestApp())
          .post('/health/live')
          .set('content-type', 'application/json')
          .send('{"broken": '),
    ],
    [
      'oversized body',
      () =>
        request(createTestApp())
          .post('/anything')
          .set('content-type', 'application/json')
          .send(JSON.stringify({ data: 'x'.repeat(MAX_REQUEST_BODY_BYTES) })),
    ],
  ])('sends the %s error as JSON, without x-powered-by or HTML', async (_name, send) => {
    const response = await send();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['content-type']).toMatch(/^application\/json\b/u);
    expect(response.text).not.toMatch(/<!doctype|<html|<pre/iu);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)(
    'answers %s /health/live with a 404 JSON envelope',
    async (method) => {
      const response = await request(createTestApp())[method]('/health/live');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: 'Route not found',
          requestId: response.headers[REQUEST_ID_HEADER],
        },
      });
    },
  );

  it('mounts liveness at /health/live with a request ID', async () => {
    const response = await request(createTestApp()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers[REQUEST_ID_HEADER]).toEqual(expect.any(String));
  });

  it('mounts readiness at /health/ready using the injected checker', async () => {
    const response = await request(
      createTestApp(() => Promise.resolve({ status: 'not_ready', reason: 'draining' })),
    ).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready' });
  });
});
