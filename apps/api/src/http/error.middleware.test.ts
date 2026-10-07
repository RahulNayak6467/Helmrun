import { createLogger } from '@helmrun/logger';
import { AppError, type ErrorKind } from '@helmrun/shared';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

import { createErrorMiddleware } from './error.middleware.js';
import { createRequestIdMiddleware } from './request-id.middleware.js';

type LogRecord = Record<string, unknown>;

const REQUEST_ID = 'request-123';

const captureLogs = () => {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
  const logger = createLogger({
    level: 'info',
    pretty: false,
    service: 'test',
    environment: 'test',
  });

  const raw = () => chunks.join('');
  const records = (): LogRecord[] =>
    raw()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const parsed: unknown = JSON.parse(line);

        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('Expected a structured JSON log object');
        }

        return parsed as LogRecord;
      });

  return { logger, raw, records };
};

const createHarness = (
  handler: RequestHandler,
  { withRequestId = true }: { withRequestId?: boolean } = {},
) => {
  const logs = captureLogs();
  const app = express();
  if (withRequestId) app.use(createRequestIdMiddleware(logs.logger, () => REQUEST_ID));
  app.use(express.json({ limit: '1kb' }));
  app.all('/probe', handler);
  app.use(createErrorMiddleware(logs.logger));

  return { app, logs };
};

const throwing =
  (error: unknown): RequestHandler =>
  () => {
    throw error;
  };

const respondNoContent: RequestHandler = (_req, res) => {
  res.status(204).end();
};

const pgUniqueViolation = () =>
  Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
    code: '23505',
    constraint: 'users_email_key',
    table: 'users',
    detail: 'Key (email)=(alice@example.com) already exists.',
  });

describe('error middleware', () => {
  it('maps an AppError not_found to 404 with its code and message, logged once at info', async () => {
    const { app, logs } = createHarness(
      throwing(new AppError({ kind: 'not_found', code: 'AGENT_NOT_FOUND', message: 'No agent' })),
    );

    const response = await request(app).get('/probe');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'AGENT_NOT_FOUND', message: 'No agent', requestId: REQUEST_ID },
    });
    expect(logs.records()).toHaveLength(1);
    expect(logs.records()[0]).toMatchObject({
      severity: 'INFO',
      event: 'request_failed',
      code: 'AGENT_NOT_FOUND',
      kind: 'not_found',
      status: 404,
      requestId: REQUEST_ID,
    });
  });

  it('maps an AppError unavailable to 503 and logs it at error', async () => {
    const { app, logs } = createHarness(
      throwing(new AppError({ kind: 'unavailable', code: 'DB_DOWN', message: 'Try later' })),
    );

    const response = await request(app).get('/probe');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: { code: 'DB_DOWN', message: 'Try later', requestId: REQUEST_ID },
    });
    expect(logs.records()).toHaveLength(1);
    expect(logs.records()[0]).toMatchObject({
      severity: 'ERROR',
      event: 'request_failed',
      code: 'DB_DOWN',
      kind: 'unavailable',
      status: 503,
    });
  });

  it.each([
    ['invalid_input', 400],
    ['unauthenticated', 401],
    ['quota_exceeded', 403],
    ['not_found', 404],
    ['conflict', 409],
    ['payload_too_large', 413],
    ['rate_limited', 429],
    ['internal', 500],
    ['unavailable', 503],
  ] satisfies [ErrorKind, number][])('maps kind %s to status %i', async (kind, status) => {
    const { app } = createHarness(throwing(new AppError({ kind, code: 'CODE', message: 'Msg' })));

    const response = await request(app).get('/probe');

    expect(response.status).toBe(status);
    expect(response.body).toEqual({
      error: { code: 'CODE', message: 'Msg', requestId: REQUEST_ID },
    });
  });

  it('answers a broken JSON body with 400 INVALID_JSON and logs it without a cause', async () => {
    const { app, logs } = createHarness(respondNoContent);

    const response = await request(app)
      .post('/probe')
      .set('content-type', 'application/json')
      .send('{"name": ');

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/^application\/json\b/u);
    expect(response.body).toEqual({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
        requestId: REQUEST_ID,
      },
    });
    expect(response.text).not.toMatch(/<html|<pre|SyntaxError|\s+at\s/iu);
    expect(logs.records()).toHaveLength(1);
    expect(logs.records()[0]).toMatchObject({
      severity: 'INFO',
      event: 'request_failed',
      code: 'INVALID_JSON',
      kind: 'invalid_input',
      status: 400,
      errorDetails: { name: 'AppError', code: 'INVALID_JSON' },
    });
    expect(logs.records()[0]).not.toHaveProperty('errorDetails.cause');
  });

  it('never writes broken-JSON body text to the logs', async () => {
    const { app, logs } = createHarness(respondNoContent);

    const response = await request(app)
      .post('/probe')
      .set('content-type', 'application/json')
      .send('{"apiKey": sk-live-123456}');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
        requestId: REQUEST_ID,
      },
    });
    expect(logs.raw()).not.toContain('sk-live-12');
  });

  it('answers a body over the JSON limit with 413 PAYLOAD_TOO_LARGE', async () => {
    const { app, logs } = createHarness(respondNoContent);

    const response = await request(app)
      .post('/probe')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(2_048) }));

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
        requestId: REQUEST_ID,
      },
    });
    expect(logs.records()[0]).not.toHaveProperty('errorDetails.cause');
  });

  describe('with other body-parser errors', () => {
    const bodyParserLikeError = (type: string, status: number, expose: boolean) =>
      Object.assign(new Error(`body-parser said ${type}`), { type, status, expose });

    it.each([
      ['request.aborted', 'REQUEST_ABORTED', 'Request was aborted by the client'],
      [
        'request.size.invalid',
        'INVALID_REQUEST_BODY',
        'Request body size does not match Content-Length',
      ],
      ['some.future.type', 'INVALID_REQUEST_BODY', 'Request body could not be read'],
    ])('maps type %s to 400 %s, logged at info', async (type, code, message) => {
      const { app, logs } = createHarness(throwing(bodyParserLikeError(type, 400, true)));

      const response = await request(app).get('/probe');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: { code, message, requestId: REQUEST_ID } });
      expect(logs.records()).toHaveLength(1);
      expect(logs.records()[0]).toMatchObject({
        severity: 'INFO',
        code,
        kind: 'invalid_input',
        status: 400,
      });
      expect(logs.records()[0]).not.toHaveProperty('errorDetails.cause');
    });

    it.each([
      [500, true],
      [500, false],
      [400, false],
    ])(
      'treats an unknown type with status %i and expose %s as an internal error',
      async (status, expose) => {
        const { app, logs } = createHarness(
          throwing(bodyParserLikeError('stream.not.readable', status, expose)),
        );

        const response = await request(app).get('/probe');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId: REQUEST_ID },
        });
        expect(logs.records()[0]).toMatchObject({
          severity: 'ERROR',
          event: 'request_failed_unexpectedly',
        });
      },
    );
  });

  describe('with a ZodError from schema.parse', () => {
    const parseBody =
      (schema: z.ZodType): RequestHandler =>
      (req, res) => {
        schema.parse(req.body);
        res.status(204).end();
      };

    it('returns 400 INVALID_INPUT with a dotted path for a nested field', async () => {
      const schema = z.object({ config: z.object({ model: z.string() }) });
      const { app } = createHarness(parseBody(schema));

      const response = await request(app)
        .post('/probe')
        .send({ config: { model: 42 } });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'INVALID_INPUT',
          message: 'Request validation failed',
          requestId: REQUEST_ID,
          issues: [
            { path: 'config.model', message: 'Invalid input: expected string, received number' },
          ],
        },
      });
    });

    it('returns exactly 10 issues when 15 fields fail', async () => {
      const shape = Object.fromEntries(
        Array.from({ length: 15 }, (_, index) => [`field${String(index)}`, z.string()]),
      );
      const { app } = createHarness(parseBody(z.object(shape)));

      const response = await request(app).post('/probe').send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error.issues.length', 10);
    });

    it('never echoes the rejected values', async () => {
      const schema = z.object({
        name: z.string().max(3),
        mode: z.enum(['fast', 'slow']),
        count: z.number(),
      });
      const { app } = createHarness(parseBody(schema));

      const response = await request(app).post('/probe').send({
        name: 'rejected-name-value',
        mode: 'rejected-mode-value',
        count: 'rejected-count',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error.issues.length', 3);
      expect(response.text).not.toContain('rejected-name-value');
      expect(response.text).not.toContain('rejected-mode-value');
      expect(response.text).not.toContain('rejected-count');
    });

    const parseValue =
      (schema: z.ZodType, value: unknown): RequestHandler =>
      () => {
        schema.parse(value);
      };

    it('keeps the log line small when thousands of items fail', async () => {
      const fiveThousandNumbers = Array.from({ length: 5_000 }, (_, index) => index);
      const { app, logs } = createHarness(parseValue(z.array(z.string()), fiveThousandNumbers));

      const response = await request(app).get('/probe');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error.issues.length', 10);
      expect(logs.records()).toHaveLength(1);
      expect(logs.records()[0]).not.toHaveProperty('errorDetails.cause');
      expect(Buffer.byteLength(logs.raw())).toBeLessThan(10 * 1024);
    });

    it('caps a long unrecognized_keys issue message at 200 characters plus an ellipsis', async () => {
      const manyLongKeys = Object.fromEntries(
        Array.from({ length: 50 }, (_, index) => [
          `unexpected_key_${String(index)}_${'k'.repeat(40)}`,
          1,
        ]),
      );
      const { app } = createHarness(parseValue(z.strictObject({}), manyLongKeys));

      const response = await request(app).get('/probe');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error.issues.length', 1);
      expect(response.body).toHaveProperty(
        'error.issues.0.message',
        expect.stringMatching(/^Unrecognized keys:[\s\S]{182}…$/u),
      );
    });

    it('caps a long record-key path at 200 characters plus an ellipsis', async () => {
      const longKey = 'p'.repeat(1_000);
      const { app } = createHarness(
        parseValue(z.record(z.string(), z.number()), { [longKey]: 'not-a-number' }),
      );

      const response = await request(app).get('/probe');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error.issues.0.path', `${'p'.repeat(200)}…`);
    });
  });

  it('hides an unknown error behind a generic 500 and logs it as unexpected', async () => {
    const { app, logs } = createHarness(throwing(new Error('relation "runs" does not exist')));

    const response = await request(app).get('/probe');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId: REQUEST_ID },
    });
    expect(response.text).not.toContain('relation');
    expect(logs.records()).toHaveLength(1);
    expect(logs.records()[0]).toMatchObject({
      severity: 'ERROR',
      event: 'request_failed_unexpectedly',
      errorDetails: { name: 'Error', message: 'relation "runs" does not exist' },
    });
  });

  it('logs code, constraint, and table from a pg-like error but never its detail', async () => {
    const { app, logs } = createHarness(throwing(pgUniqueViolation()));

    const response = await request(app).get('/probe');

    expect(response.status).toBe(500);
    expect(logs.records()[0]).toMatchObject({
      errorDetails: { code: '23505', constraint: 'users_email_key', table: 'users' },
    });
    expect(logs.records()[0]).not.toHaveProperty('errorDetails.detail');
    expect(logs.raw()).not.toContain('alice@example.com');
    expect(response.text).not.toContain('alice@example.com');
  });

  describe('with a cause chain', () => {
    it('drops detail at every level of the chain', async () => {
      const innermost = Object.assign(new Error('inner'), { detail: 'inner-detail-value' });
      const pgError = Object.assign(pgUniqueViolation(), { cause: innermost });
      const { app, logs } = createHarness(
        throwing(
          new AppError({
            kind: 'conflict',
            code: 'EMAIL_TAKEN',
            message: 'Email taken',
            cause: pgError,
          }),
        ),
      );

      const response = await request(app).get('/probe');

      expect(response.status).toBe(409);
      expect(logs.records()[0]).toMatchObject({
        errorDetails: {
          name: 'AppError',
          cause: {
            code: '23505',
            constraint: 'users_email_key',
            table: 'users',
            cause: { message: 'inner' },
          },
        },
      });
      expect(logs.raw()).not.toContain('"detail"');
      expect(logs.raw()).not.toContain('alice@example.com');
      expect(logs.raw()).not.toContain('inner-detail-value');
    });

    it('stops following a cause that references itself', async () => {
      const looping = new Error('loop');
      looping.cause = looping;
      const { app, logs } = createHarness(throwing(looping));

      const response = await request(app).get('/probe');

      expect(response.status).toBe(500);
      expect(logs.records()).toHaveLength(1);
      expect(logs.records()[0]).toMatchObject({
        errorDetails: {
          message: 'loop',
          cause: { message: 'loop', cause: { message: 'loop', cause: { message: 'loop' } } },
        },
      });
      expect(logs.records()[0]).not.toHaveProperty('errorDetails.cause.cause.cause.cause');
    });
  });

  it.each(['code', 'cause'])(
    'still answers with a 500 JSON envelope when the error has a throwing %s getter',
    async (property) => {
      const hostile = Object.defineProperty(new Error('hostile'), property, {
        get() {
          throw new Error(`${property} getter failed`);
        },
      });
      const { app, logs } = createHarness(throwing(hostile));

      const response = await request(app).get('/probe');

      expect(response.status).toBe(500);
      expect(response.headers['content-type']).toMatch(/^application\/json\b/u);
      expect(response.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId: REQUEST_ID },
      });
      expect(logs.records()).toHaveLength(1);
      expect(logs.records()[0]?.errorDetails).toEqual({ loggingFailed: true });
    },
  );

  describe('when handling the error itself throws (a throwing type getter)', () => {
    const errorWithThrowingType = () =>
      Object.defineProperty(new Error('hostile'), 'type', {
        get() {
          throw new Error('type getter failed');
        },
      });

    it('answers with a 500 JSON envelope carrying the request ID and logs one error line', async () => {
      const { app, logs } = createHarness(throwing(errorWithThrowingType()));

      const response = await request(app).get('/probe');

      expect(response.status).toBe(500);
      expect(response.headers['content-type']).toMatch(/^application\/json\b/u);
      expect(response.headers['x-request-id']).toBe(REQUEST_ID);
      expect(response.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId: REQUEST_ID },
      });
      expect(logs.records()).toHaveLength(1);
      expect(logs.records()[0]).toMatchObject({
        severity: 'ERROR',
        event: 'error_middleware_failed',
        requestId: REQUEST_ID,
      });
    });

    it('answers with a null requestId and logs through the root logger without a request context', async () => {
      const { app, logs } = createHarness(throwing(errorWithThrowingType()), {
        withRequestId: false,
      });

      const response = await request(app).get('/probe');

      expect(response.status).toBe(500);
      expect(response.headers['content-type']).toMatch(/^application\/json\b/u);
      expect(response.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId: null },
      });
      expect(logs.records()).toHaveLength(1);
      expect(logs.records()[0]).toMatchObject({
        severity: 'ERROR',
        event: 'error_middleware_failed',
      });
      expect(logs.records()[0]).not.toHaveProperty('requestId');
    });
  });

  describe('log field caps', () => {
    it('truncates a 10,000-character message to 1,000 characters plus an ellipsis', async () => {
      const { app, logs } = createHarness(throwing(new Error('m'.repeat(10_000))));

      await request(app).get('/probe');

      expect(logs.records()[0]).toHaveProperty('errorDetails.message', `${'m'.repeat(1_000)}…`);
    });

    it('omits a code that is not a string or number', async () => {
      const { app, logs } = createHarness(
        throwing(Object.assign(new Error('boom'), { code: { nested: 'nested-secret-value' } })),
      );

      await request(app).get('/probe');

      expect(logs.records()).toHaveLength(1);
      expect(logs.records()[0]).not.toHaveProperty('errorDetails.code');
      expect(logs.raw()).not.toContain('nested-secret-value');
    });

    it('truncates a 1,000-character table to 200 characters plus an ellipsis', async () => {
      const { app, logs } = createHarness(
        throwing(Object.assign(new Error('boom'), { table: 't'.repeat(1_000) })),
      );

      await request(app).get('/probe');

      expect(logs.records()[0]).toHaveProperty('errorDetails.table', `${'t'.repeat(200)}…`);
    });
  });

  it('treats a thrown string as unknown and logs only its type', async () => {
    const { app, logs } = createHarness(throwing('secret-value'));

    const response = await request(app).get('/probe');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId: REQUEST_ID },
    });
    expect(logs.records()).toHaveLength(1);
    expect(logs.records()[0]).toMatchObject({ event: 'request_failed_unexpectedly' });
    expect(logs.records()[0]?.errorDetails).toEqual({ thrownType: 'string' });
    expect(logs.raw()).not.toContain('secret-value');
    expect(response.text).not.toContain('secret-value');
  });

  it('logs and delegates to next when the response has already started', async () => {
    const logs = captureLogs();
    const original = new Error('failed mid-stream');
    const delegated: unknown[] = [];
    const app = express();
    app.use(createRequestIdMiddleware(logs.logger, () => REQUEST_ID));
    app.get('/probe', (_req, res, next) => {
      res.status(200).setHeader('content-type', 'text/plain');
      res.write('partial');
      next(original);
    });
    app.use(createErrorMiddleware(logs.logger));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const recordDelegated: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
      delegated.push(error);
      res.end();
    };
    app.use(recordDelegated);

    const response = await request(app).get('/probe');

    expect(response.status).toBe(200);
    expect(response.text).toBe('partial');
    expect(delegated).toEqual([original]);
    expect(logs.records()).toHaveLength(1);
    expect(logs.records()[0]).toMatchObject({
      severity: 'ERROR',
      event: 'error_after_response_started',
      errorDetails: { message: 'failed mid-stream' },
    });
  });

  it('falls back to the root logger and a null requestId without a request context', async () => {
    const { app, logs } = createHarness(
      throwing(new AppError({ kind: 'conflict', code: 'TAKEN', message: 'Taken' })),
      { withRequestId: false },
    );

    const response = await request(app).get('/probe');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: { code: 'TAKEN', message: 'Taken', requestId: null },
    });
    expect(logs.records()).toHaveLength(1);
    expect(logs.records()[0]).toMatchObject({
      event: 'request_failed',
      code: 'TAKEN',
      status: 409,
    });
    expect(logs.records()[0]).not.toHaveProperty('requestId');
  });
});
