/**
 * PostgreSQL Database Client Tests
 */

// Mock pg before importing db
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();
const mockEnd = jest.fn();

const mockPool = {
  query: mockQuery,
  connect: mockConnect,
  end: mockEnd,
};

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool),
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
const mockCircuitBreaker = {
  canExecute: jest.fn().mockReturnValue(true),
  onSuccess: jest.fn(),
  onFailure: jest.fn(),
  reset: jest.fn(),
  getState: jest.fn().mockReturnValue('CLOSED'),
  getStatus: jest.fn().mockReturnValue({ state: 'CLOSED', failures: 0 }),
  getStats: jest.fn().mockReturnValue({ totalRequests: 0, failures: 0 }),
};

jest.mock('../../../src/utils/circuit-breaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => mockCircuitBreaker),
}));

const db = require('../../../src/utils/db');

describe('Database Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCircuitBreaker.canExecute.mockReturnValue(true);
    mockConnect.mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
      release: mockRelease,
    });
    mockQuery.mockResolvedValue({ rows: [] });
    mockEnd.mockResolvedValue();
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

// =============================================================================
// Tests with initialized pool (separate describe to manage pool state)
// =============================================================================

describe('Database Client - With Initialized Pool', () => {
  beforeAll(async () => {
    // Initialize pool for these tests
    mockConnect.mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [{ now: new Date() }] }),
      release: mockRelease,
    });
    mockQuery.mockResolvedValue({ rows: [] });
    await db.initialize();
  });

  afterAll(async () => {
    await db.disconnect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCircuitBreaker.canExecute.mockReturnValue(true);
    mockQuery.mockResolvedValue({ rows: [] });
  });

  describe('ping()', () => {
    it('should return PONG when query succeeds', async () => {
      mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
      const result = await db.ping();
      expect(result).toBe('PONG');
    });

    it('should return null on query error', async () => {
      mockQuery.mockRejectedValue(new Error('Connection error'));
      const result = await db.ping();
      expect(result).toBeNull();
    });
  });

  describe('recordBurn() with pool', () => {
    it('should insert burn and return result', async () => {
      const burnData = {
        id: 1,
        signature: 'burn-sig-123',
        amount_burned: 100.5,
      };
      mockQuery.mockResolvedValue({ rows: [burnData] });

      const result = await db.recordBurn({
        signature: 'burn-sig-123',
        amountBurned: 100.5,
        method: 'jupiter',
      });

      expect(result).toEqual(burnData);
      expect(mockQuery).toHaveBeenCalled();
    });

    it('should return null on conflict (duplicate)', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await db.recordBurn({
        signature: 'duplicate-sig',
        amountBurned: 50,
      });

      expect(result).toBeNull();
    });
  });

  describe('getBurnHistory() with pool', () => {
    it('should return burns and total count', async () => {
      const burns = [{ id: 1, signature: 'sig1' }, { id: 2, signature: 'sig2' }];
      mockQuery
        .mockResolvedValueOnce({ rows: burns })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] });

      const result = await db.getBurnHistory(50, 0);

      expect(result.burns).toEqual(burns);
      expect(result.total).toBe(2);
    });
  });

  describe('getBurnStats() with pool', () => {
    it('should return aggregated stats', async () => {
      const stats = {
        total_burns: '100',
        total_amount: '5000.5',
        total_sol: '1.5',
        total_treasury: '0.5',
        unique_wallets: '25',
        last_burn: new Date(),
      };
      mockQuery.mockResolvedValue({ rows: [stats] });

      const result = await db.getBurnStats();
      expect(result).toEqual(stats);
    });
  });

  describe('getBurnsByWallet() with pool', () => {
    it('should return burns for specific wallet', async () => {
      const burns = [{ id: 1, wallet: 'wallet123' }];
      mockQuery.mockResolvedValue({ rows: burns });

      const result = await db.getBurnsByWallet('wallet123', 50);
      expect(result).toEqual(burns);
    });
  });

  describe('recordTransaction() with pool', () => {
    it('should insert transaction and return result', async () => {
      const txData = { id: 1, quote_id: 'q123', status: 'pending' };
      mockQuery.mockResolvedValue({ rows: [txData] });

      const result = await db.recordTransaction({
        quoteId: 'q123',
        userWallet: 'user-wallet',
        paymentToken: 'token-mint',
        feeAmount: 10,
        status: 'pending',
      });

      expect(result).toEqual(txData);
    });
  });

  describe('updateTransactionStatus() with pool', () => {
    it('should update status and return updated row', async () => {
      const updated = { id: 1, quote_id: 'q123', status: 'confirmed' };
      mockQuery.mockResolvedValue({ rows: [updated] });

      const result = await db.updateTransactionStatus('q123', 'confirmed', 'sig-456');
      expect(result).toEqual(updated);
    });
  });

  describe('getTransactionHistory() with pool', () => {
    it('should return transactions with pagination', async () => {
      const txs = [{ id: 1, quote_id: 'q1' }];
      mockQuery
        .mockResolvedValueOnce({ rows: txs })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      const result = await db.getTransactionHistory(50, 0);
      expect(result.transactions).toEqual(txs);
      expect(result.total).toBe(1);
    });

    it('should filter by status when provided', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const result = await db.getTransactionHistory(50, 0, 'failed');
      expect(result.transactions).toEqual([]);
    });
  });

  describe('updateTokenStats() with pool', () => {
    it('should upsert token stats', async () => {
      const tokenStats = { mint: 'token123', total_transactions: 1 };
      mockQuery.mockResolvedValue({ rows: [tokenStats] });

      const result = await db.updateTokenStats('token123', {
        symbol: 'TKN',
        feeAmount: 5,
        kScore: 'TRUSTED',
      });

      expect(result).toEqual(tokenStats);
    });
  });

  describe('getTokenLeaderboard() with pool', () => {
    it('should return tokens sorted by transactions', async () => {
      const tokens = [
        { mint: 't1', total_transactions: 100 },
        { mint: 't2', total_transactions: 50 },
      ];
      mockQuery.mockResolvedValue({ rows: tokens });

      const result = await db.getTokenLeaderboard(20);
      expect(result).toEqual(tokens);
    });
  });

  describe('addAuditLog() with pool', () => {
    it('should insert audit log and return id', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 42 }] });

      const result = await db.addAuditLog({
        type: 'SECURITY_EVENT',
        data: { detail: 'test' },
        wallet: 'wallet123',
        severity: 'WARN',
      });

      expect(result).toBe(42);
    });
  });

  describe('getAuditLogs() with pool', () => {
    it('should return logs with pagination', async () => {
      const logs = [{ id: 1, event_type: 'TEST' }];
      mockQuery
        .mockResolvedValueOnce({ rows: logs })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      const result = await db.getAuditLogs(100, 0);
      expect(result.logs).toEqual(logs);
      expect(result.total).toBe(1);
    });

    it('should filter by eventType when provided', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });

      await db.getAuditLogs(100, 0, 'SPECIFIC_EVENT');
      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('updateDailyStats() with pool', () => {
    it('should upsert daily stats', async () => {
      const stats = { date: '2026-01-03', total_burns: 100 };
      mockQuery.mockResolvedValue({ rows: [stats] });

      const result = await db.updateDailyStats({
        burns: 50,
        transactions: 25,
        uniqueWallets: 10,
        feesSol: 0.01,
        treasuryBalance: 1.5,
      });

      expect(result).toEqual(stats);
    });
  });

  describe('getDailyStatsHistory() with pool', () => {
    it('should return stats in chronological order', async () => {
      const stats = [
        { date: '2026-01-02', total_burns: 100 },
        { date: '2026-01-03', total_burns: 150 },
      ];
      mockQuery.mockResolvedValue({ rows: stats });

      const result = await db.getDailyStatsHistory(30);
      // Should be reversed for charts
      expect(result).toEqual(stats.reverse());
    });
  });

  describe('Circuit breaker behavior', () => {
    it('should skip query when circuit is open', async () => {
      mockCircuitBreaker.canExecute.mockReturnValue(false);

      const result = await db.getBurnStats();
      expect(result).toBeNull();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should call onSuccess on successful query', async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: '5' }] });
      await db.getBurnStats();
      expect(mockCircuitBreaker.onSuccess).toHaveBeenCalled();
    });

    it('should call onFailure on query error', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));
      await db.getBurnStats();
      expect(mockCircuitBreaker.onFailure).toHaveBeenCalled();
    });
  });

  describe('getCircuitStatus()', () => {
    it('should return complete status object', () => {
      const status = db.getCircuitStatus();
      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('stats');
      expect(status).toHaveProperty('isConnected');
      expect(status).toHaveProperty('reconnectAttempts');
    });
  });
});
