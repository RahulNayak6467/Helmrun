export type ErrorKind =
  | 'invalid_input'
  | 'unauthenticated'
  | 'quota_exceeded'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'rate_limited'
  | 'internal'
  | 'unavailable';

export interface AppErrorOptions {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}

export const RETRYABLE_BY_KIND = {
  invalid_input: false,
  unauthenticated: false,
  quota_exceeded: false,
  not_found: false,
  conflict: false,
  payload_too_large: false,
  rate_limited: true,
  internal: false,
  unavailable: true,
} as const satisfies Record<ErrorKind, boolean>;

export class AppError extends Error {
  readonly code: string;
  readonly kind: ErrorKind;

  constructor({ kind, code, message, cause }: AppErrorOptions) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
    this.kind = kind;
    this.name = 'AppError';
  }

  get retryable(): boolean {
    return RETRYABLE_BY_KIND[this.kind];
  }
}
