import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import pluginImport from 'eslint-plugin-import';

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
    plugins: { boundaries, import: pluginImport },
    settings: {
      // Define architectural layers by file location
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app/**' },
        { type: 'domain', pattern: 'src/domain/**' },
        // Dedicated DI layer inside infra (matches first)
        { type: 'infra-di', pattern: 'src/infra/di/**' },
        // Generic infra (implementations)
        { type: 'infra', pattern: 'src/infra/**' },
        // Configuration (global, importable by all; config itself imports nothing)
        { type: 'config', pattern: 'src/config/**' },
        // Shared utilities available to all layers
        { type: 'shared', pattern: 'src/shared/**' },
        // Main/composition root (manages DI and lifecycle)
        { type: 'main', pattern: 'src/main/**' },
        { type: 'test', pattern: '**/{__tests__,tests}/**' },
      ],
      // Import resolver settings
      'import/resolver': {
        typescript: { 
          project: './tsconfig.json',
          alwaysTryTypes: true
        },
        node: { extensions: ['.ts', '.js'] }
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          // Forbid underscore escape hatch in production code
          argsIgnorePattern: '(^$)',
          varsIgnorePattern: '(^$)',
          caughtErrorsIgnorePattern: '(^$)',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      '@typescript-eslint/no-empty-function': 'off',
      
      // General code quality rules
      'no-console': 'error', // Disallow console.log in production code
      'no-debugger': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
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

      // Architectural boundaries (strict by default)
      'boundaries/no-unknown': 'error',
      'boundaries/element-types': ['error', {
        default: 'disallow',
        message: 'Import boundary violation: {from} → {to} is not allowed',
        rules: [
          // app → domain, shared, config (no infra direct imports)
          { from: 'app', allow: ['domain', 'shared', 'config'] },
          // main → all layers (composition root)
          { from: 'main', allow: ['domain', 'infra', 'infra-di', 'app', 'shared', 'config'] },
          // infra → domain, shared, config
          { from: 'infra', allow: ['domain', 'shared', 'config'] },
          // domain → shared, config only
          { from: 'domain', allow: ['shared', 'config'] },
          // config → nothing
          { from: 'config', allow: [] },
        ],
      }],

      // Enforce alias usage instead of parent relative imports
      // 'import/no-relative-parent-imports': 'error', // Too strict - blocks aliases
      // Fallback ban using glob patterns (works regardless of resolver quirks)
        'no-restricted-imports': ['error', {
          patterns: [
            { group: ['../**'], message: 'Use aliases instead of parent relative imports' },
            { group: ['@main/**'], message: 'Do not import main from other layers' }
          ]
        }],
      
      // Import organization and sorting
      'import/order': ['error', {
        'groups': [
          'builtin',           // Node.js built-in modules
          'external',          // npm packages
          'internal',          // Internal modules (aliases)
          'parent',            // Parent directory imports
          'sibling',           // Same directory imports
          'index'              // Index file imports
        ],
        'pathGroups': [
          {
            'pattern': '@app/**',
            'group': 'internal',
            'position': 'before'
          },
          {
            'pattern': '@domain/**',
            'group': 'internal',
            'position': 'before'
          },
          {
            'pattern': '@infra/**',
            'group': 'internal',
            'position': 'before'
          },
          {
            'pattern': '@config/**',
            'group': 'internal',
            'position': 'before'
          },
          {
            'pattern': '@shared/**',
            'group': 'internal',
            'position': 'before'
          }
        ],
        'pathGroupsExcludedImportTypes': ['builtin'],
        'newlines-between': 'always',
        'alphabetize': {
          'order': 'asc',
          'caseInsensitive': true
        }
      }],
      
      // Ensure imports are sorted within groups
      'sort-imports': ['error', {
        'ignoreCase': true,
        'ignoreDeclarationSort': true, // Let import/order handle this
        'ignoreMemberSort': false,
        'memberSyntaxSortOrder': ['none', 'all', 'multiple', 'single']
      }],
    },
  },
  // Relaxed rules for test files
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts', '**/tests/**/*.ts', '**/test/**/*.ts'],
    rules: {
      // Boundaries relaxed in tests
      'boundaries/no-unknown': 'warn',
      'boundaries/element-types': 'warn',
      // Allow relative imports in tests for pragmatic testing
      'import/no-relative-parent-imports': 'off',
      'no-restricted-imports': 'off',
      // Relax import ordering in tests
      'import/order': 'warn',
      'sort-imports': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn', // Allow any in tests but warn
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off', // Allow type assertions in tests
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
      'no-console': 'off', // Allow console.log in tests
    },
  },
  // Composition root: allow wiring infra in main (not in app)
  {
    files: ['src/main/**'],
    rules: {
      'boundaries/no-unknown': 'off',
      'boundaries/element-types': 'off',
      'no-restricted-imports': 'off', // Allow main to import from anywhere
    },
  },
  // Entry point: allow importing from main
  {
    files: ['src/index.ts'],
    rules: {
      'no-restricted-imports': 'off', // Allow entry point to import from main
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
