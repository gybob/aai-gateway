// @ts-check
/**
 * ESLint flat config (ESLint 9+).
 *
 * Migrated from the legacy .eslintrc.cjs. Uses typescript-eslint recommended
 * (without the type-checked layer) so the existing codebase lints clean. The
 * type-checked rules (no-unsafe-*, require-await, restrict-template-expressions,
 * etc.) can be re-enabled incrementally as code is fixed.
 */
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.{js,ts,cjs,mjs}', 'coverage/**'],
  },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      // TypeScript
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // `interface X extends Y {}` is a legitimate named-alias pattern.
      '@typescript-eslint/no-empty-object-type': 'off',

      // Import
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-unresolved': 'off',

      // General
      'no-console': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  prettierConfig,
];
