import nodeProcess from 'node:process';

import { toConfigValidationIssues } from './issues.js';

// The slice of `process` used on failure, so tests can pass a fake.
export interface ConfigExitTarget {
  readonly stderr: { write(chunk: string): unknown };
  exit(code: number): never;
}

// Invalid config means nothing else can safely run. No logger exists yet, so
// write one structured line to stderr (field names and reasons only, never the
// rejected values) and exit non-zero. Anything that isn't a validation error is
// a bug, so it's rethrown untouched.
export const loadConfigOrExit = <Config>(
  serviceName: string,
  load: () => Config,
  processTarget: ConfigExitTarget = nodeProcess,
): Config => {
  try {
    return load();
  } catch (error) {
    const issues = toConfigValidationIssues(error);

    if (issues === null) {
      throw error;
    }

    processTarget.stderr.write(
      `${JSON.stringify({
        severity: 'FATAL',
        service: serviceName,
        event: 'config_invalid',
        issues,
        msg: 'Invalid configuration; refusing to start',
      })}\n`,
    );

    return processTarget.exit(1);
  }
};
