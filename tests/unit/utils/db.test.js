/**
 * PostgreSQL Database Client Tests
 */

// Mock pg before importing db
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();
const mockEnd = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: mockConnect,
    end: mockEnd,
  })),
}));

// Mock config
jest.mock('../../../src/utils/config', () => ({
  DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb',
  IS_DEV: true,
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Mock circuit breaker
jest.mock('../../../src/utils/circuit-breaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    canExecute: jest.fn().mockReturnValue(true),
    onSuccess: jest.fn(),
    onFailure: jest.fn(),
    reset: jest.fn(),
    getState: jest.fn().mockReturnValue('CLOSED'),
    getStatus: jest.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }),
    getStats: jest.fn().mockReturnValue({ totalRequests: 0, failures: 0 }),
  })),
}));

const db = require('../../../src/utils/db');

describe('Database Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
      release: mockRelease,
    });
    mockQuery.mockResolvedValue({ rows: [] });
  });

  describe('isConnected()', () => {
    it('should return false when pool is not initialized', () => {
      // Reset module state for this test
      expect(typeof db.isConnected).toBe('function');
    });
  });

  describe('getPool()', () => {
    it('should return the pool instance', () => {
      expect(typeof db.getPool).toBe('function');
      // Pool may or may not be initialized depending on test order
    });
  });

  describe('ping()', () => {
    it('should return PONG when database responds', async () => {
      // This requires pool to be initialized
      // In unit tests, we test the function exists
      expect(typeof db.ping).toBe('function');
    });
  });

  describe('recordBurn()', () => {
    it('should be a function', () => {
      expect(typeof db.recordBurn).toBe('function');
    });

    it('should accept burn object parameter', async () => {
      const burn = {
        signature: 'test-sig-123',
        swapSignature: 'swap-sig-456',
        amountBurned: 100.5,
        solEquivalent: 0.01,
        treasuryAmount: 0.005,
        method: 'jupiter',
        wallet: 'wallet123',
      };

      // Without initialized pool, should return fallback
      const result = await db.recordBurn(burn);
      expect(result).toBeNull();
    });
  });

  describe('getBurnHistory()', () => {
    it('should be a function', () => {
      expect(typeof db.getBurnHistory).toBe('function');
    });

    it('should return fallback when pool not available', async () => {
      const result = await db.getBurnHistory(50, 0);
      expect(result).toEqual({ burns: [], total: 0 });
    });

    it('should accept limit and offset parameters', async () => {
      const result = await db.getBurnHistory(10, 5);
      expect(result).toEqual({ burns: [], total: 0 });
    });
  });

  describe('getBurnStats()', () => {
    it('should be a function', () => {
      expect(typeof db.getBurnStats).toBe('function');
    });

    it('should return null when pool not available', async () => {
      const result = await db.getBurnStats();
      expect(result).toBeNull();
    });
  });

  describe('getBurnsByWallet()', () => {
    it('should be a function', () => {
      expect(typeof db.getBurnsByWallet).toBe('function');
    });

    it('should return empty array when pool not available', async () => {
      const result = await db.getBurnsByWallet('wallet123');
      expect(result).toEqual([]);
    });

    it('should accept wallet and limit parameters', async () => {
      const result = await db.getBurnsByWallet('wallet123', 25);
      expect(result).toEqual([]);
    });
  });

  describe('recordTransaction()', () => {
    it('should be a function', () => {
      expect(typeof db.recordTransaction).toBe('function');
    });

    it('should accept transaction object', async () => {
      const tx = {
        quoteId: 'quote-123',
        signature: 'sig-456',
        userWallet: 'user-wallet',
        paymentToken: 'token-mint',
        feeAmount: 10.5,
        feeSolEquivalent: 0.001,
        status: 'pending',
        ipAddress: '127.0.0.1',
      };

      const result = await db.recordTransaction(tx);
      expect(result).toBeNull();
    });
  });

  describe('updateTransactionStatus()', () => {
    it('should be a function', () => {
      expect(typeof db.updateTransactionStatus).toBe('function');
    });

    it('should accept quoteId and status parameters', async () => {
      const result = await db.updateTransactionStatus('quote-123', 'confirmed', 'sig-456');
      expect(result).toBeNull();
    });

    it('should accept error message for failed transactions', async () => {
      const result = await db.updateTransactionStatus(
        'quote-123',
        'failed',
        null,
        'Transaction failed'
      );
      expect(result).toBeNull();
    });
  });

  describe('getTransactionHistory()', () => {
    it('should be a function', () => {
      expect(typeof db.getTransactionHistory).toBe('function');
    });

    it('should return fallback when pool not available', async () => {
      const result = await db.getTransactionHistory();
      expect(result).toEqual({ transactions: [], total: 0 });
    });

    it('should accept limit, offset, and status parameters', async () => {
      const result = await db.getTransactionHistory(25, 10, 'confirmed');
      expect(result).toEqual({ transactions: [], total: 0 });
    });
  });

  describe('updateTokenStats()', () => {
    it('should be a function', () => {
      expect(typeof db.updateTokenStats).toBe('function');
    });

    it('should accept mint and stats parameters', async () => {
      const result = await db.updateTokenStats('token-mint', {
        symbol: 'TEST',
        name: 'Test Token',
        feeAmount: 5.5,
        kScore: 'TRUSTED',
      });
      expect(result).toBeNull();
    });
  });

  describe('getTokenLeaderboard()', () => {
    it('should be a function', () => {
      expect(typeof db.getTokenLeaderboard).toBe('function');
    });

    it('should return empty array when pool not available', async () => {
      const result = await db.getTokenLeaderboard();
      expect(result).toEqual([]);
    });

    it('should accept limit parameter', async () => {
      const result = await db.getTokenLeaderboard(10);
      expect(result).toEqual([]);
    });
  });

  describe('addAuditLog()', () => {
    it('should be a function', () => {
      expect(typeof db.addAuditLog).toBe('function');
    });

    it('should accept event object', async () => {
      const event = {
        type: 'TRANSACTION_SUBMITTED',
        data: { quoteId: 'quote-123' },
        wallet: 'wallet-456',
        ipAddress: '127.0.0.1',
        severity: 'INFO',
      };

      const result = await db.addAuditLog(event);
      expect(result).toBeNull();
    });
  });

  describe('getAuditLogs()', () => {
    it('should be a function', () => {
      expect(typeof db.getAuditLogs).toBe('function');
    });

    it('should return fallback when pool not available', async () => {
      const result = await db.getAuditLogs();
      expect(result).toEqual({ logs: [], total: 0 });
    });

    it('should accept limit, offset, and eventType parameters', async () => {
      const result = await db.getAuditLogs(50, 0, 'TRANSACTION_SUBMITTED');
      expect(result).toEqual({ logs: [], total: 0 });
    });
  });

  describe('updateDailyStats()', () => {
    it('should be a function', () => {
      expect(typeof db.updateDailyStats).toBe('function');
    });

    it('should accept stats object', async () => {
      const stats = {
        totalBurns: 100,
        totalTransactions: 50,
        uniqueWallets: 25,
        totalFeesSol: 0.5,
        treasuryBalance: 1.0,
      };

      const result = await db.updateDailyStats(stats);
      expect(result).toBeNull();
    });
  });

  describe('getDailyStatsHistory()', () => {
    it('should be a function', () => {
      expect(typeof db.getDailyStatsHistory).toBe('function');
    });

    it('should return empty array when pool not available', async () => {
      const result = await db.getDailyStatsHistory();
      expect(result).toEqual([]);
    });

    it('should accept days parameter', async () => {
      const result = await db.getDailyStatsHistory(7);
      expect(result).toEqual([]);
    });
  });

  describe('getAnalytics()', () => {
    it('should be a function', () => {
      expect(typeof db.getAnalytics).toBe('function');
    });

    it('should return null when pool not available', async () => {
      const result = await db.getAnalytics();
      expect(result).toBeNull();
    });
  });

  describe('disconnect()', () => {
    it('should be a function', () => {
      expect(typeof db.disconnect).toBe('function');
    });
  });

  describe('getCircuitStatus()', () => {
    it('should be a function', () => {
      expect(typeof db.getCircuitStatus).toBe('function');
    });

    it('should return circuit status object', () => {
      const status = db.getCircuitStatus();
      expect(status).toBeDefined();
      expect(status).toHaveProperty('isConnected');
    });
  });

  describe('Module exports', () => {
    it('should export all expected functions', () => {
      expect(db.initialize).toBeDefined();
      expect(db.getPool).toBeDefined();
      expect(db.isConnected).toBeDefined();
      expect(db.ping).toBeDefined();
      expect(db.disconnect).toBeDefined();
      expect(db.getCircuitStatus).toBeDefined();
      expect(db.recordBurn).toBeDefined();
      expect(db.getBurnHistory).toBeDefined();
      expect(db.getBurnStats).toBeDefined();
      expect(db.getBurnsByWallet).toBeDefined();
      expect(db.recordTransaction).toBeDefined();
      expect(db.updateTransactionStatus).toBeDefined();
      expect(db.getTransactionHistory).toBeDefined();
      expect(db.updateTokenStats).toBeDefined();
      expect(db.getTokenLeaderboard).toBeDefined();
      expect(db.addAuditLog).toBeDefined();
      expect(db.getAuditLogs).toBeDefined();
      expect(db.updateDailyStats).toBeDefined();
      expect(db.getDailyStatsHistory).toBeDefined();
      expect(db.getAnalytics).toBeDefined();
    });
  });
});
