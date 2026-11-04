// Lint rules: typescript-eslint's recommended set on the app and the tests.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.iwsdk/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    files: ['test/e2e/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        DOMPointReadOnly: 'readonly',
        XRRigidTransform: 'readonly',
        process: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
        innerWidth: 'readonly',
        innerHeight: 'readonly',
      },
    },
  },
);
