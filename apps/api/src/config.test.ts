import * as z from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { apiEnvSchema, loadConfig, parseConfig } from './config.js';

type EnvironmentInput = Record<string, unknown>;

const validDatabaseUrl = 'postgresql://helmrun_test:password@127.0.0.1:5441/helmrun_test';

// The two variables without defaults. Everything else falls back to defaults.
const requiredInput = { NODE_ENV: 'development', DATABASE_URL: validDatabaseUrl } as const;

const expectedDefaults = {
  environment: 'development',
  server: {
    port: 8010,
    requestTimeoutMs: 30_000,
    headersTimeoutMs: 20_000,
    keepAliveTimeoutMs: 5_000,
    shutdownTimeoutMs: 10_000,
  },
  logging: { level: 'info', pretty: false },
  database: {
    url: validDatabaseUrl,
    poolMax: 10,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
    statementTimeoutMs: 15_000,
    readinessTimeoutMs: 1_000,
  },
} as const;

const explicitEnvironment = {
  DATABASE_URL: validDatabaseUrl,
  NODE_ENV: 'test',
  PORT: '8080',
  HTTP_REQUEST_TIMEOUT_MS: '90000',
  HTTP_HEADERS_TIMEOUT_MS: '45000',
  HTTP_KEEP_ALIVE_TIMEOUT_MS: '7000',
  SHUTDOWN_TIMEOUT_MS: '15000',
  LOG_LEVEL: 'debug',
  LOG_PRETTY: 'true',
  DB_POOL_MAX: '20',
  DB_CONNECTION_TIMEOUT_MS: '2000',
  DB_POOL_IDLE_TIMEOUT_MS: '30000',
  DB_STATEMENT_TIMEOUT_MS: '45000',
  DB_READINESS_TIMEOUT_MS: '750',
} as const;

const expectedExplicitConfig = {
  environment: 'test',
  server: {
    port: 8080,
    requestTimeoutMs: 90_000,
    headersTimeoutMs: 45_000,
    keepAliveTimeoutMs: 7_000,
    shutdownTimeoutMs: 15_000,
  },
  logging: { level: 'debug', pretty: true },
  database: {
    url: validDatabaseUrl,
    poolMax: 20,
    connectionTimeoutMs: 2_000,
    idleTimeoutMs: 30_000,
    statementTimeoutMs: 45_000,
    readinessTimeoutMs: 750,
  },
} as const;

const safeParse = (input: EnvironmentInput = {}) =>
  apiEnvSchema.safeParse({ ...requiredInput, ...input });

function expectFailureAt(input: EnvironmentInput, field: string, message?: string): void {
  const result = safeParse(input);

  expect(result.success).toBe(false);

  if (result.success) {
    throw new Error(`Expected validation to fail at ${field}`);
  }

  expect(result.error.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining(
        message === undefined ? { path: [field] } : { path: [field], message },
      ),
    ]),
  );
}

describe('API configuration', () => {
  describe('combined schema', () => {
    it('returns the complete default config when only the required variables are supplied', () => {
      expect(parseConfig(requiredInput)).toEqual(expectedDefaults);
    });

    it('converts explicit environment strings into the nested config', () => {
      expect(parseConfig(explicitEnvironment)).toEqual(expectedExplicitConfig);
    });

    it.each([
      ['NODE_ENV', 'NODE_ENV is required'],
      ['DATABASE_URL', 'DATABASE_URL is required'],
    ])('requires %s', (field, message) => {
      const result = apiEnvSchema.safeParse({});

      expect(result.success).toBe(false);

      if (result.success) {
        throw new Error(`Expected a missing ${field} to fail`);
      }

      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: [field], message })]),
      );
    });

    it('fails closed when NODE_ENV is missing, even if every other value is valid', () => {
      expect(apiEnvSchema.safeParse({ DATABASE_URL: validDatabaseUrl }).success).toBe(false);
    });

    it('ignores unrelated operating-system environment variables', () => {
      const result = parseConfig({
        ...requiredInput,
        SHELL: '/bin/zsh',
        USER: 'helmrun-developer',
      });

      expect(result).toEqual(expectedDefaults);
    });

    it('does not mutate the injected environment object', () => {
      const input = Object.freeze({ ...requiredInput, PORT: '8080' });

      parseConfig(input);

      expect(input).toEqual({ ...requiredInput, PORT: '8080' });
    });
  });

  describe('server settings', () => {
    it.each([
      ['1', 1],
      ['3000', 3000],
      ['65535', 65_535],
    ])('accepts PORT=%s and returns %i', (input, expected) => {
      expect(parseConfig({ ...requiredInput, PORT: input }).server.port).toBe(expected);
    });

    it.each([
      '0',
      '-1',
      '65536',
      '1.5',
      '',
      '   ',
      ' 8080',
      '3000abc',
      'not-a-number',
      '0x1F90',
      '1e3',
    ])('rejects invalid PORT=%j', (port) => {
      expectFailureAt({ PORT: port }, 'PORT');
    });

    const timeoutContracts = [
      { field: 'HTTP_REQUEST_TIMEOUT_MS', minimum: 1_000, maximum: 300_000 },
      { field: 'HTTP_HEADERS_TIMEOUT_MS', minimum: 1_000, maximum: 120_000 },
      { field: 'HTTP_KEEP_ALIVE_TIMEOUT_MS', minimum: 1_000, maximum: 120_000 },
      { field: 'SHUTDOWN_TIMEOUT_MS', minimum: 1_000, maximum: 120_000 },
    ] as const;

    // Each timeout set to its own minimum: valid on its own and keeps the
    // header ≤ request rule satisfied, so only the field under test can fail.
    const minimumTimeouts = Object.fromEntries(
      timeoutContracts.map(({ field, minimum }) => [field, String(minimum)]),
    );

    it.each(timeoutContracts)(
      'accepts both boundaries for $field',
      ({ field, minimum, maximum }) => {
        // The header timeout can't exceed the request timeout, so pin the request
        // timeout at its maximum while testing the others.
        const others = { ...minimumTimeouts, HTTP_REQUEST_TIMEOUT_MS: '300000' };

        expect(safeParse({ ...others, [field]: String(minimum) }).success).toBe(true);
        expect(safeParse({ ...others, [field]: String(maximum) }).success).toBe(true);
      },
    );

    it.each(timeoutContracts)(
      'rejects a value below the minimum for $field',
      ({ field, minimum }) => {
        expectFailureAt({ ...minimumTimeouts, [field]: String(minimum - 1) }, field);
      },
    );

    it.each(timeoutContracts)(
      'rejects a value above the maximum for $field',
      ({ field, maximum }) => {
        expectFailureAt(
          { ...minimumTimeouts, HTTP_REQUEST_TIMEOUT_MS: '300000', [field]: String(maximum + 1) },
          field,
        );
      },
    );

    it('rejects a timeout beyond the Node timer limit instead of letting it fire after 1 ms', () => {
      expectFailureAt({ SHUTDOWN_TIMEOUT_MS: '1000000000000' }, 'SHUTDOWN_TIMEOUT_MS');
    });

    it.each(timeoutContracts)(
      'rejects zero, negative, decimal, and non-numeric values for $field',
      ({ field }) => {
        for (const invalidValue of ['0', '-1', '1.5', 'not-a-number', '1e4']) {
          expectFailureAt({ ...minimumTimeouts, [field]: invalidValue }, field);
        }
      },
    );
  });

  // These rules span fields from different pieces, so they run after the
  // pieces are combined. If one of them stops firing, the combine-then-refine
  // structure in config.ts has been broken.
  describe('cross-field rules', () => {
    it.each([
      ['lower than', '59999', true],
      ['equal to', '60000', true],
      ['greater than', '60001', false],
    ])('header timeout %s request timeout → valid=%s', (_label, headers, valid) => {
      const result = safeParse({
        HTTP_REQUEST_TIMEOUT_MS: '60000',
        HTTP_HEADERS_TIMEOUT_MS: headers,
      });

      expect(result.success).toBe(valid);
    });

    it('reports the header timeout rule on HTTP_HEADERS_TIMEOUT_MS', () => {
      expectFailureAt(
        { HTTP_REQUEST_TIMEOUT_MS: '60000', HTTP_HEADERS_TIMEOUT_MS: '60001' },
        'HTTP_HEADERS_TIMEOUT_MS',
        'Header timeout must not exceed request timeout',
      );
    });

    it.each([
      ['lower than', '999', true],
      ['equal to', '1000', true],
      ['greater than', '1001', false],
    ])('readiness timeout %s statement timeout → valid=%s', (_label, readiness, valid) => {
      const result = safeParse({
        DB_STATEMENT_TIMEOUT_MS: '1000',
        DB_READINESS_TIMEOUT_MS: readiness,
      });

      expect(result.success).toBe(valid);
    });

    it('reports the readiness rule on DB_READINESS_TIMEOUT_MS', () => {
      expectFailureAt(
        { DB_STATEMENT_TIMEOUT_MS: '1000', DB_READINESS_TIMEOUT_MS: '1001' },
        'DB_READINESS_TIMEOUT_MS',
        'Database readiness timeout must not exceed statement timeout',
      );
    });

    it('allows silent logging during tests', () => {
      expect(safeParse({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }).success).toBe(true);
    });

    it.each(['development', 'production'] as const)('rejects silent logging in %s', (env) => {
      expectFailureAt(
        { NODE_ENV: env, LOG_LEVEL: 'silent' },
        'LOG_LEVEL',
        'Silent logging is allowed only during tests',
      );
    });

    it.each(['development', 'test'] as const)('allows pretty logging in %s', (env) => {
      expect(safeParse({ NODE_ENV: env, LOG_PRETTY: 'true' }).success).toBe(true);
    });

    it('rejects pretty logging in production', () => {
      expectFailureAt(
        { NODE_ENV: 'production', LOG_PRETTY: 'true' },
        'LOG_PRETTY',
        'Pretty logging is not allowed in production',
      );
    });
  });

  describe('parseConfig', () => {
    it('throws a ZodError for invalid injected input', () => {
      expect(() => parseConfig({ ...requiredInput, PORT: '70000' })).toThrow(z.ZodError);
    });

    it('parses independent inputs without caching an earlier result', () => {
      const first = parseConfig({ ...requiredInput, PORT: '3001' });
      const second = parseConfig({ ...requiredInput, PORT: '3002' });

      expect(first.server.port).toBe(3001);
      expect(second.server.port).toBe(3002);
    });

    it('uses the injected input instead of reading process.env', () => {
      vi.stubEnv('PORT', '65535');
      vi.stubEnv('LOG_LEVEL', 'fatal');

      const result = parseConfig(requiredInput);

      expect(result.server.port).toBe(8010);
      expect(result.logging.level).toBe('info');
    });

    it('freezes the complete config object graph', () => {
      const result = parseConfig(requiredInput);

      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.server)).toBe(true);
      expect(Object.isFrozen(result.logging)).toBe(true);
      expect(Object.isFrozen(result.database)).toBe(true);
    });
  });

  describe('loadConfig', () => {
    it('reads process.env when called', () => {
      for (const [key, value] of Object.entries(explicitEnvironment)) {
        vi.stubEnv(key, value);
      }

      expect(loadConfig()).toEqual(expectedExplicitConfig);
    });

    it('propagates a ZodError for invalid process.env input', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('DATABASE_URL', validDatabaseUrl);
      vi.stubEnv('PORT', '70000');

      expect(() => loadConfig()).toThrow(z.ZodError);
    });
  });
});
