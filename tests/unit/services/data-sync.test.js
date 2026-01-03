/**
 * Tests for Data Sync Service
 *
 * Tests Redis ↔ PostgreSQL sync functionality for data durability.
 */

// Mock dependencies before requiring the module
jest.mock('../../../src/utils/config', () => ({
  IS_DEV: true,
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  zIncrBy: jest.fn(),
};

jest.mock('../../../src/utils/redis', () => ({
  getStats: jest.fn().mockResolvedValue({
    burnTotal: 1000000,
    txCount: 100,
  }),
  getTreasuryBalance: jest.fn().mockResolvedValue(500000),
  getBurnerCount: jest.fn().mockResolvedValue(50),
  getClient: jest.fn().mockResolvedValue(mockRedisClient),
  isReady: jest.fn().mockReturnValue(true),
}));

jest.mock('../../../src/utils/db', () => ({
  isConnected: jest.fn().mockReturnValue(true),
  updateDailyStats: jest.fn().mockResolvedValue(true),
  getBurnStats: jest.fn().mockResolvedValue({
    total_amount: 5000000,
    total_burns: 500,
    total_treasury: 1000000,
  }),
}));

const dataSync = require('../../../src/services/data-sync');
const redis = require('../../../src/utils/redis');
const db = require('../../../src/utils/db');

describe('Data Sync Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Reset module state
    dataSync.stop();
    // Reset all mocks to default behavior
    mockRedisClient.get.mockReset().mockResolvedValue(null);
    mockRedisClient.set.mockReset().mockResolvedValue('OK');
    mockRedisClient.zIncrBy.mockReset().mockResolvedValue(1);
    redis.getClient.mockReset().mockResolvedValue(mockRedisClient);
    redis.getStats.mockReset().mockResolvedValue({ burnTotal: 1000000, txCount: 100 });
    redis.getTreasuryBalance.mockReset().mockResolvedValue(500000);
    redis.getBurnerCount.mockReset().mockResolvedValue(50);
    db.isConnected.mockReset().mockReturnValue(true);
    db.updateDailyStats.mockReset().mockResolvedValue(true);
    db.getBurnStats.mockReset().mockResolvedValue({
      total_amount: 5000000,
      total_burns: 500,
      total_treasury: 1000000,
    });
  });

  afterEach(() => {
    dataSync.stop();
    jest.useRealTimers();
  });

  // ===========================================================================
  // getStatus()
  // ===========================================================================

  describe('getStatus()', () => {
    it('should return status object', () => {
      const status = dataSync.getStatus();
      expect(status).toBeDefined();
      expect(typeof status).toBe('object');
    });

    it('should include running flag', () => {
      const status = dataSync.getStatus();
      expect(typeof status.running).toBe('boolean');
    });

    it('should include lastSyncedStats', () => {
      const status = dataSync.getStatus();
      expect(status.lastSyncedStats).toBeDefined();
    });

    it('should include intervalMs', () => {
      const status = dataSync.getStatus();
      expect(status.intervalMs).toBeDefined();
      expect(typeof status.intervalMs).toBe('number');
    });

    it('should report running=false when stopped', () => {
      dataSync.stop();
      const status = dataSync.getStatus();
      expect(status.running).toBe(false);
    });

    it('should report running=true when started', () => {
      dataSync.start();
      const status = dataSync.getStatus();
      expect(status.running).toBe(true);
    });
  });

  // ===========================================================================
  // start() and stop()
  // ===========================================================================

  describe('start()', () => {
    it('should start the sync service', () => {
      dataSync.start();
      expect(dataSync.getStatus().running).toBe(true);
    });

    it('should not start twice', () => {
      dataSync.start();
      dataSync.start(); // Second call should be ignored
      expect(dataSync.getStatus().running).toBe(true);
    });

    it('should schedule initial sync after delay', () => {
      dataSync.start();
      // Initial sync is scheduled with setTimeout
      expect(dataSync.getStatus().running).toBe(true);
    });
  });

  describe('stop()', () => {
    it('should stop the sync service', () => {
      dataSync.start();
      dataSync.stop();
      expect(dataSync.getStatus().running).toBe(false);
    });

    it('should not throw if not started', () => {
      expect(() => dataSync.stop()).not.toThrow();
    });

    it('should clear interval when stopped', () => {
      dataSync.start();
      dataSync.stop();
      expect(dataSync.getStatus().running).toBe(false);
    });
  });

  // ===========================================================================
  // syncRedisToPostgres()
  // ===========================================================================

  describe('syncRedisToPostgres()', () => {
    it('should return synced=false when db not connected', async () => {
      db.isConnected.mockReturnValue(false);
      const result = await dataSync.syncRedisToPostgres();
      expect(result.synced).toBe(false);
      expect(result.reason).toBe('db_unavailable');
    });

    it('should sync stats from Redis to PostgreSQL', async () => {
      db.isConnected.mockReturnValue(true);
      redis.getStats.mockResolvedValue({
        burnTotal: 2000000,
        txCount: 200,
      });
      redis.getTreasuryBalance.mockResolvedValue(600000);
      redis.getBurnerCount.mockResolvedValue(60);

      const result = await dataSync.syncRedisToPostgres();

      expect(result.synced).toBe(true);
      expect(db.updateDailyStats).toHaveBeenCalled();
    });

    it('should skip sync when no changes detected', async () => {
      db.isConnected.mockReturnValue(true);

      // First sync
      redis.getStats.mockResolvedValue({ burnTotal: 1000, txCount: 10 });
      redis.getTreasuryBalance.mockResolvedValue(500);
      await dataSync.syncRedisToPostgres();

      // Second sync with same values
      jest.clearAllMocks();
      db.isConnected.mockReturnValue(true);
      redis.getStats.mockResolvedValue({ burnTotal: 1000, txCount: 10 });
      redis.getTreasuryBalance.mockResolvedValue(500);

      const result = await dataSync.syncRedisToPostgres();
      expect(result.synced).toBe(false);
      expect(result.reason).toBe('no_changes');
    });

    it('should calculate deltas correctly', async () => {
      db.isConnected.mockReturnValue(true);

      // First sync
      redis.getStats.mockResolvedValue({ burnTotal: 1000, txCount: 10 });
      redis.getTreasuryBalance.mockResolvedValue(500);
      await dataSync.syncRedisToPostgres();

      // Second sync with new values
      jest.clearAllMocks();
      db.isConnected.mockReturnValue(true);
      redis.getStats.mockResolvedValue({ burnTotal: 1500, txCount: 15 });
      redis.getTreasuryBalance.mockResolvedValue(600);
      redis.getBurnerCount.mockResolvedValue(55);

      await dataSync.syncRedisToPostgres();

      expect(db.updateDailyStats).toHaveBeenCalledWith(
        expect.objectContaining({
          burns: 500, // Delta: 1500 - 1000
          transactions: 5, // Delta: 15 - 10
        })
      );
    });

    it('should throw on db error', async () => {
      db.isConnected.mockReturnValue(true);
      redis.getStats.mockResolvedValue({ burnTotal: 3000, txCount: 30 });
      redis.getTreasuryBalance.mockResolvedValue(700);
      db.updateDailyStats.mockRejectedValue(new Error('DB error'));

      await expect(dataSync.syncRedisToPostgres()).rejects.toThrow('DB error');
    });
  });

  // ===========================================================================
  // syncMemoryToRedis()
  // ===========================================================================

  describe('syncMemoryToRedis()', () => {
    it('should return synced=false when no data', async () => {
      const result = await dataSync.syncMemoryToRedis(null);
      expect(result.synced).toBe(false);
      expect(result.reason).toBe('no_data');
    });

    it('should return synced=false for empty object', async () => {
      const result = await dataSync.syncMemoryToRedis({});
      expect(result.synced).toBe(false);
      expect(result.reason).toBe('no_data');
    });

    it('should return synced=false when redis unavailable', async () => {
      redis.getClient.mockResolvedValue(null);
      const result = await dataSync.syncMemoryToRedis({ 'stats:test': 100 });
      expect(result.synced).toBe(false);
      expect(result.reason).toBe('redis_unavailable');
    });

    it('should sync stats keys with accumulation', async () => {
      mockRedisClient.get.mockResolvedValue('100'); // Existing value
      const result = await dataSync.syncMemoryToRedis({
        'stats:burn_total': 50,
      });

      expect(result.synced).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalledWith('gasdf:stats:burn_total', '150');
    });

    it('should sync pending keys', async () => {
      mockRedisClient.get.mockResolvedValue('200');
      const result = await dataSync.syncMemoryToRedis({
        'pending:swap': 100,
      });

      expect(result.synced).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalledWith('gasdf:pending:swap', '300');
    });

    it('should sync wallet burn stats and update leaderboard', async () => {
      mockRedisClient.get.mockResolvedValue('500');
      const result = await dataSync.syncMemoryToRedis({
        'burn:wallet:ABC123': 200,
      });

      expect(result.synced).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalledWith('gasdf:burn:wallet:ABC123', '700');
      expect(mockRedisClient.zIncrBy).toHaveBeenCalledWith(
        'gasdf:burn:leaderboard',
        200,
        'ABC123'
      );
    });

    it('should not update leaderboard for txcount keys', async () => {
      mockRedisClient.get.mockResolvedValue('10');
      mockRedisClient.zIncrBy.mockClear();

      const result = await dataSync.syncMemoryToRedis({
        'burn:wallet:ABC123:txcount': 5,
      });

      expect(result.synced).toBe(true);
      expect(mockRedisClient.zIncrBy).not.toHaveBeenCalled();
    });

    it('should skip zero value memory data', async () => {
      mockRedisClient.get.mockResolvedValue('100');
      const result = await dataSync.syncMemoryToRedis({
        'stats:burn_total': 0,
      });

      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should handle errors per key gracefully', async () => {
      mockRedisClient.get.mockRejectedValueOnce(new Error('Redis error'));
      mockRedisClient.get.mockResolvedValueOnce('100');

      const result = await dataSync.syncMemoryToRedis({
        'stats:error_key': 50,
        'stats:good_key': 50,
      });

      expect(result.synced).toBe(true);
      expect(result.errors).toBe(1);
    });
  });

  // ===========================================================================
  // restoreStatsFromPostgres()
  // ===========================================================================

  describe('restoreStatsFromPostgres()', () => {
    it('should return restored=false when db not connected', async () => {
      db.isConnected.mockReturnValue(false);
      const result = await dataSync.restoreStatsFromPostgres();
      expect(result.restored).toBe(false);
      expect(result.reason).toBe('db_unavailable');
    });

    it('should skip restore when Redis has data', async () => {
      db.isConnected.mockReturnValue(true);
      redis.getStats.mockResolvedValue({ burnTotal: 1000, txCount: 10 });

      const result = await dataSync.restoreStatsFromPostgres();
      expect(result.restored).toBe(false);
      expect(result.reason).toBe('redis_has_data');
    });

    it('should skip when no PostgreSQL data', async () => {
      db.isConnected.mockReturnValue(true);
      redis.getStats.mockResolvedValue({ burnTotal: 0, txCount: 0 });
      db.getBurnStats.mockResolvedValue(null);

      const result = await dataSync.restoreStatsFromPostgres();
      expect(result.restored).toBe(false);
      expect(result.reason).toBe('no_postgres_data');
    });

    it('should restore stats from PostgreSQL to Redis', async () => {
      db.isConnected.mockReturnValue(true);
      redis.getStats.mockResolvedValue({ burnTotal: 0, txCount: 0 });
      db.getBurnStats.mockResolvedValue({
        total_amount: 5000000,
        total_burns: 500,
        total_treasury: 1000000,
      });

      const result = await dataSync.restoreStatsFromPostgres();

      expect(result.restored).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalledWith('gasdf:stats:burn_total', '5000000');
      expect(mockRedisClient.set).toHaveBeenCalledWith('gasdf:stats:tx_count', '500');
      expect(mockRedisClient.set).toHaveBeenCalledWith('gasdf:stats:treasury_total', '1000000');
    });

    it('should return restored=false when redis client unavailable', async () => {
      db.isConnected.mockReturnValue(true);
      redis.getStats.mockResolvedValue({ burnTotal: 0, txCount: 0 });
      db.getBurnStats.mockResolvedValue({ total_amount: 100 });
      redis.getClient.mockResolvedValue(null);

      const result = await dataSync.restoreStatsFromPostgres();
      expect(result.restored).toBe(false);
      expect(result.reason).toBe('redis_unavailable');
    });

    it('should handle restore errors gracefully', async () => {
      db.isConnected.mockReturnValue(true);
      redis.getStats.mockResolvedValue({ burnTotal: 0, txCount: 0 });
      db.getBurnStats.mockRejectedValue(new Error('DB query failed'));

      const result = await dataSync.restoreStatsFromPostgres();
      expect(result.restored).toBe(false);
      expect(result.reason).toBe('DB query failed');
    });
  });

  // ===========================================================================
  // forceSync()
  // ===========================================================================

  describe('forceSync()', () => {
    it('should trigger syncRedisToPostgres', async () => {
      db.isConnected.mockReturnValue(true);
      redis.getStats.mockResolvedValue({ burnTotal: 9999, txCount: 99 });
      redis.getTreasuryBalance.mockResolvedValue(888);
      redis.getBurnerCount.mockResolvedValue(77);

      const result = await dataSync.forceSync();
      expect(result.synced).toBe(true);
    });

    it('should return result from syncRedisToPostgres', async () => {
      db.isConnected.mockReturnValue(false);
      const result = await dataSync.forceSync();
      expect(result.synced).toBe(false);
      expect(result.reason).toBe('db_unavailable');
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle empty burn stats from postgres', async () => {
      db.isConnected.mockReturnValue(true);
      redis.getStats.mockResolvedValue({ burnTotal: 0, txCount: 0 });
      db.getBurnStats.mockResolvedValue({ total_amount: 0, total_burns: 0 });

      const result = await dataSync.restoreStatsFromPostgres();
      expect(result.restored).toBe(false);
    });

    it('should handle negative deltas gracefully', async () => {
      db.isConnected.mockReturnValue(true);

      // First sync with higher values
      redis.getStats.mockResolvedValue({ burnTotal: 1000, txCount: 100 });
      redis.getTreasuryBalance.mockResolvedValue(500);
      await dataSync.syncRedisToPostgres();

      // Second sync with lower values (shouldn't happen but handle it)
      jest.clearAllMocks();
      db.isConnected.mockReturnValue(true);
      redis.getStats.mockResolvedValue({ burnTotal: 500, txCount: 50 });
      redis.getTreasuryBalance.mockResolvedValue(600); // Changed to trigger sync
      redis.getBurnerCount.mockResolvedValue(30);

      await dataSync.syncRedisToPostgres();

      // Should use 0 for negative deltas
      expect(db.updateDailyStats).toHaveBeenCalledWith(
        expect.objectContaining({
          burns: 0,
          transactions: 0,
        })
      );
    });
  });
});
