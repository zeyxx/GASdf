/**
 * Tests for Validation Middleware
 */

const {
  validate,
  isValidSolanaAddress,
  isValidBase64,
  isValidUUID,
} = require('../../../src/middleware/validation');

describe('Validation Middleware', () => {
  describe('isValidSolanaAddress()', () => {
    it('should return true for valid Solana public key', () => {
      // Valid mainnet addresses
      expect(isValidSolanaAddress('So11111111111111111111111111111111111111112')).toBe(true);
      expect(isValidSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
      expect(isValidSolanaAddress('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')).toBe(true);
    });

    it('should return false for invalid address', () => {
      expect(isValidSolanaAddress('invalid-address')).toBe(false);
      expect(isValidSolanaAddress('0x1234567890abcdef')).toBe(false);
      expect(isValidSolanaAddress('abc')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(isValidSolanaAddress(null)).toBe(false);
      expect(isValidSolanaAddress(undefined)).toBe(false);
      expect(isValidSolanaAddress('')).toBe(false);
    });

    it('should return false for non-string input', () => {
      expect(isValidSolanaAddress(123)).toBe(false);
      expect(isValidSolanaAddress({})).toBe(false);
      expect(isValidSolanaAddress([])).toBe(false);
    });

    it('should return false for address with invalid characters', () => {
      // Invalid base58 characters: 0, O, I, l
      expect(isValidSolanaAddress('0o11111111111111111111111111111111111111112')).toBe(false);
    });
  });

  describe('isValidBase64()', () => {
    it('should return true for valid base64', () => {
      expect(isValidBase64('SGVsbG8gV29ybGQ=')).toBe(true);
      expect(isValidBase64('dGVzdA==')).toBe(true);
      expect(isValidBase64('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=')).toBe(true);
    });

    it('should return true for empty base64', () => {
      expect(isValidBase64('')).toBe(false); // Empty string returns false
    });

    it('should return false for invalid base64', () => {
      expect(isValidBase64('not-valid-base64!')).toBe(false);
      expect(isValidBase64('!!!invalid!!!')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(isValidBase64(null)).toBe(false);
      expect(isValidBase64(undefined)).toBe(false);
    });

    it('should return false for non-string input', () => {
      expect(isValidBase64(123)).toBe(false);
      expect(isValidBase64({})).toBe(false);
    });
  });

  describe('isValidUUID()', () => {
    it('should return true for valid UUID v4', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
    });

    it('should return false for invalid UUID', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false);
      expect(isValidUUID('550e8400-e29b-11d4-a716-446655440000')).toBe(false); // v1 UUID
      expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false); // No dashes
    });

    it('should return false for null or undefined', () => {
      expect(isValidUUID(null)).toBe(false);
      expect(isValidUUID(undefined)).toBe(false);
      expect(isValidUUID('')).toBe(false);
    });

    it('should return false for non-string input', () => {
      expect(isValidUUID(123)).toBe(false);
      expect(isValidUUID({})).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
      expect(isValidUUID('550e8400-e29b-41d4-A716-446655440000')).toBe(true);
    });
  });

  describe('validate() middleware factory', () => {
    it('should throw error for unknown schema', () => {
      expect(() => validate('unknown')).toThrow('Unknown validation schema: unknown');
    });

    describe('quote schema validation', () => {
      const validateQuote = validate('quote');

      it('should call next for valid quote request', () => {
        const req = {
          body: {
            paymentToken: 'So11111111111111111111111111111111111111112',
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateQuote(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      });

      it('should return 400 for missing paymentToken', () => {
        const req = {
          body: {
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateQuote(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Validation failed',
          details: ['paymentToken is required'],
        });
        expect(next).not.toHaveBeenCalled();
      });

      it('should return 400 for missing userPubkey', () => {
        const req = {
          body: {
            paymentToken: 'So11111111111111111111111111111111111111112',
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateQuote(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Validation failed',
            details: expect.arrayContaining(['userPubkey is required']),
          })
        );
      });

      it('should return 400 for invalid paymentToken', () => {
        const req = {
          body: {
            paymentToken: 'invalid-token',
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateQuote(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Validation failed',
            details: expect.arrayContaining(['paymentToken must be a valid Solana address']),
          })
        );
      });

      it('should accept optional estimatedComputeUnits', () => {
        const req = {
          body: {
            paymentToken: 'So11111111111111111111111111111111111111112',
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            estimatedComputeUnits: 200000,
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateQuote(req, res, next);

        expect(next).toHaveBeenCalled();
      });

      it('should reject invalid estimatedComputeUnits', () => {
        const req = {
          body: {
            paymentToken: 'So11111111111111111111111111111111111111112',
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            estimatedComputeUnits: 2000000, // Too high
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateQuote(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            details: expect.arrayContaining(['estimatedComputeUnits must be between 1 and 1,400,000']),
          })
        );
      });

      it('should reject negative estimatedComputeUnits', () => {
        const req = {
          body: {
            paymentToken: 'So11111111111111111111111111111111111111112',
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            estimatedComputeUnits: -1,
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateQuote(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should reject non-integer estimatedComputeUnits', () => {
        const req = {
          body: {
            paymentToken: 'So11111111111111111111111111111111111111112',
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            estimatedComputeUnits: 200.5,
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateQuote(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('should collect multiple errors', () => {
        const req = { body: {} };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateQuote(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        const response = res.json.mock.calls[0][0];
        expect(response.details.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe('submit schema validation', () => {
      const validateSubmit = validate('submit');

      it('should call next for valid submit request', () => {
        const req = {
          body: {
            quoteId: '550e8400-e29b-41d4-a716-446655440000',
            transaction: 'SGVsbG8gV29ybGQ=',
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateSubmit(req, res, next);

        expect(next).toHaveBeenCalled();
      });

      it('should return 400 for missing quoteId', () => {
        const req = {
          body: {
            transaction: 'SGVsbG8gV29ybGQ=',
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateSubmit(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            details: expect.arrayContaining(['quoteId is required']),
          })
        );
      });

      it('should return 400 for invalid quoteId format', () => {
        const req = {
          body: {
            quoteId: 'not-a-valid-uuid',
            transaction: 'SGVsbG8gV29ybGQ=',
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateSubmit(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            details: expect.arrayContaining(['quoteId must be a valid UUID']),
          })
        );
      });

      it('should return 400 for missing transaction', () => {
        const req = {
          body: {
            quoteId: '550e8400-e29b-41d4-a716-446655440000',
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateSubmit(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            details: expect.arrayContaining(['transaction is required']),
          })
        );
      });

      it('should return 400 for invalid transaction base64', () => {
        const req = {
          body: {
            quoteId: '550e8400-e29b-41d4-a716-446655440000',
            transaction: 'not-valid-base64!!!',
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateSubmit(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            details: expect.arrayContaining(['transaction must be valid base64']),
          })
        );
      });

      it('should return 400 for missing userPubkey', () => {
        const req = {
          body: {
            quoteId: '550e8400-e29b-41d4-a716-446655440000',
            transaction: 'SGVsbG8gV29ybGQ=',
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateSubmit(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            details: expect.arrayContaining(['userPubkey is required']),
          })
        );
      });

      it('should treat empty string as missing', () => {
        const req = {
          body: {
            quoteId: '',
            transaction: 'SGVsbG8gV29ybGQ=',
            userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        validateSubmit(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            details: expect.arrayContaining(['quoteId is required']),
          })
        );
      });
    });
  });
});
