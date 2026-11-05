module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: ['relay-gateway/src/**/*.ts'],
  coveragePathIgnorePatterns: ['/node_modules/'],
  testMatch: ['relay-gateway/src/**/*.test.ts'],
  
  testTimeout: 15000,
  verbose: true,
  forceExit: true,
  // Ignore the packages directory (has its own tests)
  testPathIgnorePatterns: ['/node_modules/', '/packages/'],
  // Coverage thresholds - CI will fail if below these values
  coverageThreshold: {
    global: {
      statements: 55,
      branches: 45,
      functions: 50,
      lines: 55,
    },
  },
};
