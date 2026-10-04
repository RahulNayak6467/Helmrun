-- Up Migration

-- Every session on this database defaults to UTC, so timestamps are stored and
-- returned unambiguously no matter where the server or client runs. Applies to
-- new connections. ALTER DATABASE needs a literal name, hence the dynamic SQL.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END
$$;

-- Down Migration

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I RESET timezone', current_database());
END
$$;
