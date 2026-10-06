import type * as z from 'zod';

import type { environmentEnvSchema } from './environment.js';
import type { loggerEnvSchema } from './logging.js';

type LoggerRuleInput = z.output<typeof environmentEnvSchema> & z.output<typeof loggerEnvSchema>;

// Logging rules every app needs. They read two pieces, so they can't live on
// either one (a refine on a piece is dropped by `.shape`): each app calls this
// from the superRefine on its combined schema.
export const applyLoggerRules = (env: LoggerRuleInput, context: z.RefinementCtx): void => {
  if (env.NODE_ENV === 'production' && env.LOG_PRETTY) {
    context.addIssue({
      code: 'custom',
      path: ['LOG_PRETTY'],
      message: 'Pretty logging is not allowed in production',
    });
  }

  if (env.NODE_ENV !== 'test' && env.LOG_LEVEL === 'silent') {
    context.addIssue({
      code: 'custom',
      path: ['LOG_LEVEL'],
      message: 'Silent logging is allowed only during tests',
    });
  }
};
