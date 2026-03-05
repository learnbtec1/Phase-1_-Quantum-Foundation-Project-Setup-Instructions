/** @type {import('jest').Config} */
const nextJest = require('next/jest');
const createJestConfig = nextJest({ dir: __dirname });
const config = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!**/*.d.ts'],
};
module.exports = createJestConfig(config);
