import { describe, expect, it } from 'vitest';

import { databaseEnvSchema, databaseUrlSchema } from './database.js';

const validDatabaseUrl = 'postgresql://app:local-password@127.0.0.1:5432/app_dev';

type NumericDatabaseField =
  | 'DB_POOL_MAX'
  | 'DB_CONNECTION_TIMEOUT_MS'
  | 'DB_POOL_IDLE_TIMEOUT_MS'
  | 'DB_STATEMENT_TIMEOUT_MS'
  | 'DB_READINESS_TIMEOUT_MS';

interface NumericContract {
  readonly field: NumericDatabaseField;
  readonly defaultValue: number;
  readonly minimum: number;
  readonly maximum: number;
}

const numericContracts: readonly NumericContract[] = [
  { field: 'DB_POOL_MAX', defaultValue: 10, minimum: 1, maximum: 50 },
  { field: 'DB_CONNECTION_TIMEOUT_MS', defaultValue: 5_000, minimum: 100, maximum: 30_000 },
  { field: 'DB_POOL_IDLE_TIMEOUT_MS', defaultValue: 10_000, minimum: 1_000, maximum: 300_000 },
  { field: 'DB_STATEMENT_TIMEOUT_MS', defaultValue: 15_000, minimum: 100, maximum: 120_000 },
  { field: 'DB_READINESS_TIMEOUT_MS', defaultValue: 1_000, minimum: 100, maximum: 5_000 },
];

function expectFailureAt(input: Record<string, unknown>, field: string): void {
  const result = databaseEnvSchema.safeParse(input);

  expect(result.success).toBe(false);

  if (result.success) {
    throw new Error(`Expected database configuration to fail at ${field}`);
  }

  expect(result.error.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: [field] })]),
  );
}

describe('databaseUrlSchema', () => {
  it.each([
    'postgresql://app:password@127.0.0.1:5432/app_dev',
    'postgres://app:password@localhost:5432/app',
    'postgresql://localhost/app',
    'postgresql://app:p%40ssword@database.internal:5432/app?sslmode=require',
  ])('accepts the supported PostgreSQL URL %s', (databaseUrl) => {
    expect(databaseUrlSchema.parse(databaseUrl)).toBe(databaseUrl);
  });

  it('rejects a missing value with a readable message', () => {
    const result = databaseUrlSchema.safeParse(undefined);

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected a missing database URL to fail');
    }

    expect(result.error.issues[0]?.message).toBe('DATABASE_URL is required');
  });

  it('rejects an empty value with a single readable issue', () => {
    const result = databaseUrlSchema.safeParse('');

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected an empty database URL to fail');
    }

    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.message).toBe('DATABASE_URL is required');
  });

  it.each(['not-a-url', 'postgresql://', '://app'])('rejects malformed URL %j', (value) => {
    expect(databaseUrlSchema.safeParse(value).success).toBe(false);
  });

  it.each(['http://app:password@localhost:5432/app', 'mysql://app:password@localhost:3306/app'])(
    'rejects unsupported protocol in %s',
    (value) => {
      const result = databaseUrlSchema.safeParse(value);

      expect(result.success).toBe(false);

      if (result.success) {
        throw new Error('Expected a non-PostgreSQL protocol to fail');
      }

      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'DATABASE_URL must use the postgres:// or postgresql:// protocol',
          }),
        ]),
      );
    },
  );

  it('rejects a URL without a hostname', () => {
    const result = databaseUrlSchema.safeParse('postgresql:///app');

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected a database URL without a hostname to fail');
    }

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'DATABASE_URL must include a hostname' }),
      ]),
    );
  });

  it.each([
    'postgresql://app:password@localhost:5432',
    'postgresql://app:password@localhost:5432/',
  ])('rejects a URL without a database name: %s', (value) => {
    const result = databaseUrlSchema.safeParse(value);

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected a database URL without a database name to fail');
    }

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'DATABASE_URL must include a database name' }),
      ]),
    );
  });

  it('does not include the supplied URL or password in validation issues', () => {
    const secretSentinel = 'database-password-that-must-not-leak';
    const suppliedUrl = `http://app:${secretSentinel}@localhost:5432/app`;
    const result = databaseUrlSchema.safeParse(suppliedUrl);

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected an unsupported database URL to fail');
    }

    const serializedIssues = JSON.stringify(result.error.issues);

    expect(serializedIssues).not.toContain(suppliedUrl);
    expect(serializedIssues).not.toContain(secretSentinel);
  });
});

describe('databaseEnvSchema', () => {
  it('returns every documented default when only DATABASE_URL is supplied', () => {
    expect(databaseEnvSchema.parse({ DATABASE_URL: validDatabaseUrl })).toEqual({
      DATABASE_URL: validDatabaseUrl,
      DB_POOL_MAX: 10,
      DB_CONNECTION_TIMEOUT_MS: 5_000,
      DB_POOL_IDLE_TIMEOUT_MS: 10_000,
      DB_STATEMENT_TIMEOUT_MS: 15_000,
      DB_READINESS_TIMEOUT_MS: 1_000,
    });
  });

  it('converts explicit environment strings into numbers', () => {
    expect(
      databaseEnvSchema.parse({
        DATABASE_URL: validDatabaseUrl,
        DB_POOL_MAX: '20',
        DB_CONNECTION_TIMEOUT_MS: '2000',
        DB_POOL_IDLE_TIMEOUT_MS: '30000',
        DB_STATEMENT_TIMEOUT_MS: '45000',
        DB_READINESS_TIMEOUT_MS: '750',
      }),
    ).toEqual({
      DATABASE_URL: validDatabaseUrl,
      DB_POOL_MAX: 20,
      DB_CONNECTION_TIMEOUT_MS: 2_000,
      DB_POOL_IDLE_TIMEOUT_MS: 30_000,
      DB_STATEMENT_TIMEOUT_MS: 45_000,
      DB_READINESS_TIMEOUT_MS: 750,
    });
  });

  it('ignores unrelated environment variables', () => {
    const result = databaseEnvSchema.parse({
      DATABASE_URL: validDatabaseUrl,
      SHELL: '/bin/zsh',
      UNRELATED_SECRET: 'not-part-of-database-config',
    });

    expect(result).not.toHaveProperty('SHELL');
    expect(result).not.toHaveProperty('UNRELATED_SECRET');
  });

  it.each(numericContracts)('accepts both boundaries for $field', ({ field, minimum, maximum }) => {
    expect(
      databaseEnvSchema.parse({ DATABASE_URL: validDatabaseUrl, [field]: String(minimum) })[field],
    ).toBe(minimum);
    expect(
      databaseEnvSchema.parse({ DATABASE_URL: validDatabaseUrl, [field]: String(maximum) })[field],
    ).toBe(maximum);
  });

  it.each(numericContracts)(
    'uses $defaultValue as the default for $field',
    ({ field, defaultValue }) => {
      expect(databaseEnvSchema.parse({ DATABASE_URL: validDatabaseUrl })[field]).toBe(defaultValue);
    },
  );

  it.each(numericContracts)(
    'rejects a value below the minimum for $field',
    ({ field, minimum }) => {
      expectFailureAt({ DATABASE_URL: validDatabaseUrl, [field]: String(minimum - 1) }, field);
    },
  );

  it.each(numericContracts)(
    'rejects a value above the maximum for $field',
    ({ field, maximum }) => {
      expectFailureAt({ DATABASE_URL: validDatabaseUrl, [field]: String(maximum + 1) }, field);
    },
  );

  it.each(numericContracts)('rejects a decimal value for $field', ({ field, minimum }) => {
    expectFailureAt({ DATABASE_URL: validDatabaseUrl, [field]: String(minimum + 0.5) }, field);
  });

  it.each(numericContracts)('rejects non-numeric and non-finite values for $field', ({ field }) => {
    for (const invalidValue of [
      'not-a-number',
      'NaN',
      'Infinity',
      '-Infinity',
      '0x10',
      '1e3',
      ' 10',
      '',
    ]) {
      expectFailureAt({ DATABASE_URL: validDatabaseUrl, [field]: invalidValue }, field);
    }
  });

  it.each(numericContracts)('uses a readable integer error for a decimal $field', ({ field }) => {
    const result = databaseEnvSchema.safeParse({ DATABASE_URL: validDatabaseUrl, [field]: '1.5' });

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error(`Expected a decimal ${field} to fail`);
    }

    expect(result.error.issues[0]?.message).toContain('whole number');
  });
});
