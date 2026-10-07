// @ts-check

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const envAccess = [
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message: "Read process.env only in an app's src/config.ts or in packages/config.",
  },
  {
    selector: "MemberExpression[object.name='process'][computed=true][property.value='env']",
    message: "Read process.env only in an app's src/config.ts or in packages/config.",
  },
];

// Relative imports must stay inside their own workspace. Code in another
// workspace is reached through its package name, so `exports` decides what's public.
const helmrunApps = [
  '@helmrun/api',
  '@helmrun/api/*',
  '@helmrun/scheduler',
  '@helmrun/scheduler/*',
  '@helmrun/worker',
  '@helmrun/worker/*',
];

const crossWorkspaceRelative = {
  group: ['**/apps/**', '**/packages/**'],
  message: 'Import other workspaces by package name (@helmrun/...), not by relative path.',
};

export default defineConfig(
  {
    // Generated files and installed dependencies are not source code.
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  {
    // Check JavaScript configuration files without requiring TypeScript project data.
    files: ['**/*.js'],
    extends: [js.configs.recommended],
  },
  {
    // Typed rules can detect promise and value-safety bugs that syntax-only rules miss.
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // Each file is checked with the nearest workspace tsconfig. Config files
        // outside any workspace tsconfig use a default project.
        projectService: {
          allowDefaultProject: ['vitest.config.ts', 'apps/*/vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A forgotten promise can reject later without reaching the intended error path.
      '@typescript-eslint/no-floating-promises': 'error',
      // Async callbacks are unsafe where the caller expects a synchronous result.
      '@typescript-eslint/no-misused-promises': 'error',
      // Type-only imports should disappear clearly when TypeScript emits JavaScript.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-restricted-imports': ['error', { patterns: [crossWorkspaceRelative] }],
    },
  },
  {
    // Dependency direction: packages never import apps.
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            crossWorkspaceRelative,
            {
              group: helmrunApps,
              message: 'Packages must not import apps. Move shared code into a package.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            crossWorkspaceRelative,
            {
              group: helmrunApps,
              message: 'Apps must not import other apps. Move shared code into a package.',
            },
          ],
        },
      ],
    },
  },
  {
    // Keep untrusted environment access at one explicit configuration boundary per app.
    files: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
    ignores: ['apps/*/src/config.ts', 'packages/config/src/**'],
    rules: {
      'no-restricted-syntax': ['error', ...envAccess],
    },
  },
);
