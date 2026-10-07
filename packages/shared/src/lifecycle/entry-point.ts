import { realpathSync } from 'node:fs';
import { extname } from 'node:path';

const resolvesTo = (path: string, moduleFilename: string): boolean => {
  try {
    return realpathSync(path) === moduleFilename;
  } catch {
    return false;
  }
};

export const isEntryPoint = (
  moduleFilename: string,
  entryPath: string | undefined = process.argv[1],
): boolean => {
  if (entryPath === undefined) return false;

  return (
    resolvesTo(entryPath, moduleFilename) ||
    resolvesTo(`${entryPath}${extname(moduleFilename)}`, moduleFilename)
  );
};
