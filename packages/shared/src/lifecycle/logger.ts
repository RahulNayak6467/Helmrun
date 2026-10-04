// The logging surface the lifecycle helpers need. A Pino logger satisfies it
// structurally, so `shared` stays dependency-free and tests pass plain fakes
// (same idea as DatabaseLogger, decision 010).
export interface LifecycleLogger {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
  fatal(fields: Record<string, unknown>, message: string): void;
}
