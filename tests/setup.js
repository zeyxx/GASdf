// Jest setup file
// Global mocks and test configuration

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.HELIUS_API_KEY = 'test-helius-key';
// PLACEHOLDER - not a real key, tests mock the signer
process.env.FEE_PAYER_PRIVATE_KEY = 'TEST_PRIVATE_KEY_PLACEHOLDER_NOT_REAL';
process.env.ASDF_MINT = 'ASdfTest111111111111111111111111111111111111';
process.env.REDIS_URL = ''; // Force memory fallback

// Suppress console during tests unless DEBUG=true
if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    // Keep error for debugging failed tests
    error: console.error,
  };
}

// Global test utilities
global.waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});

// Ensure all timers are cleared after all tests
afterAll(() => {
  jest.useRealTimers();
});
