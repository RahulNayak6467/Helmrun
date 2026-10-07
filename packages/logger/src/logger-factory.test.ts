import { beforeEach, describe, expect, it, vi } from 'vitest';

const pinoTestDoubles = vi.hoisted(() => ({
  fakeLogger: { kind: 'fake-pino-logger' },
  isoTime: vi.fn(),
  pinoFactory: vi.fn<(options: unknown) => unknown>(),
}));

vi.mock('pino', () => ({
  default: Object.assign(pinoTestDoubles.pinoFactory, {
    stdTimeFunctions: { isoTime: pinoTestDoubles.isoTime },
  }),
}));

import { serializeError } from './error-serializer.js';
import { createLogger, type LoggerOptions } from './logger.js';
import { REDACTION_CENSOR } from './redaction.js';

const baseOptions: LoggerOptions = {
  level: 'info',
  pretty: false,
  service: 'example-service',
  environment: 'test',
};

const getPinoOptions = (): Record<string, unknown> => {
  const options: unknown = pinoTestDoubles.pinoFactory.mock.calls[0]?.[0];

  if (typeof options !== 'object' || options === null) {
    throw new Error('Expected the Pino factory to be called with options');
  }

  return options as Record<string, unknown>;
};

describe('createLogger wiring', () => {
  beforeEach(() => {
    pinoTestDoubles.pinoFactory.mockReset();
    pinoTestDoubles.pinoFactory.mockReturnValue(pinoTestDoubles.fakeLogger);
  });

  it('returns the logger created by Pino', () => {
    expect(createLogger(baseOptions)).toBe(pinoTestDoubles.fakeLogger);
    expect(pinoTestDoubles.pinoFactory).toHaveBeenCalledOnce();
  });

  it('configures no transport when pretty output is off', () => {
    createLogger(baseOptions);

    expect(getPinoOptions()).not.toHaveProperty('transport');
  });

  it('configures pino-pretty only when pretty output is on', () => {
    createLogger({ ...baseOptions, level: 'debug', pretty: true });

    expect(getPinoOptions()).toMatchObject({
      level: 'debug',
      transport: { target: 'pino-pretty' },
    });
  });

  it('keeps the standard level field in pretty mode so lines are labelled and coloured', () => {
    createLogger({ ...baseOptions, pretty: true });

    expect(getPinoOptions()).not.toHaveProperty('formatters');
  });

  it('writes an uppercase severity label in structured mode', () => {
    createLogger(baseOptions);
    const formatters = getPinoOptions().formatters as {
      level: (label: string) => Record<string, unknown>;
    };

    expect(formatters.level('error')).toEqual({ severity: 'ERROR' });
  });

  it('passes service metadata, serializers, timestamps and redaction to Pino', () => {
    createLogger({ ...baseOptions, level: 'warn', extraRedactPaths: ['prompt'] });
    const options = getPinoOptions();

    expect(options).toMatchObject({
      level: 'warn',
      base: { service: 'example-service', env: 'test' },
      serializers: { err: serializeError, error: serializeError },
      timestamp: pinoTestDoubles.isoTime,
      messageKey: 'msg',
      redact: { censor: REDACTION_CENSOR },
    });

    const redact = options.redact as { paths: string[] };
    expect(redact.paths).toEqual(
      expect.arrayContaining(['password', 'req.headers.authorization', 'prompt']),
    );
  });
});
