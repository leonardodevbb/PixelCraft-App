import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'dist-electron', 'release', 'node_modules', 'build-flatpak', '.flatpak-builder', 'test-results', 'playwright-report'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-control-regex': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
