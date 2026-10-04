import type { Clock } from '@helmrun/shared';
import type { RequestHandler } from 'express';

import { requireRequestContext } from './request-id.middleware.js';

type RequestLogLevel = 'info' | 'warn' | 'error';

// 5xx is our fault (error), 4xx is the client's (warn), everything else is info.
// No status at all means the client went away before a response was sent.
export const requestLogLevel = (statusCode: number | null): RequestLogLevel => {
  if (statusCode === null) return 'warn';
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
};

// One record per request, written when the response ends. `finish` means the
// response was fully handed to the OS; `close` without `finish` means the
// connection dropped first (an aborted request).
export const createRequestLoggerMiddleware = (clock: Clock): RequestHandler => {
  return (request, response, next) => {
    // Monotonic: a wall-clock adjustment can't distort the duration.
    const startTime = clock.monotonicMs();
    const { logger } = requireRequestContext(request);
    // Captured now, from the URL as it arrived: routers mounted with
    // app.use('/v1', router) rewrite request.path while they handle the
    // request. The query string is dropped because it can carry tokens.
    const path = request.originalUrl.split('?', 1)[0] ?? request.originalUrl;
    let logged = false;

    const log = (aborted: boolean, statusCode: number | null): void => {
      if (logged) return;
      logged = true;

      const durationMs = Math.max(0, clock.monotonicMs() - startTime);
      const level = aborted ? 'warn' : requestLogLevel(statusCode);

      logger[level](
        {
          event: 'http_request_completed',
          method: request.method,
          path,
          statusCode,
          durationMs,
          outcome: aborted ? 'aborted' : 'completed',
        },
        aborted ? 'HTTP request aborted' : 'HTTP request completed',
      );
    };

    response.once('finish', () => {
      log(false, response.statusCode);
    });

    response.once('close', () => {
      const aborted = !response.writableFinished;
      log(aborted, aborted && !response.headersSent ? null : response.statusCode);
    });

    next();
  };
};
