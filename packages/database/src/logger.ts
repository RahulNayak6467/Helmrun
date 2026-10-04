// The logging surface this package needs. A Pino logger satisfies it
// structurally, so the package doesn't depend on Pino and tests can pass a
// plain fake. Same idea as decision 009: say what you need, not where it comes from.
export interface DatabaseLogger {
  debug(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}
