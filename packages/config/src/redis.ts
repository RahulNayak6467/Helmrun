import * as z from 'zod';

import { integerEnv } from './integer.js';

export const redisUrlSchema = z
  .string({
    error: 'REDIS_URL is required',
  })
  // abort: an empty value is already known to be invalid, so skip the URL checks
  // instead of reporting a second, misleading "invalid URL" issue.
  .min(1, {
    error: 'REDIS_URL is required',
    abort: true,
  })
  .superRefine((value, context) => {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'REDIS_URL must be a valid redis connection URL',
      });

      return;
    }
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      context.addIssue({
        code: 'custom',
        message: 'REDIS_URL must use the redis: or rediss: protocol',
      });

      return;
    }
    if (url.hostname.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'REDIS_URL must include a hostname',
      });
    }
    // Only database 0: ioredis reads /abc as 0, and cluster mode supports only 0.
    if (url.pathname !== '' && url.pathname !== '/' && url.pathname !== '/0') {
      context.addIssue({
        code: 'custom',
        message: 'REDIS_URL must not select a database other than 0',
      });
    }
    // ioredis turns query parameters into options that override the ones set in
    // code (e.g. ?enableOfflineQueue=true would undo fail-fast).
    if (url.search !== '' || url.hash !== '') {
      context.addIssue({
        code: 'custom',
        message: 'REDIS_URL must not include query parameters or a fragment',
      });
    }
  });

export const redisEnvSchema = z.object({
  REDIS_URL: redisUrlSchema,
  REDIS_COMMAND_TIMEOUT_MS: integerEnv('REDIS_COMMAND_TIMEOUT_MS', {
    min: 10,
    max: 5_000,
    fallback: 100,
    unit: 'milliseconds',
  }),
  REDIS_CONNECT_TIMEOUT_MS: integerEnv('REDIS_CONNECT_TIMEOUT_MS', {
    min: 100,
    max: 30_000,
    fallback: 2_000,
    unit: 'milliseconds',
  }),
});
