import { createLifecycleState } from '@helmrun/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReadinessChecker, type ReadinessOptions } from './readiness.js';

const TIMEOUT_MS = 1_000;

// The checker only calls pool.query (via checkDatabaseHealth), so the fake pool
// is just that method. pg's overloaded query type can't be met by a mock, hence
// the cast (same as packages/database's health test).
const createHarness = () => {
  const query = vi.fn<() => Promise<unknown>>().mockResolvedValue({ rows: [{ result: 1 }] });
  const warn = vi.fn();
  const lifecycle = createLifecycleState();
  const check = createReadinessChecker({
    databasePool: { query } as unknown as ReadinessOptions['databasePool'],
    lifecycle,
    timeoutMs: TIMEOUT_MS,
    logger: { warn },
  });

  return { query, warn, lifecycle, check };
};

describe('createReadinessChecker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('is ready when Postgres answers before the deadline, and clears its timer', async () => {
    const { query, warn, check } = createHarness();

    await expect(check()).resolves.toEqual({ status: 'ready' });

    expect(query).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports database_unavailable and logs the original error', async () => {
    const { query, warn, check } = createHarness();
    const databaseError = new Error('connection refused');
    query.mockRejectedValue(databaseError);

    await expect(check()).resolves.toEqual({
      status: 'not_ready',
      reason: 'database_unavailable',
    });

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { event: 'database_readiness_check_failed', err: databaseError },
      expect.any(String),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports timeout when Postgres does not answer before the deadline', async () => {
    const { query, warn, check } = createHarness();
    query.mockImplementation(() => new Promise(() => undefined));

    const result = check();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    await expect(result).resolves.toEqual({ status: 'not_ready', reason: 'timeout' });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { event: 'readiness_check_timed_out', timeoutMs: TIMEOUT_MS },
      expect.any(String),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports draining without querying or starting a timer', async () => {
    const { query, lifecycle, check } = createHarness();
    lifecycle.beginDraining();

    await expect(check()).resolves.toEqual({ status: 'not_ready', reason: 'draining' });

    expect(query).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers on a later check once Postgres is back', async () => {
    const { query, check } = createHarness();
    query.mockRejectedValueOnce(new Error('temporary outage'));

    await expect(check()).resolves.toMatchObject({ status: 'not_ready' });
    await expect(check()).resolves.toEqual({ status: 'ready' });

    expect(query).toHaveBeenCalledTimes(2);
  });

  it('shares one unfinished database check between concurrent probes', async () => {
    const { query, check } = createHarness();
    let answer: (() => void) | undefined;
    query.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ rows: [] });
        }),
    );

    const first = check();
    const second = check();
    answer?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'ready' },
      { status: 'ready' },
    ]);
    expect(query).toHaveBeenCalledOnce();
  });

  it('starts a fresh database check once a timed-out one finally settles', async () => {
    const { query, check } = createHarness();
    let answer: (() => void) | undefined;
    query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ rows: [] });
        }),
    );

    const timedOut = check();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await expect(timedOut).resolves.toEqual({ status: 'not_ready', reason: 'timeout' });

    answer?.();
    await vi.advanceTimersByTimeAsync(0);
    await expect(check()).resolves.toEqual({ status: 'ready' });

    expect(query).toHaveBeenCalledTimes(2);
  });
});
