import { describe, expect, it } from 'vitest';

import { environmentEnvSchema } from './environment.js';

describe('environmentEnvSchema', () => {
  it('requires NODE_ENV instead of defaulting to a less strict environment', () => {
    const result = environmentEnvSchema.safeParse({});

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected a missing NODE_ENV to fail');
    }

    expect(result.error.issues).toEqual([
      expect.objectContaining({ path: ['NODE_ENV'], message: 'NODE_ENV is required' }),
    ]);
  });

  it.each(['development', 'test', 'production'] as const)('accepts NODE_ENV=%s', (value) => {
    expect(environmentEnvSchema.parse({ NODE_ENV: value }).NODE_ENV).toBe(value);
  });

  it.each(['staging', 'prod', '', 'DEVELOPMENT'])('rejects unsupported NODE_ENV=%j', (value) => {
    const result = environmentEnvSchema.safeParse({ NODE_ENV: value });

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected an unsupported NODE_ENV to fail');
    }

    expect(result.error.issues[0]?.path).toEqual(['NODE_ENV']);
  });

  it('does not include the supplied value in validation issues', () => {
    const secretSentinel = 'do-not-print-this-value';
    const result = environmentEnvSchema.safeParse({ NODE_ENV: secretSentinel });

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('Expected an invalid NODE_ENV to fail');
    }

    expect(JSON.stringify(result.error.issues)).not.toContain(secretSentinel);
  });
});
