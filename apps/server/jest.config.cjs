/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    // Unit tests
    '**/__tests__/**/*.unit.test.ts',
    '**/src/**/*.unit.test.ts',
    // Integration tests
    '**/tests/integration/**/*.integration.test.ts',
    // E2E tests
    '**/tests/e2e/**/*.e2e.test.ts',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/app/test/setup.ts'],
  globalTeardown: '<rootDir>/src/app/test/teardown.ts',
  maxWorkers: 1,
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/app/$1',
    '^@domain/(.*)$': '<rootDir>/src/domain/$1',
    '^@infra/(.*)$': '<rootDir>/src/infra/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },

  // Coverage configuration
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/**/__tests__/**',
    '!src/**/test/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './src/domain/': {
      branches: 75,
      functions: 85,
      lines: 85,
      statements: 85,
    },
    './src/infra/': {
      branches: 65,
      functions: 75,
      lines: 75,
      statements: 75,
    },
  },

  // Test timeouts
  testTimeout: 30000, // 30 seconds for all tests

  // Error handling
  bail: false, // Don't stop on first failure
  verbose: true,

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
  ],

  // Module directories
  moduleDirectories: ['node_modules', 'src'],
};


