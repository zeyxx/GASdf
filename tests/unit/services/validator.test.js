const {
  validateTransactionSize,
  MAX_TRANSACTION_SIZE,
  MAX_COMPUTE_UNITS,
  SIGNATURE_SIZE,
} = require('../../../src/services/validator');

describe('Validator Service', () => {
  describe('Solana Mainnet Constants', () => {
    it('MAX_TRANSACTION_SIZE should be 1232 bytes', () => {
      expect(MAX_TRANSACTION_SIZE).toBe(1232);
    });

    it('MAX_COMPUTE_UNITS should be 1,400,000', () => {
      expect(MAX_COMPUTE_UNITS).toBe(1_400_000);
    });

    it('SIGNATURE_SIZE should be 64 bytes', () => {
      expect(SIGNATURE_SIZE).toBe(64);
    });
  });

  describe('validateTransactionSize()', () => {
    it('should accept transaction within size limit', () => {
      // Create a small valid base64 transaction (100 bytes)
      const smallTx = Buffer.alloc(100).toString('base64');
      const result = validateTransactionSize(smallTx);

      expect(result.valid).toBe(true);
      expect(result.size).toBe(100);
      expect(result.maxSize).toBe(1232);
      expect(result.error).toBeUndefined();
    });

    it('should accept transaction at exact size limit', () => {
      // Create transaction at exactly 1232 bytes
      const exactTx = Buffer.alloc(1232).toString('base64');
      const result = validateTransactionSize(exactTx);

      expect(result.valid).toBe(true);
      expect(result.size).toBe(1232);
    });

    it('should reject transaction exceeding size limit', () => {
      // Create transaction at 1233 bytes (1 byte over limit)
      const largeTx = Buffer.alloc(1233).toString('base64');
      const result = validateTransactionSize(largeTx);

      expect(result.valid).toBe(false);
      expect(result.size).toBe(1233);
      expect(result.maxSize).toBe(1232);
      expect(result.error).toContain('1233 bytes exceeds Solana limit of 1232 bytes');
    });

    it('should reject very large transaction', () => {
      // Create transaction at 2000 bytes
      const veryLargeTx = Buffer.alloc(2000).toString('base64');
      const result = validateTransactionSize(veryLargeTx);

      expect(result.valid).toBe(false);
      expect(result.size).toBe(2000);
      expect(result.error).toContain('2000 bytes exceeds Solana limit');
    });

    it('should handle empty transaction', () => {
      const emptyTx = Buffer.alloc(0).toString('base64');
      const result = validateTransactionSize(emptyTx);

      expect(result.valid).toBe(true);
      expect(result.size).toBe(0);
    });

    it('should correctly decode base64 before measuring size', () => {
      // Base64 encoding increases size by ~33%, so we need to verify
      // we're measuring decoded bytes, not base64 string length
      const data = Buffer.alloc(100);
      const base64 = data.toString('base64');

      // Base64 string is longer than original data
      expect(base64.length).toBeGreaterThan(100);

      const result = validateTransactionSize(base64);
      // But validated size should be original bytes
      expect(result.size).toBe(100);
    });
  });
});
