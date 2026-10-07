import { describe, expect, it } from 'vitest';

import { parseConfig, workerConfigSchema } from './config.js';

const fieldsThatFail = (env: Record<string, string>): string[] => {
  const result = workerConfigSchema.safeParse(env);

  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('worker configuration', () => {
  it('fills defaults when only NODE_ENV is set', () => {
    expect(parseConfig({ NODE_ENV: 'development' })).toEqual({
      environment: 'development',
      shutdownTimeoutMs: 10_000,
      logging: { level: 'info', pretty: false },
    });
  });

  it('requires NODE_ENV', () => {
    expect(fieldsThatFail({})).toEqual(['NODE_ENV']);
  });

  it.each([
    ['1000', 1_000],
    ['120000', 120_000],
  ])('accepts SHUTDOWN_TIMEOUT_MS=%s', (value, expected) => {
    expect(parseConfig({ NODE_ENV: 'test', SHUTDOWN_TIMEOUT_MS: value }).shutdownTimeoutMs).toBe(
      expected,
    );
  });

  it.each(['999', '120001', '10s', '1e4', ' 5000', '-1000', ''])(
    'rejects SHUTDOWN_TIMEOUT_MS=%j',
    (value) => {
      expect(fieldsThatFail({ NODE_ENV: 'test', SHUTDOWN_TIMEOUT_MS: value })).toEqual([
        'SHUTDOWN_TIMEOUT_MS',
      ]);
    },
  );

  it('applies the shared logger rules (no pretty logging in production)', () => {
    expect(fieldsThatFail({ NODE_ENV: 'production', LOG_PRETTY: 'true' })).toEqual(['LOG_PRETTY']);
  });

  it('returns a frozen config, including the nested logging section', () => {
    const config = parseConfig({ NODE_ENV: 'test' });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.logging)).toBe(true);
  });
});
