import { realpathSync } from 'node:fs';

// Whether the module at `moduleFilename` (pass `import.meta.filename`) is the
// file Node was started with, so main.ts starts the process only when run
// directly, never when a test imports it. `import.meta.main` is undefined under
// tsx, which `pnpm dev` uses, so compare the entry path instead (resolved:
// argv[1] may be relative or go through a symlink).
export const isEntryPoint = (
  moduleFilename: string,
  entryPath: string | undefined = process.argv[1],
): boolean => {
  if (entryPath === undefined) return false;

  try {
    return realpathSync(entryPath) === moduleFilename;
  } catch {
    // Not a real file (a wrapper, or a path without its extension): then this
    // module isn't the entry point.
    return false;
  }
};
