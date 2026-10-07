import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isEntryPoint } from './entry-point.js';

describe('isEntryPoint', () => {
  let directory: string;
  let moduleFile: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'entry-point-')));
    moduleFile = join(directory, 'main.js');
    writeFileSync(moduleFile, '');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('returns false when there is no entry path', () => {
    expect(isEntryPoint(moduleFile, undefined)).toBe(false);
  });

  it('returns false when the entry path does not exist', () => {
    expect(isEntryPoint(moduleFile, join(directory, 'missing.js'))).toBe(false);
  });

  it('returns true when the entry path is the module file', () => {
    expect(isEntryPoint(moduleFile, moduleFile)).toBe(true);
  });

  it('returns true when the entry path is a symlink to the module file', () => {
    const link = join(directory, 'link.js');
    symlinkSync(moduleFile, link);

    expect(isEntryPoint(moduleFile, link)).toBe(true);
  });

  it('returns true when the entry path is the module file without its extension', () => {
    expect(isEntryPoint(moduleFile, join(directory, 'main'))).toBe(true);
  });

  it('returns false when neither the entry path nor it plus the extension exists', () => {
    expect(isEntryPoint(moduleFile, join(directory, 'missing'))).toBe(false);
  });

  it('returns false when the entry path is a different real file', () => {
    const otherFile = join(directory, 'other.js');
    writeFileSync(otherFile, '');

    expect(isEntryPoint(moduleFile, otherFile)).toBe(false);
  });

  it('resolves a relative entry path from the current directory', () => {
    const relativePath = relative(process.cwd(), moduleFile);

    expect(isEntryPoint(moduleFile, relativePath)).toBe(true);
  });
});
