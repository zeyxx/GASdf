/**
 * Tests for HolDex Integration - Token Verification & K-score Oracle
 */

jest.mock('../../../src/utils/config', () => ({
  HOLDEX_URL: 'https://holdex.test',
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('HolDex Service', () => {
  let holdex;
  let config;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset fetch mock
    global.fetch = jest.fn();

    config = require('../../../src/utils/config');
    logger = require('../../../src/utils/logger');
    holdex = require('../../../src/services/holdex');

    // Clear cache before each test
    holdex.clearCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('ACCEPTED_TIERS', () => {
    it('should include Diamond, Platinum, and Gold', () => {
      expect(holdex.ACCEPTED_TIERS.has('Diamond')).toBe(true);
      expect(holdex.ACCEPTED_TIERS.has('Platinum')).toBe(true);
      expect(holdex.ACCEPTED_TIERS.has('Gold')).toBe(true);
    });

    it('should NOT include Silver, Bronze, and Rust', () => {
      expect(holdex.ACCEPTED_TIERS.has('Silver')).toBe(false);
      expect(holdex.ACCEPTED_TIERS.has('Bronze')).toBe(false);
      expect(holdex.ACCEPTED_TIERS.has('Rust')).toBe(false);
    });
  });

  describe('VALID_TIERS', () => {
    it('should include all tier names including Rust', () => {
      expect(holdex.VALID_TIERS.has('Diamond')).toBe(true);
      expect(holdex.VALID_TIERS.has('Platinum')).toBe(true);
      expect(holdex.VALID_TIERS.has('Gold')).toBe(true);
      expect(holdex.VALID_TIERS.has('Silver')).toBe(true);
      expect(holdex.VALID_TIERS.has('Bronze')).toBe(true);
      expect(holdex.VALID_TIERS.has('Rust')).toBe(true);
    });
  });

  describe('getKRank()', () => {
    it('should return Diamond for score >= 90', () => {
      expect(holdex.getKRank(90)).toEqual({ tier: 'Diamond', icon: '💎', level: 6 });
      expect(holdex.getKRank(100)).toEqual({ tier: 'Diamond', icon: '💎', level: 6 });
    });

    it('should return Platinum for score >= 80', () => {
      expect(holdex.getKRank(80)).toEqual({ tier: 'Platinum', icon: '💠', level: 5 });
      expect(holdex.getKRank(89)).toEqual({ tier: 'Platinum', icon: '💠', level: 5 });
    });

    it('should return Gold for score >= 60', () => {
      expect(holdex.getKRank(60)).toEqual({ tier: 'Gold', icon: '🥇', level: 4 });
      expect(holdex.getKRank(79)).toEqual({ tier: 'Gold', icon: '🥇', level: 4 });
    });

    it('should return Silver for score >= 40', () => {
      expect(holdex.getKRank(40)).toEqual({ tier: 'Silver', icon: '🥈', level: 3 });
      expect(holdex.getKRank(59)).toEqual({ tier: 'Silver', icon: '🥈', level: 3 });
    });

    it('should return Bronze for score >= 20', () => {
      expect(holdex.getKRank(20)).toEqual({ tier: 'Bronze', icon: '🥉', level: 2 });
      expect(holdex.getKRank(39)).toEqual({ tier: 'Bronze', icon: '🥉', level: 2 });
    });

    it('should return Rust for score < 20', () => {
      expect(holdex.getKRank(0)).toEqual({ tier: 'Rust', icon: '🔩', level: 1 });
      expect(holdex.getKRank(19)).toEqual({ tier: 'Rust', icon: '🔩', level: 1 });
    });
  });

  describe('getCreditRating()', () => {
    it('should return A1 for score >= 90', () => {
      const rating = holdex.getCreditRating(95);
      expect(rating.grade).toBe('A1');
      expect(rating.label).toBe('Prime Quality');
      expect(rating.risk).toBe('minimal');
    });

    it('should return A2 for score >= 80', () => {
      const rating = holdex.getCreditRating(85);
      expect(rating.grade).toBe('A2');
      expect(rating.risk).toBe('very_low');
    });

    it('should return B1 for score >= 60', () => {
      const rating = holdex.getCreditRating(65);
      expect(rating.grade).toBe('B1');
      expect(rating.risk).toBe('moderate');
    });

    it('should return D for score < 20', () => {
      const rating = holdex.getCreditRating(10);
      expect(rating.grade).toBe('D');
      expect(rating.label).toBe('Default');
      expect(rating.risk).toBe('extreme');
    });

    it('should apply trajectory bonus for improving', () => {
      const stable = holdex.getCreditRating(87); // A2 normally
      const improving = holdex.getCreditRating(87, 'improving'); // +5 = 92 -> A1
      expect(stable.grade).toBe('A2');
      expect(improving.grade).toBe('A1');
      expect(improving.outlook).toBe('positive');
    });

    it('should apply trajectory malus for declining', () => {
      const stable = holdex.getCreditRating(92); // A1 normally
      const declining = holdex.getCreditRating(92, 'declining'); // -5 = 87 -> A2
      expect(stable.grade).toBe('A1');
      expect(declining.grade).toBe('A2');
      expect(declining.outlook).toBe('negative');
    });
  });

  describe('getToken()', () => {
    const testMint = 'TestMint111111111111111111111111111111111111';

    it('should return tier, kScore, and kRank from API', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ kScore: 65, hasCommunityUpdate: true }),
      });

      const result = await holdex.getToken(testMint);

      expect(result.tier).toBe('Gold');
      expect(result.kScore).toBe(65);
      expect(result.kRank).toEqual({ tier: 'Gold', icon: '🥇', level: 4 });
      expect(result.hasCommunityUpdate).toBe(true);
      expect(result.cached).toBe(false);
    });

    it('should handle nested token response with kRank', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          token: {
            kScore: 85,
            kRank: { tier: 'Platinum', icon: '💠', level: 5 },
            hasCommunityUpdate: true
          }
        }),
      });

      const result = await holdex.getToken(testMint);

      expect(result.tier).toBe('Platinum');
      expect(result.kScore).toBe(85);
      expect(result.kRank.level).toBe(5);
    });

    it('should handle conviction data from API', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          token: {
            kScore: 75,
            conviction: {
              score: 80,
              accumulators: 150,
              holders: 200,
              reducers: 30,
              extractors: 20,
              analyzed: 400
            }
          }
        }),
      });

      const result = await holdex.getToken(testMint);

      expect(result.conviction).toBeDefined();
      expect(result.conviction.score).toBe(80);
      expect(result.conviction.accumulators).toBe(150);
      expect(result.conviction.extractors).toBe(20);
    });

    it('should calculate kRank locally for invalid API tier', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ kScore: 50 }),
      });

      const result = await holdex.getToken(testMint);

      expect(result.tier).toBe('Silver');
      expect(result.kRank).toEqual({ tier: 'Silver', icon: '🥈', level: 3 });
    });

    it('should return Rust for 404 (token not found)', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await holdex.getToken(testMint);

      expect(result.tier).toBe('Rust');
      expect(result.kScore).toBe(0);
      expect(result.kRank).toEqual({ tier: 'Rust', icon: '🔩', level: 1 });
      expect(result.hasCommunityUpdate).toBe(false);
    });

    it('should cache results', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Gold', kScore: 70 }),
      });

      // First call
      await holdex.getToken(testMint);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result = await holdex.getToken(testMint);
      expect(result.cached).toBe(true);
      expect(result.tier).toBe('Gold');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should return Rust with error when HOLDEX_URL not configured', async () => {
      const originalUrl = config.HOLDEX_URL;
      config.HOLDEX_URL = undefined;

      const result = await holdex.getToken(testMint);

      expect(result.tier).toBe('Rust');
      expect(result.kRank.level).toBe(1);
      expect(result.error).toContain('not configured');

      config.HOLDEX_URL = originalUrl;
    });

    it('should handle fetch errors gracefully', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      const result = await holdex.getToken(testMint);

      expect(result.tier).toBe('Rust');
      expect(result.kRank).toEqual({ tier: 'Rust', icon: '🔩', level: 1 });
      expect(result.error).toBe('Network error');
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('isTokenAccepted() with Rust tier', () => {
    const testMint = 'TestMint111111111111111111111111111111111111';

    it('should reject Rust tier tokens', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ kScore: 10 }),
      });

      const result = await holdex.isTokenAccepted(testMint);

      expect(result.accepted).toBe(false);
      expect(result.tier).toBe('Rust');
    });
  });

  describe('isTokenAccepted()', () => {
    const testMint = 'TestMint111111111111111111111111111111111111';

    it('should accept Gold tier tokens', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Gold', kScore: 65, hasCommunityUpdate: true }),
      });

      const result = await holdex.isTokenAccepted(testMint);

      expect(result.accepted).toBe(true);
      expect(result.tier).toBe('Gold');
    });

    it('should accept Platinum tier tokens', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Platinum', kScore: 85 }),
      });

      const result = await holdex.isTokenAccepted(testMint);

      expect(result.accepted).toBe(true);
      expect(result.tier).toBe('Platinum');
    });

    it('should accept Diamond tier tokens', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Diamond', kScore: 100 }),
      });

      const result = await holdex.isTokenAccepted(testMint);

      expect(result.accepted).toBe(true);
      expect(result.tier).toBe('Diamond');
    });

    it('should reject Silver tier tokens', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ kScore: 45 }), // 40-59 = Silver
      });

      const result = await holdex.isTokenAccepted(testMint);

      expect(result.accepted).toBe(false);
      expect(result.tier).toBe('Silver');
    });

    it('should reject Bronze tier tokens', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ kScore: 25 }), // 20-39 = Bronze
      });

      const result = await holdex.isTokenAccepted(testMint);

      expect(result.accepted).toBe(false);
      expect(result.tier).toBe('Bronze');
    });
  });

  describe('isVerifiedCommunity() (legacy)', () => {
    const testMint = 'TestMint111111111111111111111111111111111111';

    it('should return verified=true for accepted tiers with hasCommunityUpdate', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Gold', kScore: 70, hasCommunityUpdate: true }),
      });

      const result = await holdex.isVerifiedCommunity(testMint);

      expect(result.verified).toBe(true);
      expect(result.kScore).toBe(70);
    });

    it('should return verified=false for rejected tiers', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Silver', kScore: 30, hasCommunityUpdate: true }),
      });

      const result = await holdex.isVerifiedCommunity(testMint);

      expect(result.verified).toBe(false);
      expect(result.kScore).toBe(30);
    });

    it('should return verified=false when hasCommunityUpdate is false', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Gold', kScore: 70, hasCommunityUpdate: false }),
      });

      const result = await holdex.isVerifiedCommunity(testMint);

      expect(result.verified).toBe(false);
    });
  });

  describe('clearCache()', () => {
    it('should clear the cache', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Gold', kScore: 70 }),
      });

      const testMint = 'CacheMint11111111111111111111111111111111111';

      // Populate cache
      await holdex.getToken(testMint);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Clear cache
      holdex.clearCache();

      // Should fetch again
      await holdex.getToken(testMint);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should log cache clear', () => {
      holdex.clearCache();
      expect(logger.info).toHaveBeenCalledWith('HOLDEX', 'Cache cleared');
    });
  });

  describe('getCacheStats()', () => {
    it('should return cache statistics', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Gold', kScore: 70 }),
      });

      await holdex.getToken('Mint1111111111111111111111111111111111111111');
      await holdex.getToken('Mint2222222222222222222222222222222222222222');

      const stats = holdex.getCacheStats();

      expect(stats.totalEntries).toBe(2);
      expect(stats.validEntries).toBe(2);
      expect(stats.expiredEntries).toBe(0);
    });

    it('should return empty stats for empty cache', () => {
      const stats = holdex.getCacheStats();

      expect(stats.totalEntries).toBe(0);
      expect(stats.validEntries).toBe(0);
      expect(stats.expiredEntries).toBe(0);
    });
  });
});
