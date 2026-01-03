/**
 * Tests for Admin Routes
 */

const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring anything
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/services/burn', () => ({
  checkAndExecuteBurn: jest.fn(),
  getTreasuryTokenBalances: jest.fn(),
}));

jest.mock('../../../src/utils/db', () => ({
  getTransactionHistory: jest.fn(),
  getBurnHistory: jest.fn(),
}));

jest.mock('../../../scripts/migrate-redis-keys', () => ({
  migrateRedisKeys: jest.fn(),
  cleanupOldKeys: jest.fn(),
}));

const logger = require('../../../src/utils/logger');
const { checkAndExecuteBurn, getTreasuryTokenBalances } = require('../../../src/services/burn');
const db = require('../../../src/utils/db');
const { migrateRedisKeys, cleanupOldKeys } = require('../../../scripts/migrate-redis-keys');

describe('Admin Route', () => {
  let app;
  const TEST_API_KEY = 'test-admin-key-12345';
  const originalEnv = process.env.ADMIN_API_KEY;

  beforeAll(() => {
    process.env.ADMIN_API_KEY = TEST_API_KEY;
  });

  afterAll(() => {
    if (originalEnv) {
      process.env.ADMIN_API_KEY = originalEnv;
    } else {
      delete process.env.ADMIN_API_KEY;
    }
  });

  beforeEach(() => {
    const adminRouter = require('../../../src/routes/admin');
    app = express();
    app.use(express.json());
    app.use('/admin', adminRouter);
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Authentication Tests
  // ==========================================================================

  describe('Authentication', () => {
    it('should reject request without API key', async () => {
      const res = await request(app).get('/admin/treasury');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
      expect(res.body.code).toBe('INVALID_API_KEY');
    });

    it('should reject request with invalid API key', async () => {
      const res = await request(app)
        .get('/admin/treasury')
        .set('x-admin-key', 'wrong-key');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_API_KEY');
    });

    it('should accept request with valid API key', async () => {
      getTreasuryTokenBalances.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/treasury')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(200);
    });

    it('should warn when API key is passed in query param', async () => {
      getTreasuryTokenBalances.mockResolvedValue([]);

      await request(app)
        .get('/admin/treasury')
        .query({ key: TEST_API_KEY })
        .set('x-admin-key', TEST_API_KEY);

      expect(logger.warn).toHaveBeenCalledWith(
        'ADMIN',
        'API key in query param rejected (security risk)',
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // POST /admin/burn
  // ==========================================================================

  describe('POST /admin/burn', () => {
    it('should return no tokens message when treasury is empty', async () => {
      getTreasuryTokenBalances.mockResolvedValue([]);

      const res = await request(app)
        .post('/admin/burn')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('No tokens to burn');
    });

    it('should return not executed when burn returns null', async () => {
      getTreasuryTokenBalances.mockResolvedValue([
        { mint: 'USDC', symbol: 'USDC', uiAmount: 100, valueUsd: 100 },
      ]);
      checkAndExecuteBurn.mockResolvedValue(null);

      const res = await request(app)
        .post('/admin/burn')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('not executed');
    });

    it('should return success when burn completes', async () => {
      getTreasuryTokenBalances.mockResolvedValue([
        { mint: 'USDC', symbol: 'USDC', uiAmount: 100, valueUsd: 100 },
      ]);
      checkAndExecuteBurn.mockResolvedValue({
        processed: [{ mint: 'USDC', amount: 100 }],
        failed: [],
        totalBurned: 1000000, // 1 ASDF
        totalTreasury: 1000000000, // 1 SOL
      });

      const res = await request(app)
        .post('/admin/burn')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result.totalBurnedAsdf).toBe(1);
      expect(res.body.result.totalTreasurySol).toBe(1);
    });

    it('should return 500 when burn throws', async () => {
      getTreasuryTokenBalances.mockResolvedValue([
        { mint: 'USDC', symbol: 'USDC', uiAmount: 100, valueUsd: 100 },
      ]);
      checkAndExecuteBurn.mockRejectedValue(new Error('RPC timeout'));

      const res = await request(app)
        .post('/admin/burn')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('BURN_FAILED');
    });
  });

  // ==========================================================================
  // GET /admin/treasury
  // ==========================================================================

  describe('GET /admin/treasury', () => {
    it('should return empty treasury', async () => {
      getTreasuryTokenBalances.mockResolvedValue([]);

      const res = await request(app)
        .get('/admin/treasury')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.tokens).toEqual([]);
      expect(res.body.totalTokens).toBe(0);
      expect(res.body.totalValueUsd).toBe(0);
    });

    it('should return treasury with tokens', async () => {
      getTreasuryTokenBalances.mockResolvedValue([
        { mint: 'USDC', symbol: 'USDC', uiAmount: 100, valueUsd: 100 },
        { mint: 'SOL', symbol: 'SOL', uiAmount: 1, valueUsd: 200 },
      ]);

      const res = await request(app)
        .get('/admin/treasury')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.tokens).toHaveLength(2);
      expect(res.body.totalValueUsd).toBe(300);
      expect(res.body.tokens[0].eligible).toBe(true);
    });

    it('should mark tokens under $0.50 as not eligible', async () => {
      getTreasuryTokenBalances.mockResolvedValue([
        { mint: 'DUST', symbol: 'DUST', uiAmount: 0.001, valueUsd: 0.1 },
      ]);

      const res = await request(app)
        .get('/admin/treasury')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.body.tokens[0].eligible).toBe(false);
    });

    it('should return 500 when getTreasuryTokenBalances throws', async () => {
      getTreasuryTokenBalances.mockRejectedValue(new Error('RPC error'));

      const res = await request(app)
        .get('/admin/treasury')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('TREASURY_CHECK_FAILED');
    });
  });

  // ==========================================================================
  // GET /admin/transactions
  // ==========================================================================

  describe('GET /admin/transactions', () => {
    it('should return transactions with default limit', async () => {
      db.getTransactionHistory.mockResolvedValue({
        transactions: [{ id: 1, amount: 100 }],
        total: 1,
      });

      const res = await request(app)
        .get('/admin/transactions')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.transactions).toHaveLength(1);
      expect(res.body.limit).toBe(20);
      expect(res.body.offset).toBe(0);
      expect(db.getTransactionHistory).toHaveBeenCalledWith(20, 0);
    });

    it('should respect limit and offset params', async () => {
      db.getTransactionHistory.mockResolvedValue({
        transactions: [],
        total: 50,
      });

      const res = await request(app)
        .get('/admin/transactions')
        .query({ limit: 10, offset: 20 })
        .set('x-admin-key', TEST_API_KEY);

      expect(res.body.limit).toBe(10);
      expect(res.body.offset).toBe(20);
      expect(db.getTransactionHistory).toHaveBeenCalledWith(10, 20);
    });

    it('should cap limit at 100', async () => {
      db.getTransactionHistory.mockResolvedValue({
        transactions: [],
        total: 0,
      });

      const res = await request(app)
        .get('/admin/transactions')
        .query({ limit: 500 })
        .set('x-admin-key', TEST_API_KEY);

      expect(res.body.limit).toBe(100);
      expect(db.getTransactionHistory).toHaveBeenCalledWith(100, 0);
    });

    it('should return hasMore true when more results exist', async () => {
      db.getTransactionHistory.mockResolvedValue({
        transactions: [{}, {}, {}],
        total: 10,
      });

      const res = await request(app)
        .get('/admin/transactions')
        .query({ limit: 3 })
        .set('x-admin-key', TEST_API_KEY);

      expect(res.body.hasMore).toBe(true);
    });

    it('should return 503 when DB unavailable', async () => {
      db.getTransactionHistory.mockResolvedValue(null);

      const res = await request(app)
        .get('/admin/transactions')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('DB_UNAVAILABLE');
    });

    it('should return 500 when getTransactionHistory throws', async () => {
      db.getTransactionHistory.mockRejectedValue(new Error('Connection refused'));

      const res = await request(app)
        .get('/admin/transactions')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('QUERY_FAILED');
    });
  });

  // ==========================================================================
  // GET /admin/burns
  // ==========================================================================

  describe('GET /admin/burns', () => {
    it('should return burn history', async () => {
      db.getBurnHistory.mockResolvedValue({
        burns: [{ id: 1, amount: 1000000 }],
        total: 1,
      });

      const res = await request(app)
        .get('/admin/burns')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(200);
      expect(res.body.burns).toHaveLength(1);
      expect(res.body.limit).toBe(20);
    });

    it('should respect limit param', async () => {
      db.getBurnHistory.mockResolvedValue({
        burns: [],
        total: 0,
      });

      const res = await request(app)
        .get('/admin/burns')
        .query({ limit: 50 })
        .set('x-admin-key', TEST_API_KEY);

      expect(res.body.limit).toBe(50);
      expect(db.getBurnHistory).toHaveBeenCalledWith(50);
    });

    it('should cap limit at 100', async () => {
      db.getBurnHistory.mockResolvedValue({
        burns: [],
        total: 0,
      });

      const res = await request(app)
        .get('/admin/burns')
        .query({ limit: 999 })
        .set('x-admin-key', TEST_API_KEY);

      expect(res.body.limit).toBe(100);
      expect(db.getBurnHistory).toHaveBeenCalledWith(100);
    });

    it('should return 503 when DB unavailable', async () => {
      db.getBurnHistory.mockResolvedValue(null);

      const res = await request(app)
        .get('/admin/burns')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('DB_UNAVAILABLE');
    });

    it('should return 500 when getBurnHistory throws', async () => {
      db.getBurnHistory.mockRejectedValue(new Error('Query timeout'));

      const res = await request(app)
        .get('/admin/burns')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('QUERY_FAILED');
    });
  });

  // ==========================================================================
  // POST /admin/migrate-redis
  // ==========================================================================

  describe('POST /admin/migrate-redis', () => {
    it('should perform dry run by default', async () => {
      migrateRedisKeys.mockResolvedValue({
        success: true,
        stats: { migrated: 5 },
      });

      const res = await request(app)
        .post('/admin/migrate-redis')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(200);
      expect(migrateRedisKeys).toHaveBeenCalledWith(true);
    });

    it('should perform actual migration when dryRun is false', async () => {
      migrateRedisKeys.mockResolvedValue({
        success: true,
        stats: { migrated: 10 },
      });

      const res = await request(app)
        .post('/admin/migrate-redis')
        .set('x-admin-key', TEST_API_KEY)
        .send({ dryRun: false });

      expect(res.status).toBe(200);
      expect(migrateRedisKeys).toHaveBeenCalledWith(false);
    });

    it('should return 500 when migration throws', async () => {
      migrateRedisKeys.mockRejectedValue(new Error('Redis connection failed'));

      const res = await request(app)
        .post('/admin/migrate-redis')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('MIGRATION_FAILED');
    });
  });

  // ==========================================================================
  // POST /admin/cleanup-redis
  // ==========================================================================

  describe('POST /admin/cleanup-redis', () => {
    it('should perform dry run by default', async () => {
      cleanupOldKeys.mockResolvedValue({
        success: true,
        stats: { deleted: 3 },
      });

      const res = await request(app)
        .post('/admin/cleanup-redis')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(200);
      expect(cleanupOldKeys).toHaveBeenCalledWith(true);
    });

    it('should perform actual cleanup when dryRun is false', async () => {
      cleanupOldKeys.mockResolvedValue({
        success: true,
        stats: { deleted: 8 },
      });

      const res = await request(app)
        .post('/admin/cleanup-redis')
        .set('x-admin-key', TEST_API_KEY)
        .send({ dryRun: false });

      expect(res.status).toBe(200);
      expect(cleanupOldKeys).toHaveBeenCalledWith(false);
    });

    it('should return 500 when cleanup throws', async () => {
      cleanupOldKeys.mockRejectedValue(new Error('Redis connection failed'));

      const res = await request(app)
        .post('/admin/cleanup-redis')
        .set('x-admin-key', TEST_API_KEY);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('CLEANUP_FAILED');
    });
  });
});
