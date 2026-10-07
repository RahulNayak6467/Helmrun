import type { Logger } from '@helmrun/logger';
import { AppError, type ErrorKind } from '@helmrun/shared';
import { type Request, type Response, type NextFunction } from 'express';
import * as z from 'zod';

const STATUS_BY_KIND = {
  invalid_input: 400,
  unauthenticated: 401,
  quota_exceeded: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
} as const satisfies Record<ErrorKind, number>;

const MAX_ISSUES = 10;
const MAX_ISSUE_TEXT_LENGTH = 200;
const MAX_LOGGED_MESSAGE_LENGTH = 1_000;
const MAX_LOGGED_STACK_LENGTH = 4_000;
const MAX_LOGGED_FIELD_LENGTH = 200;

interface BodyParserErrorDefinition {
  kind: ErrorKind;
  code: string;
  message: string;
}

const BODY_PARSER_ERRORS: Record<string, BodyParserErrorDefinition> = {
  'entity.parse.failed': {
    kind: 'invalid_input',
    code: 'INVALID_JSON',
    message: 'Request body is not valid JSON',
  },
  'entity.too.large': {
    kind: 'payload_too_large',
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Request body is too large',
  },
  'encoding.unsupported': {
    kind: 'invalid_input',
    code: 'UNSUPPORTED_CONTENT_ENCODING',
    message: 'Request Content-Encoding is not supported',
  },
  'charset.unsupported': {
    kind: 'invalid_input',
    code: 'UNSUPPORTED_CHARSET',
    message: 'Request charset is not supported',
  },
  'request.aborted': {
    kind: 'invalid_input',
    code: 'REQUEST_ABORTED',
    message: 'Request was aborted by the client',
  },
  'request.size.invalid': {
    kind: 'invalid_input',
    code: 'INVALID_REQUEST_BODY',
    message: 'Request body size does not match Content-Length',
  },
};

const toBodyParserError = (error: unknown): AppError | undefined => {
  if (typeof error !== 'object' || error === null || !('type' in error)) {
    return undefined;
  }

  const type = error.type;
  if (typeof type !== 'string') {
    return undefined;
  }

  const definition = BODY_PARSER_ERRORS[type];
  if (definition !== undefined) {
    return new AppError(definition);
  }

  const isOtherClientError =
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500 &&
    'expose' in error &&
    error.expose === true;

  if (isOtherClientError) {
    return new AppError({
      kind: 'invalid_input',
      code: 'INVALID_REQUEST_BODY',
      message: 'Request body could not be read',
    });
  }

  return undefined;
};

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string().nullable(),
      issues: z
        .array(z.object({ path: z.string(), message: z.string() }))
        .max(MAX_ISSUES)
        .optional(),
    }),
  })
  .meta({
    id: 'ErrorResponse',
    description: 'Every error response. `issues` is present only for request validation errors.',
  });

type ErrorResponse = z.infer<typeof errorResponseSchema>;
type ValidationIssue = NonNullable<ErrorResponse['error']['issues']>[number];

const truncate = (text: string, maxLength: number): string =>
  text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;

const mapToPublicError = (
  error: unknown,
  requestId: string | null,
  issues?: ValidationIssue[],
): ErrorResponse => {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        requestId: requestId,
        ...(issues === undefined ? {} : { issues }),
      },
    };
  }
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal error',
      requestId: requestId,
    },
  };
};

const toLoggableScalar = (value: unknown): string | number | undefined => {
  if (typeof value === 'string') return truncate(value, MAX_LOGGED_FIELD_LENGTH);
  if (typeof value === 'number') return value;
  return undefined;
};

const toLoggableError = (error: unknown, depth = 0): Record<string, unknown> => {
  if (!(error instanceof Error)) {
    return { thrownType: typeof error };
  }

  const fields: Record<string, unknown> = {
    name: error.name,
    message: truncate(error.message, MAX_LOGGED_MESSAGE_LENGTH),
    stack: error.stack === undefined ? undefined : truncate(error.stack, MAX_LOGGED_STACK_LENGTH),
  };

  if ('code' in error) fields.code = toLoggableScalar(error.code);
  if ('constraint' in error) fields.constraint = toLoggableScalar(error.constraint);
  if ('table' in error) fields.table = toLoggableScalar(error.table);

  if (error.cause !== undefined && depth < 3) {
    fields.cause = toLoggableError(error.cause, depth + 1);
  }

  return fields;
};

const safeLoggableError = (error: unknown): Record<string, unknown> => {
  try {
    return toLoggableError(error);
  } catch {
    return { loggingFailed: true };
  }
};

const logHandledError = (logger: Logger, appError: AppError, status: number): void => {
  const fields = {
    event: 'request_failed',
    code: appError.code,
    kind: appError.kind,
    status,
    errorDetails: safeLoggableError(appError),
  };

  if (status >= 500) {
    logger.error(fields, 'Request failed');
  } else {
    logger.info(fields, 'Request rejected');
  }
};

const handleError = (
  rootLogger: Logger,
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const logger = req.requestContext?.logger ?? rootLogger;

  if (res.headersSent) {
    logger.error(
      { event: 'error_after_response_started', errorDetails: safeLoggableError(error) },
      'Error after the response had started',
    );
    next(error);
    return;
  }

  const requestId = req.requestContext?.requestId ?? null;

  if (error instanceof AppError) {
    const status = STATUS_BY_KIND[error.kind];
    logHandledError(logger, error, status);
    res.status(status).json(mapToPublicError(error, requestId));
    return;
  }

  const bodyParserError = toBodyParserError(error);
  if (bodyParserError !== undefined) {
    const status = STATUS_BY_KIND[bodyParserError.kind];
    logHandledError(logger, bodyParserError, status);
    res.status(status).json(mapToPublicError(bodyParserError, requestId));
    return;
  }

  if (error instanceof z.ZodError) {
    const issues = error.issues.slice(0, MAX_ISSUES).map((issue) => ({
      path: truncate(issue.path.join('.'), MAX_ISSUE_TEXT_LENGTH),
      message: truncate(issue.message, MAX_ISSUE_TEXT_LENGTH),
    }));

    const validationError = new AppError({
      kind: 'invalid_input',
      code: 'INVALID_INPUT',
      message: 'Request validation failed',
    });

    const status = STATUS_BY_KIND.invalid_input;
    logHandledError(logger, validationError, status);
    res.status(status).json(mapToPublicError(validationError, requestId, issues));
    return;
  }

  logger.error(
    { event: 'request_failed_unexpectedly', errorDetails: safeLoggableError(error) },
    'Unexpected error while handling request',
  );

  res.status(STATUS_BY_KIND.internal).json(mapToPublicError(error, requestId));
};

export const createErrorMiddleware =
  (rootLogger: Logger) => (error: unknown, req: Request, res: Response, next: NextFunction) => {
    try {
      handleError(rootLogger, error, req, res, next);
    } catch {
      const requestId = req.requestContext?.requestId ?? null;

      if (!res.headersSent) {
        res.status(STATUS_BY_KIND.internal).json({
          error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId },
        });
      }

      (req.requestContext?.logger ?? rootLogger).error(
        { event: 'error_middleware_failed' },
        'Error middleware failed while handling an error',
      );
    }
  };
