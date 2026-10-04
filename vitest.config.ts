import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Integration tests read TEST_* variables. Load them once here so every way of
// running tests (root, filtered workspace, IDE) sees the same environment.
const testEnvFile = resolve(import.meta.dirname, '.env.test');
if (existsSync(testEnvFile)) process.loadEnvFile(testEnvFile);

// Resolve workspace packages to their TypeScript source (see tsconfig.base.json),
// keeping Vite's default conditions so npm packages resolve normally.
const conditions = ['@helmrun/source', ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    environment: 'node',
    isolate: true,
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    testTimeout: 5_000,
    projects: [
      {
        extends: true,
        test: {
          // Unit and API tests sit next to the code they test.
          name: 'unit',
          include: ['{apps,packages}/*/src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          // Real Postgres/Redis from docker-compose.test.yml. Files run one at a
          // time because they share one test database.
          name: 'integration',
          include: ['{apps,packages}/*/test/integration/**/*.test.ts'],
          fileParallelism: false,
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
