import { describe, expect, it, vi } from 'vitest';

import { environmentEnvSchema } from './environment.js';
import { loadConfigOrExit } from './load.js';

const createFakeProcess = () => {
  const stderr = { write: vi.fn<(chunk: string) => unknown>() };
  const exit = vi.fn<(code: number) => never>(() => {
    throw new Error('process.exit called');
  });

  return { stderr, exit };
};

describe('loadConfigOrExit', () => {
  it('returns the loaded config without writing or exiting', () => {
    const processTarget = createFakeProcess();
    const config = { environment: 'test' };

    const result = loadConfigOrExit('test-service', () => config, processTarget);

    expect(result).toBe(config);
    expect(processTarget.stderr.write).not.toHaveBeenCalled();
    expect(processTarget.exit).not.toHaveBeenCalled();
  });

  it('writes one FATAL config_invalid line without the rejected value and exits 1', () => {
    const processTarget = createFakeProcess();
    const secret = 'sk-live-secret-looking-value';
    const load = () => environmentEnvSchema.parse({ NODE_ENV: secret });

    expect(() => loadConfigOrExit('test-service', load, processTarget)).toThrow(
      'process.exit called',
    );

    expect(processTarget.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(processTarget.stderr.write).toHaveBeenCalledOnce();
    const output = String(processTarget.stderr.write.mock.calls[0]?.[0]);
    expect(output.endsWith('\n')).toBe(true);
    expect(output.trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(output)).toEqual({
      severity: 'FATAL',
      service: 'test-service',
      event: 'config_invalid',
      issues: [{ field: 'NODE_ENV', reason: 'NODE_ENV must be development, test, or production' }],
      msg: 'Invalid configuration; refusing to start',
    });
    expect(output).not.toContain(secret);
  });

  it('rethrows a non-Zod error as-is without writing or exiting', () => {
    const processTarget = createFakeProcess();
    const bug = new Error('not a validation error');

    expect(() =>
      loadConfigOrExit(
        'test-service',
        () => {
          throw bug;
        },
        processTarget,
      ),
    ).toThrow(bug);

    expect(processTarget.stderr.write).not.toHaveBeenCalled();
    expect(processTarget.exit).not.toHaveBeenCalled();
  });
});
