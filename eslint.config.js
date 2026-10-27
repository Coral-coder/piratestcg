import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'tools/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The engine must stay pure and deterministic.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in rng.ts.' },
        { object: 'Math', property: 'sin', message: 'Use dsin from dmath.ts (cross-engine determinism).' },
        { object: 'Math', property: 'cos', message: 'Use dcos from dmath.ts.' },
        { object: 'Math', property: 'atan2', message: 'Use datan2 from dmath.ts.' },
        { object: 'Date', property: 'now', message: 'No wall clock in the engine.' },
        { object: 'performance', property: 'now', message: 'No wall clock in the engine.' },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage'],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'No wall clock in the engine.' },
        { selector: "ForInStatement", message: 'Use ordered iteration (arrays) in the engine.' },
      ],
    },
  },
);
