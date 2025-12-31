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
    it('should include Diamond, Platinum, Gold, Silver, and Bronze (K-score >= 50)', () => {
      expect(holdex.ACCEPTED_TIERS.has('Diamond')).toBe(true);
      expect(holdex.ACCEPTED_TIERS.has('Platinum')).toBe(true);
      expect(holdex.ACCEPTED_TIERS.has('Gold')).toBe(true);
      expect(holdex.ACCEPTED_TIERS.has('Silver')).toBe(true);
      expect(holdex.ACCEPTED_TIERS.has('Bronze')).toBe(true);
    });

    it('should NOT include Copper, Iron, and Rust (K-score < 50)', () => {
      expect(holdex.ACCEPTED_TIERS.has('Copper')).toBe(false);
      expect(holdex.ACCEPTED_TIERS.has('Iron')).toBe(false);
      expect(holdex.ACCEPTED_TIERS.has('Rust')).toBe(false);
    });
  });

  describe('VALID_TIERS', () => {
    it('should include all tier names', () => {
      expect(holdex.VALID_TIERS.has('Diamond')).toBe(true);
      expect(holdex.VALID_TIERS.has('Platinum')).toBe(true);
      expect(holdex.VALID_TIERS.has('Gold')).toBe(true);
      expect(holdex.VALID_TIERS.has('Silver')).toBe(true);
      expect(holdex.VALID_TIERS.has('Bronze')).toBe(true);
      expect(holdex.VALID_TIERS.has('Copper')).toBe(true);
      expect(holdex.VALID_TIERS.has('Iron')).toBe(true);
      expect(holdex.VALID_TIERS.has('Rust')).toBe(true);
    });
  });

  describe('getKRank()', () => {
    it('should return Diamond for score >= 90', () => {
      expect(holdex.getKRank(90)).toEqual({ tier: 'Diamond', icon: '💎', level: 8 });
      expect(holdex.getKRank(100)).toEqual({ tier: 'Diamond', icon: '💎', level: 8 });
    });

    it('should return Platinum for score 80-89', () => {
      expect(holdex.getKRank(80)).toEqual({ tier: 'Platinum', icon: '💠', level: 7 });
      expect(holdex.getKRank(89)).toEqual({ tier: 'Platinum', icon: '💠', level: 7 });
    });

    it('should return Gold for score 70-79', () => {
      expect(holdex.getKRank(70)).toEqual({ tier: 'Gold', icon: '🥇', level: 6 });
      expect(holdex.getKRank(79)).toEqual({ tier: 'Gold', icon: '🥇', level: 6 });
    });

    it('should return Silver for score 60-69', () => {
      expect(holdex.getKRank(60)).toEqual({ tier: 'Silver', icon: '🥈', level: 5 });
      expect(holdex.getKRank(69)).toEqual({ tier: 'Silver', icon: '🥈', level: 5 });
    });

    it('should return Bronze for score 50-59', () => {
      expect(holdex.getKRank(50)).toEqual({ tier: 'Bronze', icon: '🥉', level: 4 });
      expect(holdex.getKRank(59)).toEqual({ tier: 'Bronze', icon: '🥉', level: 4 });
    });

    it('should return Copper for score 40-49', () => {
      expect(holdex.getKRank(40)).toEqual({ tier: 'Copper', icon: '🟤', level: 3 });
      expect(holdex.getKRank(49)).toEqual({ tier: 'Copper', icon: '🟤', level: 3 });
    });

    it('should return Iron for score 20-39', () => {
      expect(holdex.getKRank(20)).toEqual({ tier: 'Iron', icon: '⚫', level: 2 });
      expect(holdex.getKRank(39)).toEqual({ tier: 'Iron', icon: '⚫', level: 2 });
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
        json: () => Promise.resolve({ kScore: 75, hasCommunityUpdate: true }),
      });

      const result = await holdex.getToken(testMint);

      expect(result.tier).toBe('Gold');
      expect(result.kScore).toBe(75);
      expect(result.kRank).toEqual({ tier: 'Gold', icon: '🥇', level: 6 });
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
        json: () => Promise.resolve({ kScore: 55 }),
      });

      const result = await holdex.getToken(testMint);

      expect(result.tier).toBe('Bronze');
      expect(result.kRank).toEqual({ tier: 'Bronze', icon: '🥉', level: 4 });
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
        json: () => Promise.resolve({ tier: 'Gold', kScore: 75, hasCommunityUpdate: true }),
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

    it('should accept Silver tier tokens (K-score >= 50)', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ kScore: 65 }), // 60-69 = Silver
      });

      const result = await holdex.isTokenAccepted(testMint);

      expect(result.accepted).toBe(true);
      expect(result.tier).toBe('Silver');
    });

    it('should accept Bronze tier tokens (K-score >= 50)', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ kScore: 55 }), // 50-59 = Bronze
      });

      const result = await holdex.isTokenAccepted(testMint);

      expect(result.accepted).toBe(true);
      expect(result.tier).toBe('Bronze');
    });

    it('should reject Copper tier tokens (K-score < 50)', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ kScore: 45 }), // 40-49 = Copper
      });

      const result = await holdex.isTokenAccepted(testMint);

      expect(result.accepted).toBe(false);
      expect(result.tier).toBe('Copper');
    });
  });

  describe('isVerifiedCommunity() (legacy)', () => {
    const testMint = 'TestMint111111111111111111111111111111111111';

    it('should return verified=true for accepted tiers with hasCommunityUpdate', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Gold', kScore: 75, hasCommunityUpdate: true }),
      });

      const result = await holdex.isVerifiedCommunity(testMint);

      expect(result.verified).toBe(true);
      expect(result.kScore).toBe(75);
    });

    it('should return verified=false for rejected tiers (K-score < 50)', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Copper', kScore: 45, hasCommunityUpdate: true }),
      });

      const result = await holdex.isVerifiedCommunity(testMint);

      expect(result.verified).toBe(false);
      expect(result.kScore).toBe(45);
    });

    it('should return verified=true for Silver tier (now accepted)', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Silver', kScore: 65, hasCommunityUpdate: true }),
      });

      const result = await holdex.isVerifiedCommunity(testMint);

      expect(result.verified).toBe(true);
      expect(result.kScore).toBe(65);
    });

    it('should return verified=false when hasCommunityUpdate is false', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tier: 'Gold', kScore: 75, hasCommunityUpdate: false }),
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

  // ==========================================================================
  // PURE GOLDEN DUAL-BURN FLYWHEEL TESTS
  // ==========================================================================

  describe('Pure Golden Ratio Constants', () => {
    it('should export PHI as the Golden Ratio ≈ 1.618', () => {
      expect(holdex.PHI).toBeCloseTo(1.618033988749, 6);
    });

    it('should export PHI_SQUARED ≈ 2.618', () => {
      expect(holdex.PHI_SQUARED).toBeCloseTo(2.618033988749, 5);
    });

    it('should export PHI_CUBED ≈ 4.236', () => {
      expect(holdex.PHI_CUBED).toBeCloseTo(4.236067977499, 5);
    });

    it('should export MAX_ECOSYSTEM_BURN_PCT as 1/φ² ≈ 38.2%', () => {
      expect(holdex.MAX_ECOSYSTEM_BURN_PCT).toBeCloseTo(0.381966, 5);
      expect(holdex.MAX_ECOSYSTEM_BURN_PCT).toBeCloseTo(1 / holdex.PHI_SQUARED, 10);
    });

    it('should export TREASURY_RATIO as 1/φ³ ≈ 23.6%', () => {
      expect(holdex.TREASURY_RATIO).toBeCloseTo(0.236068, 5);
      expect(holdex.TREASURY_RATIO).toBeCloseTo(1 / holdex.PHI_CUBED, 10);
    });

    it('should have Pure Golden split sum to 100%', () => {
      // Max ecosystem + min ASDF + treasury = 100%
      // 38.2% + 38.2% + 23.6% = 100%
      const maxEco = holdex.MAX_ECOSYSTEM_BURN_PCT;
      const treasury = holdex.TREASURY_RATIO;
      const minAsdf = 1 - treasury - maxEco;
      expect(maxEco + minAsdf + treasury).toBeCloseTo(1.0, 10);
    });

    it('should export PUMP_FUN_INITIAL_SUPPLY as 1 trillion (with decimals)', () => {
      expect(holdex.PUMP_FUN_INITIAL_SUPPLY).toBe(1_000_000_000_000_000);
    });
  });

  describe('calculateBurnedPercent()', () => {
    it('should return 0 when currentSupply is 0', () => {
      expect(holdex.calculateBurnedPercent(0)).toBe(0);
    });

    it('should return 0 when currentSupply is negative', () => {
      expect(holdex.calculateBurnedPercent(-1)).toBe(0);
    });

    it('should return 0 when currentSupply >= initialSupply (no burns)', () => {
      expect(holdex.calculateBurnedPercent(1_000_000_000_000_000)).toBe(0);
      expect(holdex.calculateBurnedPercent(1_100_000_000_000_000)).toBe(0);
    });

    it('should calculate 10% burned correctly', () => {
      // 90% remaining = 10% burned
      const currentSupply = 900_000_000_000_000; // 90% of initial
      const result = holdex.calculateBurnedPercent(currentSupply);
      expect(result).toBeCloseTo(10, 5);
    });

    it('should calculate 50% burned correctly', () => {
      const currentSupply = 500_000_000_000_000; // 50% of initial
      const result = holdex.calculateBurnedPercent(currentSupply);
      expect(result).toBeCloseTo(50, 5);
    });

    it('should calculate 80% burned correctly', () => {
      const currentSupply = 200_000_000_000_000; // 20% remaining = 80% burned
      const result = holdex.calculateBurnedPercent(currentSupply);
      expect(result).toBeCloseTo(80, 5);
    });

    it('should use custom initial supply when provided', () => {
      const initialSupply = 100_000_000; // Custom 100M
      const currentSupply = 75_000_000; // 75% remaining = 25% burned
      const result = holdex.calculateBurnedPercent(currentSupply, initialSupply);
      expect(result).toBeCloseTo(25, 5);
    });
  });

  describe('calculateEcosystemBurnBonus() - Pure Golden Formula', () => {
    // Golden ratio constants (defined locally to avoid module loading issues)
    const PHI = 1.618033988749;
    const PHI_SQUARED = PHI * PHI;
    const PHI_CUBED = PHI * PHI * PHI;
    const maxEco = 1 / PHI_SQUARED; // 1/φ² ≈ 38.2%
    const treasuryPct = 1 / PHI_CUBED; // 1/φ³ ≈ 23.6%
    const burnablePct = 1 - treasuryPct; // ≈ 76.4%

    it('should return no bonus for 0% burned', () => {
      const result = holdex.calculateEcosystemBurnBonus(0);
      expect(result.ecosystemBurnPct).toBe(0);
      expect(result.asdfBurnPct).toBeCloseTo(burnablePct, 5);
      expect(result.treasuryPct).toBeCloseTo(treasuryPct, 5);
      expect(result.explanation).toContain('No ecosystem burn bonus');
    });

    it('should return no bonus for negative burned percent', () => {
      const result = holdex.calculateEcosystemBurnBonus(-5);
      expect(result.ecosystemBurnPct).toBe(0);
      expect(result.asdfBurnPct).toBeCloseTo(burnablePct, 5);
    });

    it('should use golden formula: (1/φ²) × (1 - φ^(-b/30))', () => {
      // For 30% burned: multiplier = 1 - φ^(-1) = 1 - 0.618 = 0.382
      // ecosystemBurn = 0.382 × 0.382 ≈ 14.6%
      const result = holdex.calculateEcosystemBurnBonus(30);
      const expectedMultiplier = 1 - Math.pow(PHI, -30/30);
      const expectedEco = maxEco * expectedMultiplier;
      expect(result.ecosystemBurnPct).toBeCloseTo(expectedEco, 5);
    });

    it('should calculate correct ecosystem burn for 20% token burned', () => {
      // Formula: (1/φ²) × (1 - φ^(-20/30))
      const result = holdex.calculateEcosystemBurnBonus(20);
      const expectedMultiplier = 1 - Math.pow(PHI, -20/30);
      const expectedEco = maxEco * expectedMultiplier;
      expect(result.ecosystemBurnPct).toBeCloseTo(expectedEco, 5);
      expect(result.ecosystemBurnPct).toBeCloseTo(0.105, 2); // ~10.5%
    });

    it('should calculate correct ecosystem burn for 50% token burned', () => {
      const result = holdex.calculateEcosystemBurnBonus(50);
      const expectedMultiplier = 1 - Math.pow(PHI, -50/30);
      const expectedEco = maxEco * expectedMultiplier;
      expect(result.ecosystemBurnPct).toBeCloseTo(expectedEco, 5);
    });

    it('should asymptotically approach 1/φ² (38.2%) for very high burn rates', () => {
      const result90 = holdex.calculateEcosystemBurnBonus(90);
      const result100 = holdex.calculateEcosystemBurnBonus(100);
      const result200 = holdex.calculateEcosystemBurnBonus(200);

      // Should approach but never quite reach maxEco
      expect(result90.ecosystemBurnPct).toBeLessThan(maxEco);
      expect(result100.ecosystemBurnPct).toBeLessThan(maxEco);
      expect(result200.ecosystemBurnPct).toBeLessThan(maxEco);

      // Higher burn = closer to max
      expect(result100.ecosystemBurnPct).toBeGreaterThan(result90.ecosystemBurnPct);
      expect(result200.ecosystemBurnPct).toBeGreaterThan(result100.ecosystemBurnPct);

      // At 200% (impossible but test asymptote), should be very close
      expect(result200.ecosystemBurnPct).toBeCloseTo(maxEco, 1);
    });

    it('should maintain 1/φ³ (23.6%) treasury regardless of ecosystem burn', () => {
      [0, 10, 20, 50, 80, 100].forEach(burnedPercent => {
        const result = holdex.calculateEcosystemBurnBonus(burnedPercent);
        expect(result.treasuryPct).toBeCloseTo(treasuryPct, 5);
      });
    });

    it('should have percentages sum to 100%', () => {
      [0, 10, 20, 50, 80, 100].forEach(burnedPercent => {
        const result = holdex.calculateEcosystemBurnBonus(burnedPercent);
        const total = result.ecosystemBurnPct + result.asdfBurnPct + result.treasuryPct;
        expect(total).toBeCloseTo(1.0, 5);
      });
    });

    it('should include φ-curve in explanation', () => {
      const result = holdex.calculateEcosystemBurnBonus(20);
      expect(result.explanation).toContain('φ-curve');
      expect(result.explanation).toContain('20.0%');
    });

    it('should demonstrate diminishing returns (golden curve property)', () => {
      // First 10% burn gives more bonus per % than last 10%
      const result10 = holdex.calculateEcosystemBurnBonus(10);
      const result20 = holdex.calculateEcosystemBurnBonus(20);
      const result90 = holdex.calculateEcosystemBurnBonus(90);
      const result100 = holdex.calculateEcosystemBurnBonus(100);

      const gain0to10 = result10.ecosystemBurnPct - 0;
      const gain10to20 = result20.ecosystemBurnPct - result10.ecosystemBurnPct;
      const gain90to100 = result100.ecosystemBurnPct - result90.ecosystemBurnPct;

      // Early burns more rewarding than late burns
      expect(gain0to10).toBeGreaterThan(gain10to20);
      expect(gain10to20).toBeGreaterThan(gain90to100);
    });
  });

  describe('getToken() with supply and ecosystem burn data', () => {
    const testMint = 'TestMint111111111111111111111111111111111111';
    // Golden ratio constants (defined locally)
    const PHI = 1.618033988749;
    const PHI_SQUARED = PHI * PHI;
    const PHI_CUBED = PHI * PHI * PHI;
    const treasuryPct = 1 / PHI_CUBED;
    const maxEco = 1 / PHI_SQUARED;

    it('should include supply data when available from API', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          token: {
            kScore: 75,
            supply: '800000000000000', // 80% remaining = 20% burned
          }
        }),
      });

      const result = await holdex.getToken(testMint);

      expect(result.supply).toBeDefined();
      expect(result.supply.current).toBe(800000000000000);
      expect(result.supply.burnedPercent).toBeCloseTo(20, 5);
    });

    it('should include ecosystemBurn data with golden formula', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          token: {
            kScore: 75,
            supply: '800000000000000', // 20% burned
          }
        }),
      });

      const result = await holdex.getToken(testMint);

      expect(result.ecosystemBurn).toBeDefined();
      // Golden formula: (1/φ²) × (1 - φ^(-20/30)) ≈ 10.5%
      const expectedMultiplier = 1 - Math.pow(PHI, -20/30);
      const expectedEco = maxEco * expectedMultiplier;
      expect(result.ecosystemBurn.ecosystemBurnPct).toBeCloseTo(expectedEco, 4);
      expect(result.ecosystemBurn.treasuryPct).toBeCloseTo(treasuryPct, 5);
      // Total should be 100%
      const total = result.ecosystemBurn.ecosystemBurnPct +
                   result.ecosystemBurn.asdfBurnPct +
                   result.ecosystemBurn.treasuryPct;
      expect(total).toBeCloseTo(1.0, 5);
    });

    it('should handle missing supply data gracefully', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          kScore: 75,
          // No supply field
        }),
      });

      const result = await holdex.getToken(testMint);

      expect(result.supply).toBeDefined();
      expect(result.supply.burnedPercent).toBe(0);
      expect(result.ecosystemBurn.ecosystemBurnPct).toBe(0);
      expect(result.ecosystemBurn.treasuryPct).toBeCloseTo(treasuryPct, 5);
    });
  });
});
