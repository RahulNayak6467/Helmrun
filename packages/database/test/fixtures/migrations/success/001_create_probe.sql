-- Up Migration

CREATE TABLE test_migration_probe (
  id integer PRIMARY KEY,
  application_count integer NOT NULL
);

INSERT INTO test_migration_probe (id, application_count) VALUES (1, 1);

-- Down Migration

DROP TABLE test_migration_probe;
