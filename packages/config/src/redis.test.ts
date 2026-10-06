import { describe, expect, it } from 'vitest';

import { redisEnvSchema, redisUrlSchema } from './redis.js';

const validRedisUrl = 'redis://127.0.0.1:6379';

type NumericRedisField = 'REDIS_COMMAND_TIMEOUT_MS' | 'REDIS_CONNECT_TIMEOUT_MS';

interface NumericContract {
  readonly field: NumericRedisField;
  readonly defaultValue: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly belowMinimumMessage: string;
  readonly aboveMaximumMessage: string;
}

const numericContracts: readonly NumericContract[] = [
  {
    field: 'REDIS_COMMAND_TIMEOUT_MS',
    defaultValue: 100,
    minimum: 10,
    maximum: 5_000,
    belowMinimumMessage: 'REDIS_COMMAND_TIMEOUT_MS must be at least 10 milliseconds',
    aboveMaximumMessage: 'REDIS_COMMAND_TIMEOUT_MS must not exceed 5,000 milliseconds',
  },
  {
    field: 'REDIS_CONNECT_TIMEOUT_MS',
    defaultValue: 2_000,
    minimum: 100,
    maximum: 30_000,
    belowMinimumMessage: 'REDIS_CONNECT_TIMEOUT_MS must be at least 100 milliseconds',
    aboveMaximumMessage: 'REDIS_CONNECT_TIMEOUT_MS must not exceed 30,000 milliseconds',
  },
];

const nonDigitInputs = ['1e3', '0x64', ' 100 ', '10.5', '-5', ''] as const;

function expectSingleIssue(input: Record<string, unknown>, field: string, message: string): void {
  const result = redisEnvSchema.safeParse(input);

  expect(result.success).toBe(false);

  if (result.success) {
    throw new Error(`Expected Redis configuration to fail at ${field}`);
  }

  expect(result.error.issues).toHaveLength(1);
  expect(result.error.issues[0]).toEqual(expect.objectContaining({ path: [field], message }));
}

describe('redisUrlSchema', () => {
  it.each([
    'redis://localhost',
    'redis://localhost:6379',
    'redis://:local-password@localhost',
    'redis://default:local-password@127.0.0.1:6379',
    'rediss://cache.example.amazonaws.com',
    'rediss://cache.example.amazonaws.com:6379',
    'rediss://:tls-password@cache.example.amazonaws.com',
    'rediss://default:tls-password@cache.example.amazonaws.com:6379',
  ])('accepts the supported Redis URL %s', (redisUrl) => {
    expect(redisUrlSchema.parse(redisUrl)).toBe(redisUrl);
  });

  it('rejects a missing value with a single readable issue', () => {
    const result = redisUrlSchema.safeParse(undefined);

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected a missing Redis URL to fail');
    }

    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.message).toBe('REDIS_URL is required');
  });

  it('rejects an empty value with a single readable issue', () => {
    const result = redisUrlSchema.safeParse('');

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected an empty Redis URL to fail');
    }

    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.message).toBe('REDIS_URL is required');
  });

  it('rejects an unparseable value with a single readable issue', () => {
    const result = redisUrlSchema.safeParse('not a url');

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected an unparseable Redis URL to fail');
    }

    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.message).toBe('REDIS_URL must be a valid redis connection URL');
  });

  it.each(['http://localhost:6379', 'postgres://app:password@localhost:5432/app'])(
    'rejects unsupported protocol in %s',
    (value) => {
      const result = redisUrlSchema.safeParse(value);

      expect(result.success).toBe(false);

      if (result.success) {
        throw new Error('Expected a non-Redis protocol to fail');
      }

      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.message).toBe(
        'REDIS_URL must use the redis: or rediss: protocol',
      );
    },
  );

  it.each(['redis://', 'rediss://'])('rejects a URL without a hostname: %j', (value) => {
    const result = redisUrlSchema.safeParse(value);

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected a Redis URL without a hostname to fail');
    }

    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.message).toBe('REDIS_URL must include a hostname');
  });

  it.each(['redis://127.0.0.1:6379', 'redis://127.0.0.1:6379/', 'rediss://cache.example:6380/0'])(
    'accepts a URL that uses database 0: %j',
    (value) => {
      expect(redisUrlSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each([
    'redis://127.0.0.1:6379/2',
    'redis://127.0.0.1:6379/abc',
    'redis://127.0.0.1:6379/99',
    'redis://127.0.0.1:6379/00',
    'redis://127.0.0.1:6379/0/extra',
  ])('rejects a URL that selects another database: %j', (value) => {
    const result = redisUrlSchema.safeParse(value);

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected a Redis URL selecting another database to fail');
    }

    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.message).toBe(
      'REDIS_URL must not select a database other than 0',
    );
  });

  it.each([
    'redis://127.0.0.1:6379?db=5',
    'redis://127.0.0.1:6379/?db=5',
    'redis://127.0.0.1:6379/0?db=5',
    'redis://127.0.0.1:6379/?enableOfflineQueue=true',
    'redis://127.0.0.1:6379/?commandTimeout=0&maxRetriesPerRequest=50',
    'rediss://:pw@cache.example:6380/0#fragment',
  ])('rejects a URL with query parameters or a fragment: %j', (value) => {
    const result = redisUrlSchema.safeParse(value);

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected a Redis URL with query parameters or a fragment to fail');
    }

    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.message).toBe(
      'REDIS_URL must not include query parameters or a fragment',
    );
  });

  it.each([
    'http://default:redis-password-that-must-not-leak@localhost:6379',
    'redis://default:redis-password-that-must-not-leak@',
    'not a url redis-password-that-must-not-leak',
  ])('does not include the supplied URL or password in validation issues: %j', (suppliedUrl) => {
    const secretSentinel = 'redis-password-that-must-not-leak';
    const result = redisUrlSchema.safeParse(suppliedUrl);

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected an invalid Redis URL to fail');
    }

    const serializedIssues = JSON.stringify(result.error.issues);

    expect(serializedIssues).not.toContain(suppliedUrl);
    expect(serializedIssues).not.toContain(secretSentinel);
  });
});

describe('redisEnvSchema', () => {
  it('returns every documented default when only REDIS_URL is supplied', () => {
    expect(redisEnvSchema.parse({ REDIS_URL: validRedisUrl })).toEqual({
      REDIS_URL: validRedisUrl,
      REDIS_COMMAND_TIMEOUT_MS: 100,
      REDIS_CONNECT_TIMEOUT_MS: 2_000,
    });
  });

  it('converts a full valid environment into numbers', () => {
    const redisUrl = 'rediss://default:tls-password@cache.example.amazonaws.com:6379';

    expect(
      redisEnvSchema.parse({
        REDIS_URL: redisUrl,
        REDIS_COMMAND_TIMEOUT_MS: '250',
        REDIS_CONNECT_TIMEOUT_MS: '5000',
      }),
    ).toEqual({
      REDIS_URL: redisUrl,
      REDIS_COMMAND_TIMEOUT_MS: 250,
      REDIS_CONNECT_TIMEOUT_MS: 5_000,
    });
  });

  it('reports a missing REDIS_URL at its field', () => {
    expectSingleIssue({}, 'REDIS_URL', 'REDIS_URL is required');
  });

  it.each(numericContracts)(
    'uses $defaultValue as the default for $field',
    ({ field, defaultValue }) => {
      expect(redisEnvSchema.parse({ REDIS_URL: validRedisUrl })[field]).toBe(defaultValue);
    },
  );

  it.each(numericContracts)('accepts both boundaries for $field', ({ field, minimum, maximum }) => {
    expect(
      redisEnvSchema.parse({ REDIS_URL: validRedisUrl, [field]: String(minimum) })[field],
    ).toBe(minimum);
    expect(
      redisEnvSchema.parse({ REDIS_URL: validRedisUrl, [field]: String(maximum) })[field],
    ).toBe(maximum);
  });

  it.each(numericContracts)(
    'rejects a value below the minimum for $field',
    ({ field, minimum, belowMinimumMessage }) => {
      expectSingleIssue(
        { REDIS_URL: validRedisUrl, [field]: String(minimum - 1) },
        field,
        belowMinimumMessage,
      );
    },
  );

  it.each(numericContracts)(
    'rejects a value above the maximum for $field',
    ({ field, maximum, aboveMaximumMessage }) => {
      expectSingleIssue(
        { REDIS_URL: validRedisUrl, [field]: String(maximum + 1) },
        field,
        aboveMaximumMessage,
      );
    },
  );

  describe.each(numericContracts)('$field', ({ field }) => {
    it.each(nonDigitInputs)('rejects the non-digit value %j as not a whole number', (value) => {
      expectSingleIssue(
        { REDIS_URL: validRedisUrl, [field]: value },
        field,
        `${field} must be a whole number of milliseconds`,
      );
    });
  });
});
