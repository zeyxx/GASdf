module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.js',
    'sdk/**/*.js',
    '!src/index.js',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
  ],
  testMatch: [
    '**/tests/**/*.test.js',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 15000,
  verbose: true,
  forceExit: true,
  // Ignore the packages directory (has its own tests)
  testPathIgnorePatterns: [
    '/node_modules/',
    '/packages/',
  ],
};
