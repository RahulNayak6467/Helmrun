import { createLogger } from '@helmrun/logger';
import { systemClock } from '@helmrun/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp, MAX_REQUEST_BODY_BYTES } from './app.js';
import { REQUEST_ID_HEADER } from './http/request-id.middleware.js';

const createTestApp = () =>
  createApp({
    logger: createLogger({ level: 'silent', pretty: false, service: 'test', environment: 'test' }),
    clock: systemClock,
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
});
