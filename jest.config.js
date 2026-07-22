process.env.NODE_ENV = 'test';
// Quiet the per-request `http`-level access logs during test runs so
// jest's console-log passthrough doesn't drown out test results; explicit
// `console.log`s from tests themselves (e.g. the concurrency PASS/FAIL line)
// still show.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: ['src/**/*.ts', 'config/**/*.ts'],
  coverageDirectory: 'coverage',
  // Integration tests share one real, mutable Postgres/Redis instance across
  // files (the same seeded users' carts/orders, etc.) - running files in
  // parallel would make them race each other. Serial execution trades some
  // wall-clock time for deterministic, non-flaky test runs.
  maxWorkers: 1,
};
