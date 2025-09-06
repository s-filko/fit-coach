import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      
      // General code quality rules
      'no-console': 'off', // Allow console.log for debugging
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-template': 'off', // We use string concatenation for prompts
      
      'complexity': ['warn', 10],
      'max-lines-per-function': ['warn', 50],
      'no-magic-numbers': ['warn', {
        ignore: [0, 1, -1],
        ignoreArrayIndexes: true,
        enforceConst: true
      }],
      'camelcase': ['error', { properties: 'never' }],
      'max-len': ['error', { code: 120, ignoreUrls: true, ignoreStrings: true }],
      'no-multiple-empty-lines': ['error', { max: 1 }],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'curly': ['error', 'all'],
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-prototype-builtins': 'error',
      'no-duplicate-imports': 'error',
      'no-unused-expressions': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-loop-func': 'error',

      // TypeScript rules requiring type info
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error', 
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',

      // Security rules
      'no-alert': 'error',

      // Code quality rules
      'prefer-destructuring': 'error',
      'no-nested-ternary': 'error',
      'no-unneeded-ternary': 'error',
      'prefer-spread': 'error',
      'prefer-rest-params': 'error',

      // Style rules
      'array-bracket-spacing': ['error', 'never'],
      'object-curly-spacing': ['error', 'always'],
      'space-before-function-paren': ['warn', 'never'],

      // Stricter existing rules
      'max-depth': ['warn', 4],
      'max-params': ['warn', 5],
      'max-statements': ['warn', 20],
    },
  },
  // Relaxed rules for test files
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn', // Allow any in tests but warn
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'warn', // More lenient for tests
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/restrict-plus-operands': 'warn',
      'max-lines-per-function': 'off',
      'complexity': 'off',
      'no-magic-numbers': 'off',
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      '*.js',
      '*.d.ts',
      'jest.config.cjs',
    ],
  }
);