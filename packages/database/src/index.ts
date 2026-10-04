export { createPool, type DatabaseOptions } from './pool.js';
export { checkDatabaseHealth } from './health.js';
export type { DatabaseLogger } from './logger.js';

// Re-exported so apps can type the pool without depending on `pg` directly.
export type { Pool } from 'pg';
