import * as z from 'zod';

export interface ConfigValidationIssue {
  readonly field: string;
  readonly reason: string;
}

// Turns a Zod validation error into "field: reason" pairs for a readable
// startup error. Reports names and reasons only, never the rejected values,
// so secrets in env vars can't end up in logs.
export const toConfigValidationIssues = (
  error: unknown,
): readonly ConfigValidationIssue[] | null => {
  if (!(error instanceof z.ZodError)) {
    return null;
  }

  return error.issues.map((issue) => ({
    field: issue.path.length === 0 ? 'configuration' : issue.path.map(String).join('.'),
    reason: issue.message,
  }));
};
