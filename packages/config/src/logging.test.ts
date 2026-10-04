import { describe, expect, it } from 'vitest';

import { loggerEnvSchema } from './logging.js';

function expectFailureAt(input: Record<string, unknown>, field: string): void {
  const result = loggerEnvSchema.safeParse(input);

  expect(result.success).toBe(false);

  if (result.success) {
    throw new Error(`Expected logging configuration to fail at ${field}`);
  }

  expect(result.error.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: [field] })]),
  );
}

// Field-level checks only. Rules that combine logging with NODE_ENV (no silent
// logging outside tests, no pretty logging in production) belong to each app's
// combined schema and are tested there.
describe('loggerEnvSchema', () => {
  it('defaults to info level with pretty output off', () => {
    expect(loggerEnvSchema.parse({})).toEqual({ LOG_LEVEL: 'info', LOG_PRETTY: false });
  });

  it.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const)(
    'accepts LOG_LEVEL=%s',
    (level) => {
      expect(loggerEnvSchema.parse({ LOG_LEVEL: level }).LOG_LEVEL).toBe(level);
    },
  );

  it.each(['verbose', 'INFO', 'off', ''])('rejects unsupported LOG_LEVEL=%j', (level) => {
    expectFailureAt({ LOG_LEVEL: level }, 'LOG_LEVEL');
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('converts LOG_PRETTY=%s to %s', (input, expected) => {
    expect(loggerEnvSchema.parse({ LOG_PRETTY: input }).LOG_PRETTY).toBe(expected);
  });

  it.each(['yes', 'no', '1', '0', 'on', 'off', 'TRUE', 'FALSE', ''])(
    'rejects non-contract LOG_PRETTY=%j',
    (value) => {
      expectFailureAt({ LOG_PRETTY: value }, 'LOG_PRETTY');
    },
  );
});
