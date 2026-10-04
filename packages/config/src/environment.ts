import * as z from 'zod';

// Required, no default. NODE_ENV switches safety rules on and off (e.g. no
// pretty logging in production), so a missing value must fail startup rather
// than silently fall back to the least strict environment.
export const environmentEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production'], {
    error: (issue) =>
      issue.input === undefined
        ? 'NODE_ENV is required'
        : 'NODE_ENV must be development, test, or production',
  }),
});

export type NodeEnvironment = z.output<typeof environmentEnvSchema>['NODE_ENV'];
