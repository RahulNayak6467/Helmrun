import { EventEmitter } from 'node:events';

import { createLogger } from '@helmrun/logger';
import { systemClock } from '@helmrun/shared';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { createRequestLoggerMiddleware, requestLogLevel } from './request-logger.middleware.js';

// Satisfies Clock structurally; typed as plain properties so the mock can be
// asserted on directly.
const createClock = (
  startTime: number,
  endTime: number,
): { nowMs: () => number; monotonicMs: Mock<() => number> } => ({
  nowMs: () => 0,
  monotonicMs: vi.fn<() => number>().mockReturnValueOnce(startTime).mockReturnValueOnce(endTime),
});

const createHarness = ({
  startTime = 1_000,
  endTime = 1_025,
  method = 'GET',
  statusCode = 200,
  headersSent = true,
  writableFinished = false,
}: {
  startTime?: number;
  endTime?: number;
  method?: string;
  statusCode?: number;
  headersSent?: boolean;
  writableFinished?: boolean;
} = {}) => {
  const loggerMethods = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const req = {
    method,
    originalUrl: '/probe?token=secret-token',
    requestContext: { requestId: 'request-123', clientRequestId: undefined, logger: loggerMethods },
  } as unknown as Request;
  const response = Object.assign(new EventEmitter(), { statusCode, headersSent, writableFinished });
  const clock = createClock(startTime, endTime);
  const next = vi.fn();

  createRequestLoggerMiddleware(clock)(req, response as unknown as Response, next);

  return { loggerMethods, next, clock, response };
};

describe('requestLogLevel', () => {
  it.each([
    [null, 'warn'],
    [101, 'info'],
    [200, 'info'],
    [399, 'info'],
    [400, 'warn'],
    [499, 'warn'],
    [500, 'error'],
    [503, 'error'],
  ] as const)('maps status %s to %s', (status, level) => {
    expect(requestLogLevel(status)).toBe(level);
  });
});

describe('request logger middleware', () => {
  it('calls next immediately and logs exactly once when finish is followed by close', () => {
    const { loggerMethods, next, response } = createHarness();

    expect(next).toHaveBeenCalledOnce();
    expect(loggerMethods.info).not.toHaveBeenCalled();

    response.emit('finish');
    response.writableFinished = true;
    response.emit('close');

    expect(loggerMethods.info).toHaveBeenCalledOnce();
    expect(loggerMethods.info).toHaveBeenCalledWith(
      {
        event: 'http_request_completed',
        method: 'GET',
        path: '/probe',
        statusCode: 200,
        durationMs: 25,
        outcome: 'completed',
      },
      'HTTP request completed',
    );
  });

  it('never logs the query string', () => {
    const { loggerMethods, response } = createHarness();

    response.emit('finish');

    expect(JSON.stringify(loggerMethods.info.mock.calls)).not.toContain('secret-token');
  });

  it.each([
    [399, 'info'],
    [400, 'warn'],
    [500, 'error'],
  ] as const)('logs a completed %i response at %s', (statusCode, level) => {
    const { loggerMethods, response } = createHarness({ statusCode });

    response.emit('finish');

    expect(loggerMethods[level]).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode, outcome: 'completed' }),
      'HTTP request completed',
    );
  });

  it('logs an abort before headers at warn with a null status', () => {
    const { loggerMethods, response } = createHarness({ method: 'POST', headersSent: false });

    response.emit('close');

    expect(loggerMethods.warn).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', statusCode: null, outcome: 'aborted' }),
      'HTTP request aborted',
    );
  });

  it('logs an abort after headers at warn even when the status is 5xx', () => {
    const { loggerMethods, response } = createHarness({ statusCode: 503 });

    response.emit('close');

    expect(loggerMethods.warn).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503, outcome: 'aborted' }),
      'HTTP request aborted',
    );
    expect(loggerMethods.error).not.toHaveBeenCalled();
  });

  it('treats close as completed when the response finished writing', () => {
    const { loggerMethods, response } = createHarness({ statusCode: 204, writableFinished: true });

    response.emit('close');

    expect(loggerMethods.info).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 204, outcome: 'completed' }),
      'HTTP request completed',
    );
  });

  it('measures duration with the monotonic clock and never goes negative', () => {
    const { loggerMethods, response } = createHarness({ startTime: 1_000, endTime: 900 });

    response.emit('finish');

    expect(loggerMethods.info).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: 0 }),
      'HTTP request completed',
    );
  });

  it('keeps the first outcome when close is followed by finish', () => {
    const { loggerMethods, clock, response } = createHarness({ headersSent: false });

    response.emit('close');
    response.emit('finish');

    expect(loggerMethods.warn).toHaveBeenCalledOnce();
    expect(loggerMethods.info).not.toHaveBeenCalled();
    expect(clock.monotonicMs).toHaveBeenCalledTimes(2);
  });

  it('logs the full request path for routes inside a mounted router', async () => {
    const loggerMethods = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const app = express();
    app.use((req, _res, next) => {
      req.requestContext = {
        requestId: 'request-123',
        clientRequestId: undefined,
        logger: loggerMethods as unknown as NonNullable<Request['requestContext']>['logger'],
      };
      next();
    });
    app.use(createRequestLoggerMiddleware(systemClock));
    const router = express.Router();
    router.get('/runs', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.use('/v1', router);

    await request(app).get('/v1/runs?token=secret-token');

    await vi.waitFor(() => {
      expect(loggerMethods.info).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/v1/runs', statusCode: 200 }),
        'HTTP request completed',
      );
    });
  });

  it('writes the request ID once, from the child logger binding', () => {
    const chunks: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    const logger = createLogger({
      level: 'info',
      pretty: false,
      service: 'test',
      environment: 'test',
    }).child({ requestId: 'request-123' });
    const req = {
      method: 'GET',
      originalUrl: '/probe',
      requestContext: { requestId: 'request-123', clientRequestId: undefined, logger },
    } as unknown as Request;
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headersSent: true,
      writableFinished: true,
    });

    try {
      createRequestLoggerMiddleware(createClock(1_000, 1_025))(
        req,
        response as unknown as Response,
        vi.fn(),
      );
      response.emit('finish');
    } finally {
      writeSpy.mockRestore();
    }

    const output = chunks.join('');

    expect(output.match(/"requestId":/gu)).toHaveLength(1);
    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({ requestId: 'request-123', statusCode: 200, durationMs: 25 }),
    );
  });
});
