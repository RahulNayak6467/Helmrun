import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkDatabaseHealth } from './health.js';

const query = vi.fn();
const db = { query } as unknown as Parameters<typeof checkDatabaseHealth>[0];

describe('checkDatabaseHealth', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('runs one cheap query through the supplied pool', async () => {
    query.mockResolvedValue({ rows: [{ result: 1 }] });

    await checkDatabaseHealth(db);

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/^SELECT 1 AS result$/i));
  });

  it('resolves without a value when PostgreSQL accepts the query', async () => {
    query.mockResolvedValue({ rows: [{ result: 1 }] });

    await expect(checkDatabaseHealth(db)).resolves.toBeUndefined();
  });

  it('rejects with the original error when PostgreSQL rejects the query', async () => {
    const error = new Error('connection refused');
    query.mockRejectedValue(error);

    await expect(checkDatabaseHealth(db)).rejects.toBe(error);
  });
});
