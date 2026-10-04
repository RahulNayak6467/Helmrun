-- Up Migration

CREATE TABLE test_migration_failure_probe (
  id integer PRIMARY KEY
);

-- Fails after DDL has run, to prove --single-transaction rolls back everything.
SELECT 1 / 0;

-- Down Migration

DROP TABLE test_migration_failure_probe;
