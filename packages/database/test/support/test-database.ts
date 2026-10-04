import { Pool } from 'pg';

// Destructive tests may only touch a database whose name ends in _test, and
// only objects whose names start with test_.
const TEST_DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]+_test$/u;
const TEST_OBJECT_NAME_PATTERN = /^test_[a-z0-9_]+$/u;

interface TestDatabaseGuardInput {
  readonly databasePool: Pool;
  readonly databaseUrl: string;
  readonly runtimeEnvironment: string | undefined;
}

export interface TestDatabaseIdentity {
  readonly configuredDatabase: string;
  readonly connectedDatabase: string;
  readonly connectedUser: string;
}

interface DropTestTablesInput extends TestDatabaseGuardInput {
  readonly tableNames: readonly string[];
}

const getConfiguredDatabaseName = (databaseUrl: string): string => {
  let url: URL;

  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));

  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error('Configured integration database name must end with _test');
  }

  return databaseName;
};

// Integration tests read TEST_DATABASE_URL only, never DATABASE_URL, so a value
// exported in the developer's shell can't point them at the dev database.
export const requireTestDatabaseUrl = (): string => {
  const databaseUrl = process.env.TEST_DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('TEST_DATABASE_URL is required for integration tests (see .env.test.example)');
  }

  return databaseUrl;
};

export const createIntegrationPool = (databaseUrl: string): Pool =>
  new Pool({
    connectionString: databaseUrl,
    application_name: 'integration-tests',
    max: 2,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 1_000,
    statement_timeout: 5_000,
  });

// Refuses to continue unless NODE_ENV=test, the configured database name ends
// in _test, and the connection actually reached that database.
export const assertSafeTestDatabase = async ({
  databasePool,
  databaseUrl,
  runtimeEnvironment,
}: TestDatabaseGuardInput): Promise<TestDatabaseIdentity> => {
  if (runtimeEnvironment !== 'test') {
    throw new Error('Destructive database tests require NODE_ENV=test');
  }

  const configuredDatabase = getConfiguredDatabaseName(databaseUrl);
  const result = await databasePool.query<{
    connected_database: string;
    connected_user: string;
  }>('SELECT current_database() AS connected_database, current_user AS connected_user');
  const identity = result.rows[0];

  if (identity === undefined) {
    throw new Error('Test database identity query returned no rows');
  }

  if (identity.connected_database !== configuredDatabase) {
    throw new Error('Connected database does not match TEST_DATABASE_URL');
  }

  return {
    configuredDatabase,
    connectedDatabase: identity.connected_database,
    connectedUser: identity.connected_user,
  };
};

export interface ThrowawayDatabase {
  readonly name: string;
  readonly url: string;
  readonly drop: () => Promise<void>;
}

// Creates an empty database on the same server as the (guarded) test database,
// for tests that must start from a truly clean state, such as replaying the real
// migrations. The name follows the _test pattern, and drop() force-closes any
// connections first.
export const createThrowawayDatabase = async (
  guard: TestDatabaseGuardInput,
  label: string,
): Promise<ThrowawayDatabase> => {
  await assertSafeTestDatabase(guard);

  const name = `${label}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_test`;

  if (!TEST_DATABASE_NAME_PATTERN.test(name) || !/^[a-z0-9_]+$/u.test(name)) {
    throw new Error(`Invalid throwaway database name "${name}"`);
  }

  // Identifiers can't be parameterized; the pattern checks above make this safe.
  await guard.databasePool.query(`CREATE DATABASE "${name}"`);

  const url = new URL(guard.databaseUrl);
  url.pathname = `/${name}`;

  return {
    name,
    url: url.toString(),
    drop: async () => {
      await guard.databasePool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
};

export const dropTestTables = async ({
  tableNames,
  ...guard
}: DropTestTablesInput): Promise<void> => {
  await assertSafeTestDatabase(guard);

  for (const tableName of tableNames) {
    if (!TEST_OBJECT_NAME_PATTERN.test(tableName)) {
      throw new Error(`Refusing to drop "${tableName}": test tables must start with test_`);
    }

    // Identifiers can't be parameterized; the pattern check above is what makes
    // this interpolation safe.
    await guard.databasePool.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
  }
};
