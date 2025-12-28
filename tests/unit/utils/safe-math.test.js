/**
 * Tests for safe-math utilities
 * Validates numeric overflow/underflow protection
 */

const {
  safeMul,
  safeDiv,
  safeAdd,
  safeSub,
  safeCeil,
  safeFloor,
  clamp,
  safeProportion,
  calculateTreasurySplit,
  validateSolanaAmount,
  calculateFee,
  lamportsToTokens,
  MAX_COMPUTE_UNITS,
  MAX_SAFE_INTEGER,
  isSafeInteger,
} = require('../../../src/utils/safe-math');

describe('Safe Math Utilities', () => {
  describe('safeMul()', () => {
    it('should multiply two numbers safely', () => {
      expect(safeMul(10, 5)).toBe(50);
      expect(safeMul(1.5, 2)).toBe(3);
      expect(safeMul(0, 100)).toBe(0);
    });

    it('should return null for non-finite results', () => {
      expect(safeMul(Infinity, 1)).toBeNull();
      expect(safeMul(1, Infinity)).toBeNull();
      expect(safeMul(NaN, 1)).toBeNull();
    });

    it('should return null for non-number inputs', () => {
      expect(safeMul('10', 5)).toBeNull();
      expect(safeMul(10, null)).toBeNull();
      expect(safeMul(undefined, 5)).toBeNull();
    });

    it('should detect potential precision loss on large integers', () => {
      // Numbers larger than MAX_SAFE_INTEGER lose precision
      const large = Number.MAX_SAFE_INTEGER;
      expect(safeMul(large, 2)).toBeNull();
    });
  });

  describe('safeDiv()', () => {
    it('should divide two numbers safely', () => {
      expect(safeDiv(10, 2)).toBe(5);
      expect(safeDiv(7, 2)).toBe(3.5);
    });

    it('should return null for division by zero', () => {
      expect(safeDiv(10, 0)).toBeNull();
      expect(safeDiv(0, 0)).toBeNull();
    });

    it('should return null for non-finite inputs', () => {
      expect(safeDiv(Infinity, 1)).toBeNull();
      expect(safeDiv(1, NaN)).toBeNull();
    });

    it('should handle zero numerator', () => {
      expect(safeDiv(0, 5)).toBe(0);
    });
  });

  describe('safeAdd()', () => {
    it('should add two numbers safely', () => {
      expect(safeAdd(10, 5)).toBe(15);
      expect(safeAdd(-5, 10)).toBe(5);
    });

    it('should return null for non-finite results', () => {
      expect(safeAdd(Infinity, 1)).toBeNull();
      expect(safeAdd(1, -Infinity)).toBeNull();
    });
  });

  describe('safeSub()', () => {
    it('should subtract two numbers safely', () => {
      expect(safeSub(10, 5)).toBe(5);
      expect(safeSub(5, 10)).toBe(-5);
    });

    it('should return null for non-finite results', () => {
      expect(safeSub(Infinity, 1)).toBeNull();
    });
  });

  describe('safeCeil()', () => {
    it('should ceiling positive numbers', () => {
      expect(safeCeil(1.1)).toBe(2);
      expect(safeCeil(1.9)).toBe(2);
      expect(safeCeil(1.0)).toBe(1);
    });

    it('should ceiling negative numbers (toward zero)', () => {
      expect(safeCeil(-1.1)).toBe(-1);
      expect(safeCeil(-1.9)).toBe(-1);
    });

    it('should return null for non-finite inputs', () => {
      expect(safeCeil(Infinity)).toBeNull();
      expect(safeCeil(NaN)).toBeNull();
    });
  });

  describe('safeFloor()', () => {
    it('should floor positive numbers', () => {
      expect(safeFloor(1.9)).toBe(1);
      expect(safeFloor(1.1)).toBe(1);
    });

    it('should floor negative numbers', () => {
      expect(safeFloor(-1.1)).toBe(-2);
    });

    it('should return null for non-finite inputs', () => {
      expect(safeFloor(Infinity)).toBeNull();
      expect(safeFloor(NaN)).toBeNull();
    });
  });

  describe('clamp()', () => {
    it('should clamp values within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should return min for invalid inputs', () => {
      expect(clamp(NaN, 0, 10)).toBe(0);
      expect(clamp(Infinity, 0, 10)).toBe(0);
    });

    it('should clamp compute units correctly', () => {
      expect(clamp(2_000_000, 1, MAX_COMPUTE_UNITS)).toBe(MAX_COMPUTE_UNITS);
      expect(clamp(500_000, 1, MAX_COMPUTE_UNITS)).toBe(500_000);
      expect(clamp(0, 1, MAX_COMPUTE_UNITS)).toBe(1);
    });
  });

  describe('safeProportion()', () => {
    it('should calculate (a * b) / c safely', () => {
      expect(safeProportion(10, 5, 2)).toBe(25);
      expect(safeProportion(100, 3, 10)).toBe(30);
    });

    it('should return null for zero divisor', () => {
      expect(safeProportion(10, 5, 0)).toBeNull();
    });

    it('should return null for invalid inputs', () => {
      expect(safeProportion(Infinity, 1, 1)).toBeNull();
    });

    it('should handle Jupiter-like calculations', () => {
      // Simulating: (inAmount * solAmountLamports) / outAmount
      const inAmount = 2_000_000; // 2 USDC
      const solAmount = 10_000_000; // 0.01 SOL
      const outAmount = 20_000_000; // 0.02 SOL (from 2x quote)

      const result = safeProportion(inAmount, solAmount, outAmount);
      expect(result).toBe(1_000_000); // 1 USDC for 0.01 SOL
    });
  });

  describe('calculateTreasurySplit()', () => {
    it('should calculate 80/20 split correctly', () => {
      const { burnAmount, treasuryAmount } = calculateTreasurySplit(100_000_000, 0.8);
      expect(burnAmount).toBe(80_000_000);
      expect(treasuryAmount).toBe(20_000_000);
    });

    it('should ensure no lamports are lost', () => {
      // Test with amount that doesn't divide evenly
      const { burnAmount, treasuryAmount } = calculateTreasurySplit(100_000_001, 0.8);
      expect(burnAmount + treasuryAmount).toBe(100_000_001);
    });

    it('should handle zero total', () => {
      const { burnAmount, treasuryAmount } = calculateTreasurySplit(0, 0.8);
      expect(burnAmount).toBe(0);
      expect(treasuryAmount).toBe(0);
    });

    it('should handle negative total', () => {
      const { burnAmount, treasuryAmount } = calculateTreasurySplit(-100, 0.8);
      expect(burnAmount).toBe(0);
      expect(treasuryAmount).toBe(0);
    });

    it('should use floor for burn amount (conservative)', () => {
      // 99 * 0.8 = 79.2, floor = 79, remainder = 20
      const { burnAmount, treasuryAmount } = calculateTreasurySplit(99, 0.8);
      expect(burnAmount).toBe(79);
      expect(treasuryAmount).toBe(20);
    });
  });

  describe('validateSolanaAmount()', () => {
    it('should accept valid positive amounts', () => {
      expect(validateSolanaAmount(100_000_000).valid).toBe(true);
      expect(validateSolanaAmount(1).valid).toBe(true);
      expect(validateSolanaAmount(0).valid).toBe(true);
    });

    it('should reject negative amounts', () => {
      const result = validateSolanaAmount(-100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('negative');
    });

    it('should reject non-numbers', () => {
      expect(validateSolanaAmount('100').valid).toBe(false);
      expect(validateSolanaAmount(null).valid).toBe(false);
      expect(validateSolanaAmount(undefined).valid).toBe(false);
    });

    it('should reject Infinity and NaN', () => {
      expect(validateSolanaAmount(Infinity).valid).toBe(false);
      expect(validateSolanaAmount(NaN).valid).toBe(false);
    });

    it('should include field name in error', () => {
      const result = validateSolanaAmount(-100, 'feeAmount');
      expect(result.error).toContain('feeAmount');
    });
  });

  describe('isSafeInteger()', () => {
    it('should return true for safe integers', () => {
      expect(isSafeInteger(0)).toBe(true);
      expect(isSafeInteger(100)).toBe(true);
      expect(isSafeInteger(-100)).toBe(true);
      expect(isSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
    });

    it('should return false for unsafe values', () => {
      expect(isSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
      expect(isSafeInteger(1.5)).toBe(false);
      expect(isSafeInteger(Infinity)).toBe(false);
    });
  });

  describe('MAX_COMPUTE_UNITS constant', () => {
    it('should be set to Solana limit', () => {
      expect(MAX_COMPUTE_UNITS).toBe(1_400_000);
    });
  });

  describe('safeMul() - additional coverage', () => {
    it('should return null when result overflows to Infinity', () => {
      // Large numbers that overflow to Infinity when multiplied
      expect(safeMul(1e308, 10)).toBeNull();
      expect(safeMul(Number.MAX_VALUE, 2)).toBeNull();
    });
  });

  describe('safeDiv() - additional coverage', () => {
    it('should return null for non-number inputs', () => {
      expect(safeDiv('10', 2)).toBeNull();
      expect(safeDiv(10, {})).toBeNull();
      expect(safeDiv(undefined, 2)).toBeNull();
    });

    it('should return null when result overflows', () => {
      // Dividing by very small number can cause Infinity
      expect(safeDiv(1e308, 0.1)).toBeNull();
    });
  });

  describe('safeAdd() - additional coverage', () => {
    it('should return null for non-number inputs', () => {
      expect(safeAdd('10', 5)).toBeNull();
      expect(safeAdd(10, null)).toBeNull();
      expect(safeAdd({}, 5)).toBeNull();
    });

    it('should return null when result overflows', () => {
      expect(safeAdd(Number.MAX_VALUE, Number.MAX_VALUE)).toBeNull();
    });
  });

  describe('safeSub() - additional coverage', () => {
    it('should return null for non-number inputs', () => {
      expect(safeSub('10', 5)).toBeNull();
      expect(safeSub(10, null)).toBeNull();
      expect(safeSub([], 5)).toBeNull();
    });

    it('should return null when result overflows', () => {
      expect(safeSub(-Number.MAX_VALUE, Number.MAX_VALUE)).toBeNull();
    });
  });

  describe('safeCeil() - additional coverage', () => {
    it('should return null for very large positive numbers', () => {
      // A number larger than MAX_SAFE_INTEGER
      const veryLarge = MAX_SAFE_INTEGER + 1000.5;
      expect(safeCeil(veryLarge)).toBeNull();
    });

    it('should return null for non-number inputs', () => {
      expect(safeCeil('1.5')).toBeNull();
      expect(safeCeil(null)).toBeNull();
    });
  });

  describe('safeFloor() - additional coverage', () => {
    it('should return null for very large numbers exceeding safe range', () => {
      // A number much larger than MAX_SAFE_INTEGER
      const veryLarge = MAX_SAFE_INTEGER * 2 + 0.5;
      expect(safeFloor(veryLarge)).toBeNull();
    });

    it('should return null for non-number inputs', () => {
      expect(safeFloor('1.5')).toBeNull();
      expect(safeFloor(undefined)).toBeNull();
    });
  });

  describe('calculateFee()', () => {
    it('should calculate fee with base fee and compute units', () => {
      const result = calculateFee(200000, 5000, 1);
      expect(result).not.toBeNull();
      expect(result.fee).toBeGreaterThan(5000);
      expect(result.capped).toBe(false);
    });

    it('should cap compute units at MAX_COMPUTE_UNITS', () => {
      const result = calculateFee(2_000_000, 5000, 1);
      expect(result).not.toBeNull();
      expect(result.capped).toBe(true);
    });

    it('should apply multiplier correctly', () => {
      const baseResult = calculateFee(100000, 5000, 1);
      const multipliedResult = calculateFee(100000, 5000, 2);
      expect(multipliedResult.fee).toBe(baseResult.fee * 2);
    });

    it('should handle zero compute units', () => {
      const result = calculateFee(0, 5000, 1);
      expect(result).not.toBeNull();
      expect(result.fee).toBe(5000);
    });

    it('should handle negative compute units (clamped to 0)', () => {
      const result = calculateFee(-1000, 5000, 1);
      expect(result).not.toBeNull();
      expect(result.capped).toBe(true);
    });

    it('should ceil the final result', () => {
      // 0.001 * 100 = 0.1 lamports + 5000 = 5000.1, ceil = 5001
      const result = calculateFee(100, 5000, 1);
      expect(result.fee).toBe(5001);
    });

    it('should default multiplier to 1', () => {
      const result = calculateFee(100000, 5000);
      expect(result).not.toBeNull();
    });
  });

  describe('lamportsToTokens()', () => {
    it('should convert lamports to token units', () => {
      // 1 SOL (1e9 lamports) at rate 1 with 9 decimals = 1e9 tokens
      const result = lamportsToTokens(1_000_000_000, 9, 1);
      expect(result).toBe(1_000_000_000);
    });

    it('should handle different decimal places', () => {
      // 1 SOL at rate 1 with 6 decimals (USDC-like)
      const result = lamportsToTokens(1_000_000_000, 6, 1);
      expect(result).toBe(1_000_000);
    });

    it('should apply exchange rate', () => {
      // 1 SOL at rate 100 (e.g., 100 tokens per SOL)
      const result = lamportsToTokens(1_000_000_000, 6, 100);
      expect(result).toBe(100_000_000);
    });

    it('should return 0 for zero lamports', () => {
      expect(lamportsToTokens(0, 6, 100)).toBe(0);
    });

    it('should return 0 for negative lamports', () => {
      expect(lamportsToTokens(-1000, 6, 100)).toBe(0);
    });

    it('should return 0 for zero rate', () => {
      expect(lamportsToTokens(1_000_000_000, 6, 0)).toBe(0);
    });

    it('should return 0 for negative rate', () => {
      expect(lamportsToTokens(1_000_000_000, 6, -1)).toBe(0);
    });

    it('should ceil the result', () => {
      // 0.1 SOL = 1e8 lamports at rate 0.5 with 6 decimals
      // 1e8 / 1e9 * 0.5 * 1e6 = 50000
      const result = lamportsToTokens(100_000_000, 6, 0.5);
      expect(result).toBe(50000);
    });
  });

  describe('validateSolanaAmount() - additional coverage', () => {
    it('should reject amounts exceeding safe integer range', () => {
      const result = validateSolanaAmount(MAX_SAFE_INTEGER + 1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('safe integer');
    });

    it('should accept MAX_SAFE_INTEGER', () => {
      const result = validateSolanaAmount(MAX_SAFE_INTEGER);
      expect(result.valid).toBe(true);
    });

    it('should return value in result object', () => {
      const result = validateSolanaAmount(12345);
      expect(result.value).toBe(12345);
    });

    it('should return 0 for invalid values', () => {
      const result = validateSolanaAmount('invalid');
      expect(result.value).toBe(0);
    });
  });

  describe('safeProportion() - additional coverage', () => {
    it('should return null for null divisor', () => {
      expect(safeProportion(10, 5, null)).toBeNull();
    });

    it('should return null for undefined divisor', () => {
      expect(safeProportion(10, 5, undefined)).toBeNull();
    });
  });

  describe('calculateTreasurySplit() - additional coverage', () => {
    it('should handle Infinity total', () => {
      const { burnAmount, treasuryAmount } = calculateTreasurySplit(Infinity, 0.8);
      expect(burnAmount).toBe(0);
      expect(treasuryAmount).toBe(0);
    });

    it('should handle NaN total', () => {
      const { burnAmount, treasuryAmount } = calculateTreasurySplit(NaN, 0.8);
      expect(burnAmount).toBe(0);
      expect(treasuryAmount).toBe(0);
    });

    it('should use default 0.8 ratio', () => {
      const { burnAmount, treasuryAmount } = calculateTreasurySplit(100);
      expect(burnAmount).toBe(80);
      expect(treasuryAmount).toBe(20);
    });
  });
});
