import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const findFreePort = async (): Promise<number> => {
  const probe: Server = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
};

// Redis connects eagerly, so point it at a closed port, not the test Valkey.
const stubValidEnv = async (port: number): Promise<void> => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('LOG_LEVEL', 'silent');
  vi.stubEnv('LOG_PRETTY', 'false');
  vi.stubEnv('PORT', String(port));
  vi.stubEnv('DATABASE_URL', 'postgresql://helmrun_test:password@127.0.0.1:5441/helmrun_test');
  vi.stubEnv('REDIS_URL', `redis://:password@127.0.0.1:${String(await findFreePort())}`);
};

const createFakeProcess = () => ({
  exitCode: undefined as number | string | null | undefined,
  exit: vi.fn<(code: number) => never>(),
});

const SIGTERM = { reason: 'signal', signal: 'SIGTERM', exitCode: 0 } as const;

describe('API entry point', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not start a server when imported (only when run directly)', async () => {
    const http = (await import('node:http')).default;
    const listen = vi.spyOn(http, 'createServer');

    await import('./main.js');

    expect(listen).not.toHaveBeenCalled();
  });

  it('listens on the configured port and responds over HTTP', async () => {
    const port = await findFreePort();
    await stubValidEnv(port);
    const { startServer } = await import('./main.js');

    const { server, requestShutdown } = startServer(createFakeProcess());

    try {
      await once(server, 'listening');
      const response = await fetch(`http://127.0.0.1:${String(port)}/anything`);

      expect(response.headers.get('x-request-id')).toEqual(expect.any(String));
    } finally {
      await requestShutdown(SIGTERM);
    }
  });

  it('treats a startup failure (port in use) as fatal and exits with code 1', async () => {
    // Same (all-interfaces) binding the API uses, so the port genuinely collides.
    const blocker: Server = createServer();
    blocker.listen(0);
    await once(blocker, 'listening');
    const { port } = blocker.address() as AddressInfo;
    await stubValidEnv(port);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { startServer } = await import('./main.js');

    try {
      startServer();

      await vi.waitFor(() => {
        expect(exit).toHaveBeenCalledWith(1);
      }, 3_000);
    } finally {
      process.exitCode = undefined;
      blocker.close();
    }
  });

  it('logs runtime server errors after listening without exiting or crashing', async () => {
    const port = await findFreePort();
    await stubValidEnv(port);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { startServer } = await import('./main.js');
    const { server, requestShutdown } = startServer(createFakeProcess());

    try {
      await once(server, 'listening');

      // Two in a row: the second must not become an unhandled 'error' event.
      expect(() => server.emit('error', new Error('EMFILE: too many open files'))).not.toThrow();
      expect(() => server.emit('error', new Error('EMFILE: too many open files'))).not.toThrow();
      expect(exit).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    } finally {
      await requestShutdown(SIGTERM);
    }
  });

  it('starts the server when the file is run directly, as pnpm dev does', async () => {
    const port = await findFreePort();
    await stubValidEnv(port);
    vi.stubEnv('LOG_LEVEL', 'info');
    const apiRoot = resolve(import.meta.dirname, '..');
    // The child inherits the stubbed environment.
    const child = spawn(
      process.execPath,
      ['--conditions=@helmrun/source', '--import', 'tsx', resolve(apiRoot, 'src/main.ts')],
      { cwd: apiRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    try {
      await new Promise<void>((resolveListening, reject) => {
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
          if (output.includes('http_server_listening')) resolveListening();
        });
        child.once('exit', (code) => {
          reject(new Error(`API exited early with code ${String(code)}`));
        });
      });

      const response = await fetch(`http://127.0.0.1:${String(port)}/anything`);

      expect(response.headers.get('x-request-id')).toEqual(expect.any(String));
    } finally {
      child.kill('SIGTERM');
    }
  }, 15_000);

  it('handles SIGTERM when run directly: closes HTTP, then the pool, then Redis, and exits 0', async () => {
    const port = await findFreePort();
    await stubValidEnv(port);
    vi.stubEnv('LOG_LEVEL', 'info');
    const apiRoot = resolve(import.meta.dirname, '..');
    const child = spawn(
      process.execPath,
      ['--conditions=@helmrun/source', '--import', 'tsx', resolve(apiRoot, 'src/main.ts')],
      { cwd: apiRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });

    try {
      await vi.waitFor(() => {
        expect(output).toContain('http_server_listening');
      }, 10_000);

      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const [code] = (await exited) as [number | null];

      expect(code).toBe(0);
      expect(output).toContain('shutdown_started');
      expect(output).toContain('shutdown_completed');
      const httpStep = output.indexOf('"step":"http_server"');
      const poolStep = output.indexOf('"step":"database_pool"');
      const redisStep = output.indexOf('"step":"redis"');
      expect(httpStep).toBeGreaterThanOrEqual(0);
      expect(httpStep).toBeLessThan(poolStep);
      expect(poolStep).toBeLessThan(redisStep);
    } finally {
      child.kill('SIGKILL');
    }
  }, 15_000);

  it('logs a Redis startup failure with its real error type, without a stack', async () => {
    const port = await findFreePort();
    await stubValidEnv(port);
    vi.stubEnv('LOG_LEVEL', 'info');
    const apiRoot = resolve(import.meta.dirname, '..');
    const child = spawn(
      process.execPath,
      ['--conditions=@helmrun/source', '--import', 'tsx', resolve(apiRoot, 'src/main.ts')],
      { cwd: apiRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });

    try {
      await vi.waitFor(() => {
        expect(output).toContain('redis_unavailable_at_startup');
      }, 10_000);

      const line = output
        .split('\n')
        .find((candidate) => candidate.includes('"event":"redis_unavailable_at_startup"'));
      const record = JSON.parse(line ?? '{}') as Record<string, unknown>;

      expect(record.err).toBeUndefined();
      expect(record.errorDetails).toMatchObject({ type: 'Error', code: 'ECONNREFUSED' });
      expect(record.errorDetails).not.toHaveProperty('stack');
    } finally {
      child.kill('SIGKILL');
    }
  }, 15_000);

  it.each(['uncaught_exception', 'unhandled_rejection'] as const)(
    'on a fatal %s when run directly: logs it, runs every shutdown step, and exits 1',
    async (fault) => {
      const port = await findFreePort();
      await stubValidEnv(port);
      vi.stubEnv('LOG_LEVEL', 'info');
      vi.stubEnv('HELMRUN_TEST_FAULT', fault);
      const apiRoot = resolve(import.meta.dirname, '..');
      const child = spawn(
        process.execPath,
        [
          '--conditions=@helmrun/source',
          '--import',
          'tsx',
          '--import',
          resolve(apiRoot, 'test/support/fault-injection.ts'),
          resolve(apiRoot, 'src/main.ts'),
        ],
        { cwd: apiRoot, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });

      try {
        await vi.waitFor(() => {
          expect(output).toContain('http_server_listening');
        }, 10_000);

        const exited = once(child, 'exit');
        child.kill('SIGUSR2');
        const [code] = (await exited) as [number | null];

        expect(code).toBe(1);
        expect(output).toContain('"event":"process_fatal_error"');
        expect(output).toContain(`"fatalEventType":"${fault}"`);
        expect(output).toContain('"step":"http_server"');
        expect(output).toContain('"step":"database_pool"');
        expect(output).toContain('"step":"redis"');
        expect(output).toContain('shutdown_completed');
        expect(output).not.toContain('shutdown_deadline_exceeded');
      } finally {
        child.kill('SIGKILL');
      }
    },
    15_000,
  );

  it('does not install process-wide handlers when started from a test', async () => {
    const port = await findFreePort();
    await stubValidEnv(port);
    const before = process.listenerCount('SIGTERM');
    const { startServer } = await import('./main.js');
    const { server, requestShutdown } = startServer(createFakeProcess());

    try {
      await once(server, 'listening');

      expect(process.listenerCount('SIGTERM')).toBe(before);
    } finally {
      await requestShutdown(SIGTERM);
    }
  });

  it('stops listening and sets exit code 0 when shutdown is requested', async () => {
    const port = await findFreePort();
    await stubValidEnv(port);
    const processTarget = createFakeProcess();
    const { startServer } = await import('./main.js');
    const { server, requestShutdown } = startServer(processTarget);
    await once(server, 'listening');

    await requestShutdown(SIGTERM);

    expect(server.listening).toBe(false);
    expect(processTarget.exitCode).toBe(0);
    expect(processTarget.exit).not.toHaveBeenCalled();
  });

  it('exits with code 1 and reports field names (not values) when config is invalid', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', 'mysql://user:secret-db-password@127.0.0.1/app');
    vi.stubEnv('PORT', '70000');
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as typeof process.exit);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { startServer } = await import('./main.js');

    expect(() => startServer()).toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledWith(1);

    const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
    const record = JSON.parse(output) as { event: string; issues: { field: string }[] };

    expect(record.event).toBe('config_invalid');
    expect(record.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'PORT']),
    );
    expect(output).not.toContain('secret-db-password');
  });
});
