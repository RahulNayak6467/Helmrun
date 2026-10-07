import * as z from 'zod';
import { describe, expect, it } from 'vitest';

import { environmentEnvSchema } from './environment.js';
import { toConfigValidationIssues } from './issues.js';
import { loggerEnvSchema } from './logging.js';
import { applyLoggerRules } from './logging-rules.js';

const combined = z
  .object({ ...environmentEnvSchema.shape, ...loggerEnvSchema.shape })
  .superRefine(applyLoggerRules);

const issuesFor = (input: Record<string, string>) => {
  const result = combined.safeParse(input);

  return result.success ? [] : toConfigValidationIssues(result.error);
};

describe('applyLoggerRules', () => {
  it('rejects pretty logging in production', () => {
    expect(issuesFor({ NODE_ENV: 'production', LOG_PRETTY: 'true' })).toEqual([
      { field: 'LOG_PRETTY', reason: 'Pretty logging is not allowed in production' },
    ]);
  });

  it('rejects silent logging outside tests', () => {
    expect(issuesFor({ NODE_ENV: 'development', LOG_LEVEL: 'silent' })).toEqual([
      { field: 'LOG_LEVEL', reason: 'Silent logging is allowed only during tests' },
    ]);
  });

  it('allows silent logging in tests', () => {
    expect(issuesFor({ NODE_ENV: 'test', LOG_LEVEL: 'silent' })).toEqual([]);
  });

  it('allows pretty logging in development', () => {
    expect(issuesFor({ NODE_ENV: 'development', LOG_PRETTY: 'true' })).toEqual([]);
  });

  it('reports both issues for production with pretty and silent logging', () => {
    expect(issuesFor({ NODE_ENV: 'production', LOG_PRETTY: 'true', LOG_LEVEL: 'silent' })).toEqual([
      { field: 'LOG_PRETTY', reason: 'Pretty logging is not allowed in production' },
      { field: 'LOG_LEVEL', reason: 'Silent logging is allowed only during tests' },
    ]);
  });
});
