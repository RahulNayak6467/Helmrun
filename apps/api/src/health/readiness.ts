import { checkDatabaseHealth, type Pool } from '@helmrun/database';
import type { Logger } from '@helmrun/logger';
import type { LifecycleState } from '@helmrun/shared';

export type ReadinessResult =
  | { status: 'ready' }
  | { status: 'not_ready'; reason: 'draining' | 'database_unavailable' | 'timeout' };

export type ReadinessChecker = () => Promise<ReadinessResult>;

export interface ReadinessOptions {
  readonly databasePool: Pick<Pool, 'query'>;
  readonly lifecycle: Pick<LifecycleState, 'isDraining'>;
  readonly timeoutMs: number;
  readonly logger: Pick<Logger, 'warn'>;
}

// Ready means "send me traffic": not draining, and Postgres answers within the
// deadline. Never rejects; every failure is a not_ready result.
export const createReadinessChecker = ({
  databasePool,
  lifecycle,
  timeoutMs,
  logger,
}: ReadinessOptions): ReadinessChecker => {
  // Probes from several load balancers can overlap. While one database check
  // is unfinished, later probes share it instead of each taking a pool
  // connection, so a slow database can't be made slower by its own health checks.
  let inFlightDatabaseCheck: Promise<void> | undefined;

  const getDatabaseCheck = (): Promise<void> => {
    if (inFlightDatabaseCheck !== undefined) return inFlightDatabaseCheck;

    const databaseCheck = checkDatabaseHealth(databasePool).catch((error: unknown) => {
      logger.warn(
        { event: 'database_readiness_check_failed', err: error },
        'Database readiness check failed',
      );
      throw error;
    });
    inFlightDatabaseCheck = databaseCheck;

    const clear = (): void => {
      if (inFlightDatabaseCheck === databaseCheck) inFlightDatabaseCheck = undefined;
    };
    void databaseCheck.then(clear, clear);

    return databaseCheck;
  };

  return async () => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      if (lifecycle.isDraining()) return { status: 'not_ready', reason: 'draining' };

      // The probe must answer within its own deadline even if the query hangs.
      // The query keeps running; the pool's statement timeout bounds it (decision 010).
      const timeout = new Promise<'timeout'>((resolve) => {
        timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs);
      });
      const result = await Promise.race([getDatabaseCheck(), timeout]);

      if (result !== 'timeout') return { status: 'ready' };

      logger.warn({ event: 'readiness_check_timed_out', timeoutMs }, 'Readiness check timed out');
      return { status: 'not_ready', reason: 'timeout' };
    } catch {
      return { status: 'not_ready', reason: 'database_unavailable' };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  };
};
