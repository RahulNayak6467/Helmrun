import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const SIGTERM = { reason: 'signal', signal: 'SIGTERM', exitCode: 0 } as const;
const IDLE_HEARTBEAT_INTERVAL_MS = 60_000;

const validEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  LOG_PRETTY: 'false',
  SHUTDOWN_TIMEOUT_MS: '10000',
};

type AppEnv = typeof validEnv;

const stubAppEnv = (overrides: Partial<AppEnv> = {}) => {
  for (const [name, value] of Object.entries({ ...validEnv, ...overrides })) {
    vi.stubEnv(name, value);
  }
};

const createFakeProcess = () => ({
  exitCode: undefined as number | string | null | undefined,
  exit: vi.fn<(code: number) => never>(),
});

const captureStdout = () => {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });

  return () => chunks.join('');
};

const schedulerRoot = resolve(import.meta.dirname, '..');

const spawnScheduler = (overrides: Partial<AppEnv> = {}) => {
  const child = spawn(
    process.execPath,
    ['--conditions=@helmrun/source', '--import', 'tsx', resolve(schedulerRoot, 'src/main.ts')],
    {
      cwd: schedulerRoot,
      env: { ...validEnv, ...overrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk: Buffer) => {
    output.stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output.stderr += chunk.toString('utf8');
  });

  return { child, output };
};

describe('scheduler entry point', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('in process', () => {
    it('logs scheduler_started, then shuts down cleanly on request', async () => {
      vi.useFakeTimers();
      stubAppEnv();
      const stdout = captureStdout();
      const processTarget = createFakeProcess();
      const { startScheduler } = await import('./main.js');

      const { requestShutdown } = startScheduler(processTarget);
      await requestShutdown(SIGTERM);

      expect(stdout()).toContain('"event":"scheduler_started"');
      expect(stdout()).toContain('"event":"shutdown_step_completed","step":"idle_loop"');
      expect(stdout()).toContain('"event":"shutdown_completed"');
      expect(processTarget.exitCode).toBe(0);
    });

    it('stops the idle heartbeat after shutdown', async () => {
      vi.useFakeTimers();
      stubAppEnv({ LOG_LEVEL: 'debug', SHUTDOWN_TIMEOUT_MS: '120000' });
      const stdout = captureStdout();
      const processTarget = createFakeProcess();
      const { startScheduler } = await import('./main.js');
      const { requestShutdown } = startScheduler(processTarget);
      const heartbeats = () => stdout().match(/"event":"scheduler_idle"/gu)?.length ?? 0;

      vi.advanceTimersByTime(IDLE_HEARTBEAT_INTERVAL_MS);
      expect(heartbeats()).toBe(1);

      await requestShutdown(SIGTERM);
      vi.advanceTimersByTime(IDLE_HEARTBEAT_INTERVAL_MS * 1.5);

      expect(heartbeats()).toBe(1);
      expect(processTarget.exit).not.toHaveBeenCalled();
    });
  });

  describe('as a child process', () => {
    it('stays alive after startup, then exits 0 on SIGTERM well before the deadline', async () => {
      const { child, output } = spawnScheduler();

      try {
        await vi.waitFor(() => {
          expect(output.stdout, output.stderr).toContain('"event":"scheduler_started"');
        }, 10_000);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
        expect(child.exitCode, output.stderr).toBeNull();
        expect(child.signalCode, output.stderr).toBeNull();

        const closed = once(child, 'close');
        const signalledAt = Date.now();
        child.kill('SIGTERM');
        const [code] = (await closed) as [number | null];

        expect(code, output.stderr).toBe(0);
        expect(Date.now() - signalledAt).toBeLessThan(5_000);
        expect(output.stdout).toContain('"event":"shutdown_completed"');
      } finally {
        child.kill('SIGKILL');
      }
    }, 20_000);

    it('exits 1 with one config_invalid line on stderr when NODE_ENV is invalid', async () => {
      const { child, output } = spawnScheduler({ NODE_ENV: 'staging' });

      try {
        const [code] = (await once(child, 'close')) as [number | null];

        expect(code).toBe(1);
        const lines = output.stderr.trimEnd().split('\n');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0] ?? '')).toMatchObject({
          severity: 'FATAL',
          service: 'helmrun-scheduler',
          event: 'config_invalid',
          issues: [{ field: 'NODE_ENV' }],
        });
      } finally {
        child.kill('SIGKILL');
      }
    }, 20_000);
  });
});
