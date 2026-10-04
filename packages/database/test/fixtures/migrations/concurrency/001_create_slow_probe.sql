-- Up Migration

CREATE TABLE test_concurrency_probe (
  id integer PRIMARY KEY,
  application_count integer NOT NULL
);

-- Holds the migration lock long enough for a second runner to collide with it.
SELECT pg_sleep(3);

INSERT INTO test_concurrency_probe (id, application_count) VALUES (1, 1);

-- Down Migration

DROP TABLE test_concurrency_probe;
