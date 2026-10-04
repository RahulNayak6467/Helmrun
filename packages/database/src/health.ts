import type { Pool } from 'pg';

// The cheapest query that proves Postgres accepts work. Rejects with the
// original error; readiness (step 14) decides timeouts and what "not ready" means.
export const checkDatabaseHealth = async (db: Pick<Pool, 'query'>): Promise<void> => {
  await db.query('SELECT 1 AS result');
};
