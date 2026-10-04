import { createLogger } from '@helmrun/logger';
import { systemClock } from '@helmrun/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

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
  });

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
