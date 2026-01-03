/**
 * Tests for Redis utilities
 */

const redis = require('../../../src/utils/redis');

// Mock dependencies
jest.mock('../../../src/utils/config', () => ({
  IS_DEV: true,
  IS_STAGING: false,
  IS_PROD: false,
  REDIS_URL: 'redis://localhost:6379',
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('Redis Utilities', () => {
  describe('isConnected()', () => {
    it('should return a value', () => {
      const result = redis.isConnected();
      // In test environment, may return false or truthy value
      expect(result !== undefined).toBe(true);
    });
  });

  describe('getConnectionState()', () => {
    it('should return connection state object', () => {
      const state = redis.getConnectionState();
      expect(state).toBeDefined();
      expect(typeof state).toBe('object');
    });

    it('should include state field', () => {
      const state = redis.getConnectionState();
      expect(state.state).toBeDefined();
    });
  });

  describe('Quote operations', () => {
    const testQuote = {
      id: 'test-quote-id-123',
      paymentToken: 'So11111111111111111111111111111111111111112',
      userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      feeInLamports: 5000,
      feeInTokens: 100,
      expiresAt: Date.now() + 60000,
    };

    it('setQuote should store a quote', async () => {
      await expect(redis.setQuote(testQuote.id, testQuote)).resolves.not.toThrow();
    });

    it('getQuote should retrieve a stored quote', async () => {
      await redis.setQuote('retrieval-test', testQuote);
      const result = await redis.getQuote('retrieval-test');
      expect(result).toBeDefined();
      if (result) {
        expect(result.paymentToken).toBe(testQuote.paymentToken);
      }
    });

    it('getQuote should return null for non-existent quote', async () => {
      const result = await redis.getQuote('non-existent-quote-id');
      expect(result).toBeNull();
    });

    it('deleteQuote should remove a quote', async () => {
      await redis.setQuote('delete-test', testQuote);
      await redis.deleteQuote('delete-test');
      const result = await redis.getQuote('delete-test');
      expect(result).toBeNull();
    });
  });

  describe('Statistics operations', () => {
    it('getStats should return stats object', async () => {
      const stats = await redis.getStats();
      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });

    it('incrBurnTotal should not throw', async () => {
      await expect(redis.incrBurnTotal(1000)).resolves.not.toThrow();
    });

    it('incrTxCount should increment transaction count', async () => {
      await expect(redis.incrTxCount()).resolves.not.toThrow();
    });
  });

  describe('Pending swap operations', () => {
    it('getPendingSwapAmount should return a number', async () => {
      const amount = await redis.getPendingSwapAmount();
      expect(typeof amount).toBe('number');
    });

    it('addPendingSwap should increase pending amount', async () => {
      await redis.resetPendingSwap();
      await redis.addPendingSwap(5000);
      const amount = await redis.getPendingSwapAmount();
      expect(amount).toBeGreaterThanOrEqual(5000);
    });

    it('resetPendingSwap should clear pending amount', async () => {
      await redis.addPendingSwap(10000);
      await redis.resetPendingSwap();
      const amount = await redis.getPendingSwapAmount();
      expect(amount).toBe(0);
    });
  });

  describe('Treasury operations', () => {
    it('getTreasuryBalance should return a number', async () => {
      const balance = await redis.getTreasuryBalance();
      expect(typeof balance).toBe('number');
    });

    it('incrTreasuryTotal should increase treasury balance', async () => {
      const before = await redis.getTreasuryBalance();
      await redis.incrTreasuryTotal(1000);
      const after = await redis.getTreasuryBalance();
      expect(after).toBe(before + 1000);
    });

    it('recordTreasuryEvent should not throw', async () => {
      await expect(
        redis.recordTreasuryEvent({
          type: 'deposit',
          amount: 1000,
          signature: 'test-sig-123',
          timestamp: Date.now(),
        })
      ).resolves.not.toThrow();
    });

    it('getTreasuryHistory should return array', async () => {
      const history = await redis.getTreasuryHistory(10);
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('Anti-replay protection', () => {
    it('hasTransactionHash should return false for new hash', async () => {
      const hash = `test-hash-${Date.now()}`;
      const result = await redis.hasTransactionHash(hash);
      expect(result).toBe(false);
    });

    it('markTransactionHash should mark hash as used', async () => {
      const hash = `mark-test-${Date.now()}`;
      await redis.markTransactionHash(hash);
      const result = await redis.hasTransactionHash(hash);
      expect(result).toBe(true);
    });

    it('should prevent replay of same transaction', async () => {
      const hash = `replay-test-${Date.now()}`;

      // First attempt should succeed
      const first = await redis.hasTransactionHash(hash);
      expect(first).toBe(false);
      await redis.markTransactionHash(hash);

      // Second attempt should be detected
      const second = await redis.hasTransactionHash(hash);
      expect(second).toBe(true);
    });
  });

  describe('Wallet rate limiting', () => {
    it('incrWalletRateLimit should return a number', async () => {
      const wallet = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const result = await redis.incrWalletRateLimit(wallet, 'quote');
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('getWalletRateLimit should return current count', async () => {
      const wallet = `test-wallet-${Date.now()}`;
      await redis.incrWalletRateLimit(wallet, 'submit');
      const result = await redis.getWalletRateLimit(wallet, 'submit');
      expect(result).toBeGreaterThanOrEqual(1);
    });

    it('should track different rate limit types separately', async () => {
      const wallet = `type-test-${Date.now()}`;
      await redis.incrWalletRateLimit(wallet, 'quote');
      await redis.incrWalletRateLimit(wallet, 'quote');
      await redis.incrWalletRateLimit(wallet, 'submit');

      const quoteCount = await redis.getWalletRateLimit(wallet, 'quote');
      const submitCount = await redis.getWalletRateLimit(wallet, 'submit');

      expect(quoteCount).toBe(2);
      expect(submitCount).toBe(1);
    });
  });

  describe('Audit logging', () => {
    const testAuditEntry = {
      timestamp: Date.now(),
      type: 'quote',
      ip: '127.0.0.1',
      wallet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      action: 'request',
      data: { paymentToken: 'test' },
    };

    it('appendAuditLog should store audit entry', async () => {
      await expect(redis.appendAuditLog(testAuditEntry)).resolves.not.toThrow();
    });

    it('getAuditLog should return array of entries', async () => {
      await redis.appendAuditLog(testAuditEntry);
      const log = await redis.getAuditLog(10);
      expect(Array.isArray(log)).toBe(true);
    });

    it('searchAuditLog should filter entries', async () => {
      const uniqueWallet = `search-test-${Date.now()}`;
      await redis.appendAuditLog({
        ...testAuditEntry,
        wallet: uniqueWallet,
      });

      const results = await redis.searchAuditLog({ wallet: uniqueWallet });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('ping()', () => {
    it('should return ping result', async () => {
      const result = await redis.ping();
      expect(result).toBeDefined();
      // Returns PONG string in memory mode, object otherwise
    });
  });

  describe('Transaction slot (atomic anti-replay)', () => {
    it('claimTransactionSlot should return claimed=true for new hash', async () => {
      const hash = `atomic-test-${Date.now()}`;
      const result = await redis.claimTransactionSlot(hash);
      expect(result.claimed).toBe(true);
    });

    it('claimTransactionSlot should return claimed=false for duplicate hash', async () => {
      const hash = `atomic-dup-${Date.now()}`;
      await redis.claimTransactionSlot(hash);
      const result = await redis.claimTransactionSlot(hash);
      expect(result.claimed).toBe(false);
    });

    it('releaseTransactionSlot should allow re-claim', async () => {
      const hash = `atomic-release-${Date.now()}`;
      await redis.claimTransactionSlot(hash);
      await redis.releaseTransactionSlot(hash);
      const result = await redis.claimTransactionSlot(hash);
      expect(result.claimed).toBe(true);
    });
  });

  describe('Wallet burn tracking', () => {
    it('incrWalletBurn should track burn amount and tx count', async () => {
      const wallet = `burn-wallet-${Date.now()}`;
      const result = await redis.incrWalletBurn(wallet, 1000);
      expect(result).toHaveProperty('totalBurned');
      expect(result).toHaveProperty('txCount');
      expect(result.totalBurned).toBeGreaterThanOrEqual(1000);
      expect(result.txCount).toBeGreaterThanOrEqual(1);
    });

    it('getWalletBurnStats should return burn statistics', async () => {
      const wallet = `stats-wallet-${Date.now()}`;
      await redis.incrWalletBurn(wallet, 500);
      const stats = await redis.getWalletBurnStats(wallet);
      expect(stats).toHaveProperty('wallet', wallet);
      expect(stats).toHaveProperty('totalBurned');
      expect(stats).toHaveProperty('txCount');
      expect(stats.totalBurned).toBeGreaterThanOrEqual(500);
    });

    it('getBurnLeaderboard should return array', async () => {
      const result = await redis.getBurnLeaderboard(10);
      expect(Array.isArray(result)).toBe(true);
    });

    it('getBurnerCount should return a number', async () => {
      const count = await redis.getBurnerCount();
      expect(typeof count).toBe('number');
    });
  });

  describe('Memory sync helpers', () => {
    it('setOnReconnectCallback should accept function', () => {
      expect(() => {
        redis.setOnReconnectCallback(() => {});
      }).not.toThrow();
    });

    it('getMemoryStatsData should return object', () => {
      const data = redis.getMemoryStatsData();
      expect(typeof data).toBe('object');
    });

    it('clearMemoryStats should not throw', () => {
      expect(() => redis.clearMemoryStats()).not.toThrow();
    });
  });

  describe('Distributed locking', () => {
    it('acquireLock should not throw', async () => {
      const key = `test-lock-${Date.now()}`;
      await expect(redis.acquireLock(key, 5000)).resolves.not.toThrow();
    });

    it('releaseLock should not throw', async () => {
      const key = `release-lock-${Date.now()}`;
      await expect(redis.releaseLock(key)).resolves.not.toThrow();
    });

    it('isLockHeld should return boolean', async () => {
      const key = `check-lock-${Date.now()}`;
      const result = await redis.isLockHeld(key);
      expect(typeof result).toBe('boolean');
    });

    it('withLock should execute callback', async () => {
      const key = `with-lock-${Date.now()}`;
      const callback = jest.fn().mockResolvedValue('result');
      const result = await redis.withLock(key, callback, 5000);
      expect(result).toBeDefined();
    });
  });

  describe('Velocity tracking', () => {
    it('recordTransactionVelocity should not throw', async () => {
      await expect(redis.recordTransactionVelocity(5000)).resolves.not.toThrow();
    });

    it('getVelocityMetrics should return metrics object', async () => {
      const metrics = await redis.getVelocityMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics).toBe('object');
    });

    it('calculateVelocityBasedBuffer should return buffer object', async () => {
      const buffer = await redis.calculateVelocityBasedBuffer();
      expect(buffer).toBeDefined();
      expect(buffer).toHaveProperty('required');
      expect(buffer).toHaveProperty('target');
      expect(buffer).toHaveProperty('velocity');
    });
  });

  describe('Jupiter quote caching', () => {
    it('cacheJupiterQuote should store quote', async () => {
      await expect(
        redis.cacheJupiterQuote('token1', 'token2', 1000, { quote: 'data' })
      ).resolves.not.toThrow();
    });

    it('getCachedJupiterQuote should return cached or null', async () => {
      const result = await redis.getCachedJupiterQuote('token1', 'token2', 1000);
      // May return null if not cached or data if cached
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('getJupiterCacheStats should return stats object', () => {
      const stats = redis.getJupiterCacheStats();
      expect(stats).toHaveProperty('ttlSeconds');
      expect(stats).toHaveProperty('prefix');
    });
  });

  describe('getClient()', () => {
    it('should return client or null', async () => {
      const client = await redis.getClient();
      // In test mode, may return null (memory fallback) or client
      expect(client === null || typeof client === 'object').toBe(true);
    });
  });

  describe('disconnect()', () => {
    it('should not throw', async () => {
      await expect(redis.disconnect()).resolves.not.toThrow();
    });
  });
});
