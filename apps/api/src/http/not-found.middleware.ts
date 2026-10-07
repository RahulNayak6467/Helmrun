import { AppError } from '@helmrun/shared';
import type { RequestHandler } from 'express';

export const notFoundMiddleware: RequestHandler = (_req, _res, next) => {
  next(
    new AppError({
      kind: 'not_found',
      code: 'ROUTE_NOT_FOUND',
      message: 'Route not found',
    }),
  );
};
