/**
 * Holder Tiers Service Tests - Supply-Based Discount System
 */

// Golden Ratio constants for tests
const PHI = 1.618033988749;
const PHI_CUBED = PHI * PHI * PHI;
const GOLDEN_TREASURY_RATIO = 1 / PHI_CUBED; // ~23.6%

// Mock dependencies first
jest.mock('../../../src/utils/config', () => ({
  ASDF_MINT: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
  IS_DEV: true,
  TREASURY_RATIO: 1 / (1.618033988749 ** 3), // Pure Golden: 1/φ³ ≈ 23.6%
}));

jest.mock('../../../src/utils/rpc', () => ({
  getConnection: jest.fn().mockReturnValue({
    getParsedTokenAccountsByOwner: jest.fn(),
    getTokenSupply: jest.fn(),
  }),
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  calculateDiscountFromShare,
  applyDiscount,
  calculateDiscountedFee,
  calculateBreakEvenFee,
  getAllTiers,
  getTierName,
  clearCache,
  setCirculatingSupply,
  ORIGINAL_SUPPLY,
} = require('../../../src/services/holder-tiers');
const { getConnection } = require('../../../src/utils/rpc');

describe('Holder Tiers Service - Supply-Based Discount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });

  describe('calculateDiscountFromShare()', () => {
    // Formula: discount = min(95%, max(0, (log₁₀(share) + 5) / 3))

    it('should return 0 for 0 share', () => {
      expect(calculateDiscountFromShare(0)).toBe(0);
    });

    it('should return 0 for negative share', () => {
      expect(calculateDiscountFromShare(-0.001)).toBe(0);
    });

    it('should return 0% for 0.001% share (10⁻⁵)', () => {
      // log₁₀(0.00001) = -5, (-5 + 5) / 3 = 0
      const share = 0.00001; // 0.001%
      expect(calculateDiscountFromShare(share)).toBeCloseTo(0, 5);
    });

    it('should return ~33% for 0.01% share (10⁻⁴)', () => {
      // log₁₀(0.0001) = -4, (-4 + 5) / 3 = 0.333...
      const share = 0.0001; // 0.01%
      expect(calculateDiscountFromShare(share)).toBeCloseTo(0.333, 2);
    });

    it('should return ~67% for 0.1% share (10⁻³)', () => {
      // log₁₀(0.001) = -3, (-3 + 5) / 3 = 0.666...
      const share = 0.001; // 0.1%
      expect(calculateDiscountFromShare(share)).toBeCloseTo(0.667, 2);
    });

    it('should cap at 95% for 1% share (10⁻²)', () => {
      // log₁₀(0.01) = -2, (-2 + 5) / 3 = 1.0 → capped at 0.95
      const share = 0.01; // 1%
      expect(calculateDiscountFromShare(share)).toBe(0.95);
    });

    it('should cap at 95% for shares above 1%', () => {
      expect(calculateDiscountFromShare(0.1)).toBe(0.95);  // 10%
      expect(calculateDiscountFromShare(0.5)).toBe(0.95);  // 50%
      expect(calculateDiscountFromShare(1.0)).toBe(0.95);  // 100%
    });

    it('should handle intermediate values correctly', () => {
      // 0.003% share = 0.00003
      // log₁₀(0.00003) ≈ -4.52, (-4.52 + 5) / 3 ≈ 0.16
      const share = 0.00003;
      const discount = calculateDiscountFromShare(share);
      expect(discount).toBeGreaterThan(0);
      expect(discount).toBeLessThan(0.33);
    });
  });

  describe('getTierName()', () => {
    it('should return NORMIE for 0% share', () => {
      expect(getTierName(0).name).toBe('NORMIE');
      expect(getTierName(0).emoji).toBe('👤');
    });

    it('should return HOLDER for 0.001%-0.01% share', () => {
      expect(getTierName(0.001).name).toBe('HOLDER');
      expect(getTierName(0.005).name).toBe('HOLDER');
      expect(getTierName(0.009).name).toBe('HOLDER');
    });

    it('should return BELIEVER for 0.01%-0.1% share', () => {
      expect(getTierName(0.01).name).toBe('BELIEVER');
      expect(getTierName(0.05).name).toBe('BELIEVER');
      expect(getTierName(0.099).name).toBe('BELIEVER');
    });

    it('should return OG for 0.1%-1% share', () => {
      expect(getTierName(0.1).name).toBe('OG');
      expect(getTierName(0.5).name).toBe('OG');
      expect(getTierName(0.99).name).toBe('OG');
    });

    it('should return WHALE for 1%+ share', () => {
      expect(getTierName(1).name).toBe('WHALE');
      expect(getTierName(5).name).toBe('WHALE');
      expect(getTierName(10).name).toBe('WHALE');
    });

    it('should include correct emojis', () => {
      expect(getTierName(1).emoji).toBe('🐋');
      expect(getTierName(0.1).emoji).toBe('👑');
      expect(getTierName(0.01).emoji).toBe('💎');
      expect(getTierName(0.001).emoji).toBe('🙌');
      expect(getTierName(0).emoji).toBe('👤');
    });
  });

  describe('calculateBreakEvenFee()', () => {
    it('should calculate break-even fee based on treasury ratio', () => {
      // txCost / TREASURY_RATIO = break-even
      // With golden ratio (23.6%), 5000 / 0.236 ≈ 21181
      const breakEven5000 = calculateBreakEvenFee(5000);
      const breakEven10000 = calculateBreakEvenFee(10000);
      const breakEven1000 = calculateBreakEvenFee(1000);

      // Verify the math: breakEven * treasuryRatio >= txCost
      expect(Math.floor(breakEven5000 * GOLDEN_TREASURY_RATIO)).toBeGreaterThanOrEqual(5000);
      expect(Math.floor(breakEven10000 * GOLDEN_TREASURY_RATIO)).toBeGreaterThanOrEqual(10000);
      expect(Math.floor(breakEven1000 * GOLDEN_TREASURY_RATIO)).toBeGreaterThanOrEqual(1000);

      // Verify proportionality: 2x cost ≈ 2x break-even (within 1 lamport due to ceiling)
      expect(breakEven10000).toBeGreaterThanOrEqual(breakEven5000 * 2 - 1);
      expect(breakEven10000).toBeLessThanOrEqual(breakEven5000 * 2 + 1);
    });

    it('should round up for non-integer results', () => {
      // Should always round up to ensure treasury covers costs
      const breakEven5001 = calculateBreakEvenFee(5001);
      expect(Math.floor(breakEven5001 * GOLDEN_TREASURY_RATIO)).toBeGreaterThanOrEqual(5001);
    });
  });

  describe('applyDiscount()', () => {
    const highBaseFee = 100000; // 100k lamports
    const lowBaseFee = 10000;   // 10k lamports
    const defaultTxCost = 5000;

    it('should return base fee for 0% discount (above break-even)', () => {
      expect(applyDiscount(highBaseFee, 0, defaultTxCost)).toBe(100000);
    });

    it('should apply 25% discount correctly', () => {
      // 100000 * 0.75 = 75000 > break-even (25000)
      expect(applyDiscount(highBaseFee, 0.25, defaultTxCost)).toBe(75000);
    });

    it('should apply 50% discount correctly', () => {
      // 100000 * 0.50 = 50000 > break-even (25000)
      expect(applyDiscount(highBaseFee, 0.50, defaultTxCost)).toBe(50000);
    });

    it('should floor at break-even when discount would go below', () => {
      const breakEven = calculateBreakEvenFee(defaultTxCost);
      // 10000 * 0.05 = 500 < break-even
      expect(applyDiscount(lowBaseFee, 0.95, defaultTxCost)).toBe(breakEven);
    });

    it('should floor at break-even for any base fee below break-even', () => {
      const breakEven = calculateBreakEvenFee(defaultTxCost);
      expect(applyDiscount(lowBaseFee, 0, defaultTxCost)).toBe(breakEven);
      expect(applyDiscount(lowBaseFee, 0.50, defaultTxCost)).toBe(breakEven);
    });

    it('should use custom txCost for break-even calculation', () => {
      const breakEven1000 = calculateBreakEvenFee(1000);
      const breakEven10000 = calculateBreakEvenFee(10000);
      expect(applyDiscount(10000, 0.95, 1000)).toBe(breakEven1000);
      expect(applyDiscount(100000, 0.95, 10000)).toBe(breakEven10000);
    });

    it('should allow full 95% discount when above break-even', () => {
      const breakEven = calculateBreakEvenFee(defaultTxCost);
      // 500000 * 0.05 = 25000, which is above break-even (~21181)
      const result = applyDiscount(500000, 0.95, defaultTxCost);
      expect(result).toBeGreaterThanOrEqual(breakEven);
      // Should be approximately 5% of base fee (25000), allow 1 lamport tolerance for ceiling
      expect(result).toBeGreaterThanOrEqual(25000);
      expect(result).toBeLessThanOrEqual(25002);
    });
  });

  describe('calculateDiscountedFee()', () => {
    beforeEach(() => {
      // Set up mock for circulating supply
      setCirculatingSupply(930_000_000); // 930M (7% burned)

      // Mock balance lookup to return 0 token accounts (NORMIE)
      const mockConnection = getConnection();
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [], // No token accounts = 0 balance
      });
    });

    it('should return fee info with all required fields', async () => {
      const result = await calculateDiscountedFee('TestWallet123', 100000, 5000);

      expect(result).toHaveProperty('originalFee');
      expect(result).toHaveProperty('discountedFee');
      expect(result).toHaveProperty('breakEvenFee');
      expect(result).toHaveProperty('savings');
      expect(result).toHaveProperty('tier');
      expect(result).toHaveProperty('tierEmoji');
      expect(result).toHaveProperty('balance');
      expect(result).toHaveProperty('circulating');
      expect(result).toHaveProperty('sharePercent');
      expect(result).toHaveProperty('isAtBreakEven');
    });

    it('should return NORMIE tier when balance lookup fails', async () => {
      const result = await calculateDiscountedFee('NonExistentWallet', 100000, 5000);

      expect(result.tier).toBe('NORMIE');
      expect(result.balance).toBe(0);
      expect(result.sharePercent).toBe(0);
    });

    it('should apply break-even floor for low base fees', async () => {
      const breakEven = calculateBreakEvenFee(5000);
      const result = await calculateDiscountedFee('TestWallet', 10000, 5000);

      expect(result.breakEvenFee).toBe(breakEven);
      expect(result.discountedFee).toBe(breakEven);
      expect(result.isAtBreakEven).toBe(true);
    });

    it('should not floor high base fees for NORMIE', async () => {
      const result = await calculateDiscountedFee('TestWallet', 100000, 5000);

      expect(result.discountedFee).toBe(100000); // No discount for NORMIE
      expect(result.isAtBreakEven).toBe(false);
    });

    it('should calculate savings correctly', async () => {
      const result = await calculateDiscountedFee('TestWallet', 100000, 5000);
      expect(result.savings).toBe(result.originalFee - result.discountedFee);
    });

    it('should include circulating supply info', async () => {
      const result = await calculateDiscountedFee('TestWallet', 100000, 5000);
      expect(result.circulating).toBe(930_000_000);
    });
  });

  describe('getAllTiers()', () => {
    it('should return 5 tiers with required fields', () => {
      const tiers = getAllTiers();

      expect(tiers).toHaveLength(5);
      tiers.forEach((tier) => {
        expect(tier).toHaveProperty('name');
        expect(tier).toHaveProperty('emoji');
        expect(tier).toHaveProperty('minSharePercent');
        expect(tier).toHaveProperty('discountPercent');
      });
    });

    it('should have correct tier structure', () => {
      const tiers = getAllTiers();
      const tierNames = tiers.map(t => t.name);

      expect(tierNames).toContain('WHALE');
      expect(tierNames).toContain('OG');
      expect(tierNames).toContain('BELIEVER');
      expect(tierNames).toContain('HOLDER');
      expect(tierNames).toContain('NORMIE');
    });

    it('should have correct discount percentages', () => {
      const tiers = getAllTiers();

      const whale = tiers.find((t) => t.name === 'WHALE');
      expect(whale.discountPercent).toBe(95);
      expect(whale.minSharePercent).toBe(1);

      const normie = tiers.find((t) => t.name === 'NORMIE');
      expect(normie.discountPercent).toBe(0);
      expect(normie.minSharePercent).toBe(0);
    });
  });

  describe('Economic Sustainability', () => {
    it('should always have minimum 5% fee contribution from whales', () => {
      // Max discount is 95%, so min contribution is 5%
      const maxDiscount = calculateDiscountFromShare(1.0); // 100% of supply
      expect(1 - maxDiscount).toBeGreaterThanOrEqual(0.05);
    });

    it('should have progressively higher discounts for higher shares', () => {
      const shares = [0.00001, 0.0001, 0.001, 0.01];
      const discounts = shares.map(s => calculateDiscountFromShare(s));

      for (let i = 1; i < discounts.length; i++) {
        expect(discounts[i]).toBeGreaterThan(discounts[i - 1]);
      }
    });

    it('should floor at break-even fee for treasury neutrality', () => {
      // With 5000 tx cost and 23.6% treasury ratio, break-even is ~21181
      const breakEven = calculateBreakEvenFee(5000);
      expect(applyDiscount(100, 0.95, 5000)).toBe(breakEven);
      expect(applyDiscount(1000, 0.95, 5000)).toBe(breakEven);
      expect(applyDiscount(10000, 0.95, 5000)).toBe(breakEven);
    });

    it('should ensure treasury always covers transaction costs', () => {
      const txCost = 5000;
      const breakEven = calculateBreakEvenFee(txCost);
      // Treasury ratio is ~23.6% (1/φ³ from config)
      const config = require('../../../src/utils/config');
      const treasuryPortion = Math.floor(breakEven * config.TREASURY_RATIO);

      // Treasury portion should cover tx cost (may be slightly more due to ceiling)
      expect(treasuryPortion).toBeGreaterThanOrEqual(txCost);
    });

    it('should scale break-even with transaction complexity', () => {
      // Break-even scales with tx cost using config.TREASURY_RATIO
      const breakEven2500 = calculateBreakEvenFee(2500);
      const breakEven10000 = calculateBreakEvenFee(10000);

      expect(applyDiscount(5000, 0.95, 2500)).toBe(breakEven2500);
      expect(applyDiscount(20000, 0.95, 10000)).toBe(breakEven10000);
    });
  });

  describe('Deflationary Flywheel', () => {
    it('should increase discount as supply decreases', () => {
      const holding = 1_000_000; // 1M tokens

      // With 1B supply: 0.1% share → ~67% discount
      const share1B = holding / 1_000_000_000;
      const discount1B = calculateDiscountFromShare(share1B);

      // With 500M supply (50% burned): 0.2% share → higher discount
      const share500M = holding / 500_000_000;
      const discount500M = calculateDiscountFromShare(share500M);

      expect(discount500M).toBeGreaterThan(discount1B);
    });

    it('should double effective share when supply halves', () => {
      const holding = 1_000_000; // 1M tokens

      const share1B = holding / 1_000_000_000;    // 0.1%
      const share500M = holding / 500_000_000;    // 0.2%

      expect(share500M).toBeCloseTo(share1B * 2, 10);
    });

    it('should maintain same discount for same % of supply', () => {
      // 0.1% of 1B = 1M tokens
      // 0.1% of 500M = 500K tokens
      // Both should have same discount

      const share = 0.001; // 0.1%
      const discount = calculateDiscountFromShare(share);

      expect(discount).toBeCloseTo(0.667, 2);
    });
  });

  describe('Constants', () => {
    it('should have correct original supply', () => {
      expect(ORIGINAL_SUPPLY).toBe(1_000_000_000);
    });
  });
});
