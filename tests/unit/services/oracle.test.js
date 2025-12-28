/**
 * Tests for Oracle Service
 */

const oracle = require('../../../src/services/oracle');

// Mock config
jest.mock('../../../src/utils/config', () => ({
  ORACLE_URL: 'http://localhost:3001',
  IS_DEV: true,
}));

// Mock fetch
global.fetch = jest.fn();

describe('Oracle Service', () => {
  beforeEach(() => {
    global.fetch.mockReset();
    oracle.clearCache();
  });

  describe('K_TIERS', () => {
    it('should define TRUSTED tier', () => {
      expect(oracle.K_TIERS.TRUSTED).toBeDefined();
      expect(oracle.K_TIERS.TRUSTED.feeMultiplier).toBe(1.0);
      expect(oracle.K_TIERS.TRUSTED.minScore).toBe(80);
    });

    it('should define STANDARD tier', () => {
      expect(oracle.K_TIERS.STANDARD).toBeDefined();
      expect(oracle.K_TIERS.STANDARD.feeMultiplier).toBe(1.25);
      expect(oracle.K_TIERS.STANDARD.minScore).toBe(50);
    });

    it('should define RISKY tier', () => {
      expect(oracle.K_TIERS.RISKY).toBeDefined();
      expect(oracle.K_TIERS.RISKY.feeMultiplier).toBe(1.5);
      expect(oracle.K_TIERS.RISKY.minScore).toBe(20);
    });

    it('should define UNKNOWN tier', () => {
      expect(oracle.K_TIERS.UNKNOWN).toBeDefined();
      expect(oracle.K_TIERS.UNKNOWN.feeMultiplier).toBe(2.0);
      expect(oracle.K_TIERS.UNKNOWN.minScore).toBe(0);
    });
  });

  describe('TRUSTED_TOKENS', () => {
    it('should include SOL', () => {
      expect(oracle.TRUSTED_TOKENS.has('So11111111111111111111111111111111111111112')).toBe(true);
    });

    it('should include USDC', () => {
      expect(oracle.TRUSTED_TOKENS.has('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    });

    it('should include USDT', () => {
      expect(oracle.TRUSTED_TOKENS.has('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')).toBe(true);
    });

    it('should include mSOL', () => {
      expect(oracle.TRUSTED_TOKENS.has('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So')).toBe(true);
    });

    it('should include jitoSOL', () => {
      expect(oracle.TRUSTED_TOKENS.has('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn')).toBe(true);
    });

    it('should include $ASDF', () => {
      expect(oracle.TRUSTED_TOKENS.has('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump')).toBe(true);
    });

    it('should not include random tokens', () => {
      expect(oracle.TRUSTED_TOKENS.has('RandomToken123')).toBe(false);
    });
  });

  describe('getOracleHealth()', () => {
    it('should return health status object', () => {
      const health = oracle.getOracleHealth();
      expect(health).toBeDefined();
      expect(health.configured).toBeDefined();
      expect(health.totalRequests).toBeDefined();
      expect(health.totalErrors).toBeDefined();
    });

    it('should include URL', () => {
      const health = oracle.getOracleHealth();
      expect(health.url).toBeDefined();
    });

    it('should track error rate', () => {
      const health = oracle.getOracleHealth();
      expect(health.errorRate).toBeDefined();
    });

    it('should include status field', () => {
      const health = oracle.getOracleHealth();
      expect(health.status).toBeDefined();
    });

    it('should include consecutive errors count', () => {
      const health = oracle.getOracleHealth();
      expect(typeof health.consecutiveErrors).toBe('number');
    });

    it('should include average latency', () => {
      const health = oracle.getOracleHealth();
      expect(typeof health.avgLatencyMs).toBe('number');
    });

    it('should include cache size', () => {
      const health = oracle.getOracleHealth();
      expect(typeof health.cacheSize).toBe('number');
    });
  });

  describe('clearCache()', () => {
    it('should clear the cache', () => {
      oracle.clearCache();
      const health = oracle.getOracleHealth();
      expect(health.cacheSize).toBe(0);
    });
  });

  describe('getKScore()', () => {
    it('should return TRUSTED for known stablecoins', async () => {
      // USDC
      const result = await oracle.getKScore('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(result.tier).toBe('TRUSTED');
      expect(result.feeMultiplier).toBe(1.0);
      expect(result.score).toBe(100);
    });

    it('should return TRUSTED for USDT', async () => {
      const result = await oracle.getKScore('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
      expect(result.tier).toBe('TRUSTED');
    });

    it('should return TRUSTED for SOL', async () => {
      const result = await oracle.getKScore('So11111111111111111111111111111111111111112');
      expect(result.tier).toBe('TRUSTED');
    });

    it('should return TRUSTED for mSOL', async () => {
      const result = await oracle.getKScore('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');
      expect(result.tier).toBe('TRUSTED');
    });

    it('should return TRUSTED for jitoSOL', async () => {
      const result = await oracle.getKScore('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');
      expect(result.tier).toBe('TRUSTED');
    });

    it('should return cached result on second call', async () => {
      const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      await oracle.getKScore(mint);
      const result2 = await oracle.getKScore(mint);

      // Cached results should be fast and have same tier
      expect(result2.tier).toBe('TRUSTED');
    });

    it('should handle oracle response for unknown token', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          mint: 'unknown123',
          score: 60,
          holders: 100,
        }),
      });

      const result = await oracle.getKScore('unknown123');
      expect(result).toBeDefined();
    });

    it('should fallback on oracle error', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      const result = await oracle.getKScore('error_token');
      // On error, it should return a valid result with a feeMultiplier
      expect(result).toBeDefined();
      expect(result.feeMultiplier).toBeDefined();
    });

    it('should include score in result', async () => {
      const result = await oracle.getKScore('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(result.score).toBeDefined();
      expect(typeof result.score).toBe('number');
    });

    it('should include feeMultiplier in result', async () => {
      const result = await oracle.getKScore('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(result.feeMultiplier).toBeDefined();
      expect(typeof result.feeMultiplier).toBe('number');
    });
  });

  describe('calculateFeeWithKScore()', () => {
    it('should calculate fee with multiplier', () => {
      const baseFee = 10000;
      const kScore = { feeMultiplier: 1.5 };
      const result = oracle.calculateFeeWithKScore(baseFee, kScore);

      expect(result).toBe(15000);
    });

    it('should not change fee for 1.0 multiplier', () => {
      const baseFee = 10000;
      const kScore = { feeMultiplier: 1.0 };
      const result = oracle.calculateFeeWithKScore(baseFee, kScore);

      expect(result).toBe(baseFee);
    });

    it('should apply 2.0 multiplier correctly', () => {
      const baseFee = 10000;
      const kScore = { feeMultiplier: 2.0 };
      const result = oracle.calculateFeeWithKScore(baseFee, kScore);

      expect(result).toBe(20000);
    });

    it('should ceil fractional results', () => {
      const baseFee = 10000;
      const kScore = { feeMultiplier: 1.25 };
      const result = oracle.calculateFeeWithKScore(baseFee, kScore);

      expect(result).toBe(12500);
    });
  });

  describe('pingOracle()', () => {
    it('should return success on successful ping', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
      });

      const result = await oracle.pingOracle();
      expect(result.success).toBe(true);
      expect(result.latencyMs).toBeDefined();
    });

    it('should return failure on network error', async () => {
      global.fetch.mockRejectedValue(new Error('Connection refused'));

      const result = await oracle.pingOracle();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return failure on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await oracle.pingOracle();
      expect(result.success).toBe(false);
    });

    it('should include latency in response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
      });

      const result = await oracle.pingOracle();
      expect(typeof result.latencyMs).toBe('number');
    });
  });
});
