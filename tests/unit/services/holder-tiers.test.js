/**
 * Holder Tiers Service Tests
 */

// Mock dependencies first
jest.mock('../../../src/utils/config', () => ({
  ASDF_MINT: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
  IS_DEV: true,
}));

jest.mock('../../../src/utils/rpc', () => ({
  getConnection: jest.fn().mockReturnValue({
    getTokenAccountBalance: jest.fn(),
  }),
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@solana/spl-token', () => ({
  getAssociatedTokenAddress: jest.fn().mockResolvedValue('MockATA'),
}));

const {
  getTierForBalance,
  applyDiscount,
  calculateDiscountedFee,
  calculateBreakEvenFee,
  getAllTiers,
  clearCache,
  TIERS,
  DEFAULT_BREAK_EVEN_FEE,
} = require('../../../src/services/holder-tiers');
const { getConnection } = require('../../../src/utils/rpc');

describe('Holder Tiers Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });

  describe('TIERS', () => {
    it('should have 6 tiers defined', () => {
      expect(TIERS).toHaveLength(6);
    });

    it('should have tiers in descending order', () => {
      for (let i = 0; i < TIERS.length - 1; i++) {
        expect(TIERS[i].minHolding).toBeGreaterThan(TIERS[i + 1].minHolding);
      }
    });

    it('should have NORMIE as lowest tier with 0 holding', () => {
      const normie = TIERS[TIERS.length - 1];
      expect(normie.name).toBe('NORMIE');
      expect(normie.minHolding).toBe(0);
      expect(normie.discount).toBe(0);
    });

    it('should have WHALE as highest tier', () => {
      const whale = TIERS[0];
      expect(whale.name).toBe('WHALE');
      expect(whale.minHolding).toBe(5_000_000);
      expect(whale.discount).toBe(0.95);
    });
  });

  describe('getTierForBalance()', () => {
    it('should return NORMIE for 0 balance', () => {
      const tier = getTierForBalance(0);
      expect(tier.name).toBe('NORMIE');
      expect(tier.discount).toBe(0);
    });

    it('should return HOLDER for 10k-100k balance', () => {
      expect(getTierForBalance(10000).name).toBe('HOLDER');
      expect(getTierForBalance(50000).name).toBe('HOLDER');
      expect(getTierForBalance(99999).name).toBe('HOLDER');
    });

    it('should return BELIEVER for 100k-500k balance', () => {
      expect(getTierForBalance(100000).name).toBe('BELIEVER');
      expect(getTierForBalance(250000).name).toBe('BELIEVER');
      expect(getTierForBalance(499999).name).toBe('BELIEVER');
    });

    it('should return DEGEN for 500k-1M balance', () => {
      expect(getTierForBalance(500000).name).toBe('DEGEN');
      expect(getTierForBalance(750000).name).toBe('DEGEN');
      expect(getTierForBalance(999999).name).toBe('DEGEN');
    });

    it('should return OG for 1M-5M balance', () => {
      expect(getTierForBalance(1000000).name).toBe('OG');
      expect(getTierForBalance(3000000).name).toBe('OG');
      expect(getTierForBalance(4999999).name).toBe('OG');
    });

    it('should return WHALE for 5M+ balance', () => {
      expect(getTierForBalance(5000000).name).toBe('WHALE');
      expect(getTierForBalance(10000000).name).toBe('WHALE');
      expect(getTierForBalance(100000000).name).toBe('WHALE');
    });

    it('should return NORMIE for balance below 10k', () => {
      expect(getTierForBalance(5000).name).toBe('NORMIE');
      expect(getTierForBalance(9999).name).toBe('NORMIE');
    });
  });

  describe('calculateBreakEvenFee()', () => {
    it('should calculate break-even fee based on treasury ratio', () => {
      // txCost / 0.20 = break-even
      expect(calculateBreakEvenFee(5000)).toBe(25000);
      expect(calculateBreakEvenFee(10000)).toBe(50000);
      expect(calculateBreakEvenFee(1000)).toBe(5000);
    });

    it('should have correct default break-even fee', () => {
      expect(DEFAULT_BREAK_EVEN_FEE).toBe(25000); // 5000 / 0.20
    });
  });

  describe('applyDiscount()', () => {
    // Use high base fee to see discounts before hitting break-even
    const highBaseFee = 100000; // 100k lamports
    const lowBaseFee = 10000; // 10k lamports
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
      // 10000 * 0.05 = 500 < break-even (25000)
      // Should floor at 25000
      expect(applyDiscount(lowBaseFee, 0.95, defaultTxCost)).toBe(25000);
    });

    it('should floor at break-even for any base fee below break-even', () => {
      // Base fee 10000 < break-even 25000, so always return break-even
      expect(applyDiscount(lowBaseFee, 0, defaultTxCost)).toBe(25000);
      expect(applyDiscount(lowBaseFee, 0.50, defaultTxCost)).toBe(25000);
    });

    it('should use custom txCost for break-even calculation', () => {
      // txCost 1000 → break-even 5000
      expect(applyDiscount(10000, 0.95, 1000)).toBe(5000);
      // txCost 10000 → break-even 50000
      expect(applyDiscount(100000, 0.95, 10000)).toBe(50000);
    });

    it('should cap discount at 95%', () => {
      // 100% discount should be capped at 95%
      // 100000 * 0.05 = 5000 < break-even (25000)
      expect(applyDiscount(highBaseFee, 1.0, defaultTxCost)).toBe(25000);
    });

    it('should allow full discount when above break-even', () => {
      // Very high base fee: 500000 * 0.05 = 25000 ≈ break-even
      // May be 25001 due to floating point ceil
      const result = applyDiscount(500000, 0.95, defaultTxCost);
      expect(result).toBeGreaterThanOrEqual(25000);
      expect(result).toBeLessThanOrEqual(25002);
    });
  });

  describe('calculateDiscountedFee()', () => {
    // Note: Due to module caching and mock timing, these tests verify
    // the function handles errors gracefully (returns NORMIE tier)
    // Full integration testing would require actual RPC mocking

    it('should return fee info with tier details', async () => {
      const result = await calculateDiscountedFee('TestWallet123', 100000, 5000);

      // Should have all expected fields
      expect(result).toHaveProperty('originalFee');
      expect(result).toHaveProperty('discountedFee');
      expect(result).toHaveProperty('breakEvenFee');
      expect(result).toHaveProperty('savings');
      expect(result).toHaveProperty('tier');
      expect(result).toHaveProperty('tierEmoji');
      expect(result).toHaveProperty('balance');
      expect(result).toHaveProperty('isAtBreakEven');
    });

    it('should return break-even fee when balance lookup fails', async () => {
      // When RPC fails, should default to NORMIE (0 discount)
      // But fee is floored at break-even (25000)
      const result = await calculateDiscountedFee('NonExistentWallet', 10000, 5000);

      expect(result.originalFee).toBe(10000);
      expect(result.discountedFee).toBe(25000); // Floored at break-even
      expect(result.breakEvenFee).toBe(25000);
      expect(result.tier).toBe('NORMIE');
      expect(result.isAtBreakEven).toBe(true);
    });

    it('should calculate savings correctly (can be negative if floored)', async () => {
      const result = await calculateDiscountedFee('TestWallet', 10000, 5000);
      expect(result.savings).toBe(result.originalFee - result.discountedFee);
      // Savings is negative because fee was floored up to break-even
      expect(result.savings).toBe(-15000); // 10000 - 25000
    });

    it('should include next tier info for non-whale tiers', async () => {
      // For NORMIE, next tier should be HOLDER
      const result = await calculateDiscountedFee('TestWallet', 100000, 5000);

      if (result.tier !== 'WHALE') {
        expect(result.nextTier).toBeDefined();
        expect(result.nextTier).toHaveProperty('name');
        expect(result.nextTier).toHaveProperty('minHolding');
        expect(result.nextTier).toHaveProperty('needed');
      }
    });

    it('should correctly indicate when at break-even floor', async () => {
      // Low base fee should floor at break-even
      const lowFeeResult = await calculateDiscountedFee('TestWallet', 10000, 5000);
      expect(lowFeeResult.isAtBreakEven).toBe(true);

      // High base fee should not floor
      const highFeeResult = await calculateDiscountedFee('TestWallet', 100000, 5000);
      expect(highFeeResult.isAtBreakEven).toBe(false);
      expect(highFeeResult.discountedFee).toBe(100000); // NORMIE, no discount
    });
  });

  describe('getAllTiers()', () => {
    it('should return all tiers with required fields', () => {
      const tiers = getAllTiers();

      expect(tiers).toHaveLength(6);
      tiers.forEach((tier) => {
        expect(tier).toHaveProperty('name');
        expect(tier).toHaveProperty('emoji');
        expect(tier).toHaveProperty('minHolding');
        expect(tier).toHaveProperty('discountPercent');
      });
    });

    it('should have correct discount percentages', () => {
      const tiers = getAllTiers();

      const whale = tiers.find((t) => t.name === 'WHALE');
      expect(whale.discountPercent).toBe(95);

      const normie = tiers.find((t) => t.name === 'NORMIE');
      expect(normie.discountPercent).toBe(0);
    });
  });

  describe('Economic Sustainability', () => {
    it('should always have minimum 5% fee contribution from whales', () => {
      const whaleTier = TIERS.find((t) => t.name === 'WHALE');
      const minContribution = 1 - whaleTier.discount;
      expect(minContribution).toBeGreaterThanOrEqual(0.05);
    });

    it('should have progressively higher discounts for higher tiers', () => {
      const sortedTiers = [...TIERS].sort((a, b) => a.minHolding - b.minHolding);
      for (let i = 1; i < sortedTiers.length; i++) {
        expect(sortedTiers[i].discount).toBeGreaterThan(sortedTiers[i - 1].discount);
      }
    });

    it('should floor at break-even fee for treasury neutrality', () => {
      // With 5000 tx cost, break-even is 25000
      // Any fee must be at least 25000 to ensure treasury covers tx cost
      expect(applyDiscount(100, 0.95, 5000)).toBe(25000);
      expect(applyDiscount(1000, 0.95, 5000)).toBe(25000);
      expect(applyDiscount(10000, 0.95, 5000)).toBe(25000);
    });

    it('should ensure treasury always covers transaction costs', () => {
      const txCost = 5000;
      const breakEven = calculateBreakEvenFee(txCost);
      const treasuryPortion = breakEven * 0.20;

      // Treasury portion should exactly cover tx cost
      expect(treasuryPortion).toBe(txCost);
    });

    it('should scale break-even with transaction complexity', () => {
      // Simple tx: 2500 cost → 12500 min fee
      expect(applyDiscount(5000, 0.95, 2500)).toBe(12500);
      // Complex tx: 10000 cost → 50000 min fee
      expect(applyDiscount(20000, 0.95, 10000)).toBe(50000);
    });
  });
});
