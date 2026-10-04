import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { runCommand, type CommandResult } from '../support/run-command.js';
import {
  assertSafeTestDatabase,
  createIntegrationPool,
  createThrowawayDatabase,
  dropTestTables,
  requireTestDatabaseUrl,
} from '../support/test-database.js';

// Paths are relative to this file, so the tests work whether Vitest runs from
// the repo root or from packages/database.
const packageRoot = resolve(import.meta.dirname, '../..');
const migrationRunner = resolve(packageRoot, 'node_modules/node-pg-migrate/bin/node-pg-migrate.js');
const fixtures = resolve(packageRoot, 'test/fixtures/migrations');
const repositoryMigrations = resolve(packageRoot, 'migrations');

// The runner flags come from the package's own migrate:test:up script, so these
// tests always exercise exactly what `pnpm db:migrate:test` runs. Only the
// migrations folder and history table are swapped per test.
const scriptFlags = (): string[] => {
  const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const script = packageJson.scripts['migrate:test:up'];

  if (script === undefined) {
    throw new Error('packages/database/package.json must define a migrate:test:up script');
  }

  const tokens = script.split(/\s+/u);
  const flags = tokens.slice(tokens.indexOf('up') + 1);
  const replaced = new Set(['--migrations-dir', '--migrations-table']);

  return flags.filter(
    (token, index) => !replaced.has(token) && !replaced.has(flags[index - 1] ?? ''),
  );
};

const flags = scriptFlags();

// Each test records history in its own table so tests can't see each other's runs.
const historyTables = {
  success: 'test_history_success',
  failure: 'test_history_failure',
  concurrency: 'test_history_concurrency',
} as const;
const probeTables = [
  'test_migration_probe',
  'test_migration_failure_probe',
  'test_concurrency_probe',
];

const runMigrations = (
  databaseUrl: string,
  migrationsDirectory: string,
  historyTable: string,
): Promise<CommandResult> =>
  runCommand({
    command: process.execPath,
    arguments_: [
      migrationRunner,
      'up',
      ...flags,
      '--migrations-dir',
      migrationsDirectory,
      '--migrations-table',
      historyTable,
    ],
    environment: { ...process.env, TEST_DATABASE_URL: databaseUrl },
    timeoutMs: 15_000,
  });

describe('real PostgreSQL migrations', () => {
  let databaseUrl: string;
  let databasePool: Pool | undefined;

  const requirePool = (): Pool => {
    if (databasePool === undefined) {
      throw new Error('Integration pool was not created');
    }

    return databasePool;
  };

  const guard = () => ({
    databasePool: requirePool(),
    databaseUrl,
    runtimeEnvironment: process.env.NODE_ENV,
  });

  const cleanup = async (): Promise<void> => {
    await dropTestTables({
      ...guard(),
      tableNames: [...Object.values(historyTables), ...probeTables],
    });
  };

  beforeAll(async () => {
    databaseUrl = requireTestDatabaseUrl();
    databasePool = createIntegrationPool(databaseUrl);
    await assertSafeTestDatabase(guard());
    await cleanup();
  });

  afterEach(async () => {
    if (databasePool !== undefined) {
      await cleanup();
    }
  });

  afterAll(async () => {
    // If setup failed before the pool existed, let the original error stand.
    await databasePool?.end();
  });

  it('runs with the same flags as the migrate:test:up script', () => {
    expect(flags).toEqual(
      expect.arrayContaining(['--single-transaction', '--advisory-lock-mode', 'fail']),
    );
  });

  it('applies a fresh migration once and treats a rerun as a no-op', async () => {
    const first = await runMigrations(
      databaseUrl,
      resolve(fixtures, 'success'),
      historyTables.success,
    );
    const second = await runMigrations(
      databaseUrl,
      resolve(fixtures, 'success'),
      historyTables.success,
    );

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('No migrations to run');

    const result = await requirePool().query<{ history_count: string; row_count: string }>(`
      SELECT
        (SELECT COUNT(*) FROM "${historyTables.success}") AS history_count,
        (SELECT COUNT(*) FROM test_migration_probe) AS row_count
    `);

    expect(result.rows[0]).toEqual({ history_count: '1', row_count: '1' });
  });

  it('does not keep DDL or migration history when a migration fails', async () => {
    const result = await runMigrations(
      databaseUrl,
      resolve(fixtures, 'failure'),
      historyTables.failure,
    );

    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('division by zero');

    const state = await requirePool().query<{
      failed_probe: string | null;
      successful_probe: string | null;
      history_count: string;
    }>(`
      SELECT
        to_regclass('public.test_migration_failure_probe')::text AS failed_probe,
        to_regclass('public.test_migration_probe')::text AS successful_probe,
        (SELECT COUNT(*) FROM "${historyTables.failure}") AS history_count
    `);

    // --single-transaction: the earlier, successful migration is rolled back too.
    expect(state.rows[0]).toEqual({
      failed_probe: null,
      successful_probe: null,
      history_count: '0',
    });
  });

  it('allows only one concurrent runner to apply a migration', async () => {
    const results = await Promise.all([
      runMigrations(databaseUrl, resolve(fixtures, 'concurrency'), historyTables.concurrency),
      runMigrations(databaseUrl, resolve(fixtures, 'concurrency'), historyTables.concurrency),
    ]);

    expect(results.map((result) => result.exitCode).sort()).toEqual([0, 1]);
    expect(
      results.some((result) => `${result.stdout}${result.stderr}`.includes('already running')),
    ).toBe(true);

    const state = await requirePool().query<{ history_count: string; row_count: string }>(`
      SELECT
        (SELECT COUNT(*) FROM "${historyTables.concurrency}") AS history_count,
        (SELECT COUNT(*) FROM test_concurrency_probe) AS row_count
    `);

    expect(state.rows[0]).toEqual({ history_count: '1', row_count: '1' });
  });

  // The real migrations run against a brand-new empty database, never the shared
  // test database (already migrated by `pnpm db:migrate:test`). That proves they
  // work from a clean state, and leaves nothing behind.
  it('applies the repository migrations to an empty database and sets its timezone to UTC', async () => {
    const throwaway = await createThrowawayDatabase(guard(), 'migration_check');

    try {
      const first = await runMigrations(throwaway.url, repositoryMigrations, 'schema_migrations');
      const second = await runMigrations(throwaway.url, repositoryMigrations, 'schema_migrations');

      expect(first.exitCode).toBe(0);
      expect(second.stdout).toContain('No migrations to run');

      // Read the stored per-database setting directly: SHOW timezone could say
      // UTC anyway if the server default happens to be UTC.
      const setting = await requirePool().query<{ setconfig: string[] | null }>(
        `SELECT s.setconfig
         FROM pg_db_role_setting s
         JOIN pg_database d ON d.oid = s.setdatabase
         WHERE d.datname = $1 AND s.setrole = 0`,
        [throwaway.name],
      );

      expect(setting.rows[0]?.setconfig).toEqual(['TimeZone=UTC']);
    } finally {
      await throwaway.drop();
    }
  });
});
