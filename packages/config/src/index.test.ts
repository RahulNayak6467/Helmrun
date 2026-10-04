import * as z from 'zod';
import { describe, expect, it } from 'vitest';

import { environmentEnvSchema, loggerEnvSchema, toConfigValidationIssues } from './index.js';

const combined = z.object({ ...environmentEnvSchema.shape, ...loggerEnvSchema.shape });

function failureOf(result: { success: boolean; error?: z.ZodError }): z.ZodError {
  if (result.success || result.error === undefined) {
    throw new Error('Expected validation to fail');
  }

  return result.error;
}

describe('toConfigValidationIssues', () => {
  it('returns safe field names and reasons for multiple validation issues', () => {
    const error = failureOf(
      combined.safeParse({ NODE_ENV: 'staging', LOG_LEVEL: 'verbose', LOG_PRETTY: 'yes' }),
    );

    const issues = toConfigValidationIssues(error);

    expect(issues).not.toBeNull();
    expect(issues?.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(['NODE_ENV', 'LOG_LEVEL', 'LOG_PRETTY']),
    );
    expect(issues?.every((issue) => issue.reason.length > 0)).toBe(true);
  });

  it('uses "configuration" for a root-level issue path', () => {
    const error = failureOf(z.string().min(1).safeParse(''));

    const issues = toConfigValidationIssues(error);

    expect(issues?.[0]?.field).toBe('configuration');
    expect(typeof issues?.[0]?.reason).toBe('string');
  });

  it('returns null for a non-Zod error', () => {
    expect(toConfigValidationIssues(new Error('unexpected failure'))).toBeNull();
  });

  it('does not include a supplied secret value in its report', () => {
    const secretSentinel = 'secret-value-that-must-not-appear';
    const error = failureOf(combined.safeParse({ NODE_ENV: secretSentinel }));

    const issues = toConfigValidationIssues(error);

    expect(JSON.stringify(issues)).not.toContain(secretSentinel);
  });
});
