/**
 * Tests for Oracle Service (Legacy wrapper for HolDex)
 */

// Mock holdex before requiring oracle
jest.mock('../../../src/services/holdex', () => ({
  getToken: jest.fn(),
  getKRank: jest.fn((score) => {
    if (score >= 90) return { tier: 'Diamond', icon: '💎', level: 8 };
    if (score >= 80) return { tier: 'Platinum', icon: '💠', level: 7 };
    if (score >= 70) return { tier: 'Gold', icon: '🥇', level: 6 };
    if (score >= 60) return { tier: 'Silver', icon: '🥈', level: 5 };
    if (score >= 50) return { tier: 'Bronze', icon: '🥉', level: 4 };
    if (score >= 40) return { tier: 'Copper', icon: '🟤', level: 3 };
    if (score >= 20) return { tier: 'Iron', icon: '⚫', level: 2 };
    return { tier: 'Rust', icon: '🔩', level: 1 };
  }),
  getCacheStats: jest.fn(() => ({ totalEntries: 0, validEntries: 0, expiredEntries: 0 })),
  clearCache: jest.fn(),
}));

// Mock config
jest.mock('../../../src/utils/config', () => ({
  HOLDEX_URL: 'http://localhost:3001',
  IS_DEV: true,
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

const oracle = require('../../../src/services/oracle');
const holdex = require('../../../src/services/holdex');

describe('Oracle Service (Legacy)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch.mockReset();
  });

  describe('K_TIERS', () => {
    it('should define TRUSTED tier (no feeMultiplier - $ASDF philosophy)', () => {
      expect(oracle.K_TIERS.TRUSTED).toBeDefined();
      expect(oracle.K_TIERS.TRUSTED.minScore).toBe(80);
      // No feeMultiplier - same fee for all accepted tokens
      expect(oracle.K_TIERS.TRUSTED.feeMultiplier).toBeUndefined();
    });

    it('should define STANDARD tier', () => {
      expect(oracle.K_TIERS.STANDARD).toBeDefined();
      expect(oracle.K_TIERS.STANDARD.minScore).toBe(50);
    });

    it('should define RISKY tier', () => {
      expect(oracle.K_TIERS.RISKY).toBeDefined();
      expect(oracle.K_TIERS.RISKY.minScore).toBe(20);
    });

    it('should define UNKNOWN tier', () => {
      expect(oracle.K_TIERS.UNKNOWN).toBeDefined();
      expect(oracle.K_TIERS.UNKNOWN.minScore).toBe(0);
    });
  });

  describe('TRUSTED_TOKENS (Diamond tier)', () => {
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
      expect(health.provider).toBe('HolDex');
    });

    it('should include URL', () => {
      const health = oracle.getOracleHealth();
      expect(health.url).toBeDefined();
    });

    it('should include status field', () => {
      const health = oracle.getOracleHealth();
      expect(health.status).toBeDefined();
    });

    it('should include cache size from HolDex', () => {
      holdex.getCacheStats.mockReturnValue({ totalEntries: 5, validEntries: 3, expiredEntries: 2 });
      const health = oracle.getOracleHealth();
      expect(health.cacheSize).toBe(5);
      expect(health.validCacheEntries).toBe(3);
    });
  });

  describe('clearCache()', () => {
    it('should delegate to HolDex clearCache', () => {
      oracle.clearCache();
      expect(holdex.clearCache).toHaveBeenCalled();
    });
  });

  describe('getKScore()', () => {
    it('should return TRUSTED for Diamond tokens (instant, no network)', async () => {
      const result = await oracle.getKScore('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(result.tier).toBe('TRUSTED');
      expect(result.score).toBe(100);
      // Should NOT call holdex for Diamond tokens
      expect(holdex.getToken).not.toHaveBeenCalled();
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

    it('should delegate to HolDex for non-Diamond tokens', async () => {
      holdex.getToken.mockResolvedValue({
        tier: 'Gold',
        kScore: 75,
        hasCommunityUpdate: true,
        cached: false,
      });

      const result = await oracle.getKScore('unknown_token_123');

      expect(holdex.getToken).toHaveBeenCalledWith('unknown_token_123');
      expect(result.tier).toBe('STANDARD'); // Gold maps to STANDARD
      expect(result.holdexTier).toBe('Gold');
    });

    it('should map Platinum tier to TRUSTED', async () => {
      holdex.getToken.mockResolvedValue({
        tier: 'Platinum',
        kScore: 85,
        hasCommunityUpdate: true,
        cached: false,
      });

      const result = await oracle.getKScore('platinum_token');
      expect(result.tier).toBe('TRUSTED');
      expect(result.holdexTier).toBe('Platinum');
    });

    it('should map Silver tier to RISKY', async () => {
      holdex.getToken.mockResolvedValue({
        tier: 'Silver',
        kScore: 65,
        hasCommunityUpdate: true,
        cached: false,
      });

      const result = await oracle.getKScore('silver_token');
      expect(result.tier).toBe('RISKY');
      expect(result.holdexTier).toBe('Silver');
    });

    it('should map Bronze tier to RISKY', async () => {
      holdex.getToken.mockResolvedValue({
        tier: 'Bronze',
        kScore: 55,
        kRank: { tier: 'Bronze', icon: '🥉', level: 4 },
        hasCommunityUpdate: false,
        cached: false,
      });

      const result = await oracle.getKScore('bronze_token');
      expect(result.tier).toBe('RISKY');
      expect(result.holdexTier).toBe('Bronze');
    });

    it('should map Rust tier to UNKNOWN', async () => {
      holdex.getToken.mockResolvedValue({
        tier: 'Rust',
        kScore: 5,
        kRank: { tier: 'Rust', icon: '🔩', level: 1 },
        hasCommunityUpdate: false,
        cached: false,
      });

      const result = await oracle.getKScore('rust_token');
      expect(result.tier).toBe('UNKNOWN');
      expect(result.holdexTier).toBe('Rust');
      expect(result.kRank.level).toBe(1);
    });

    it('should include kRank in result', async () => {
      const result = await oracle.getKScore('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(result.kRank).toBeDefined();
      expect(result.kRank.tier).toBe('Diamond');
      expect(result.kRank.level).toBe(8);
    });

    it('should include score in result', async () => {
      const result = await oracle.getKScore('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(result.score).toBeDefined();
      expect(typeof result.score).toBe('number');
    });
  });

  describe('pingOracle()', () => {
    it('should ping HolDex health endpoint', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      const result = await oracle.pingOracle();

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3001/health', expect.any(Object));
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
      global.fetch.mockResolvedValue({ ok: true });

      const result = await oracle.pingOracle();
      expect(typeof result.latencyMs).toBe('number');
    });
  });
});
