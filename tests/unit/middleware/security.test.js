/**
 * Tests for Security Middleware
 */

const {
  securityHeaders,
  globalLimiter,
  quoteLimiter,
  submitLimiter,
  scoreLimiter,
  walletQuoteLimiter,
  walletSubmitLimiter,
} = require('../../../src/middleware/security');

// Mock dependencies
jest.mock('../../../src/utils/config', () => ({
  IS_DEV: true,
  WALLET_QUOTE_LIMIT: 50,
  WALLET_SUBMIT_LIMIT: 10,
}));

jest.mock('../../../src/utils/redis', () => ({
  incrWalletRateLimit: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
}));

const redis = require('../../../src/utils/redis');
const logger = require('../../../src/utils/logger');

describe('Security Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('securityHeaders', () => {
    it('should be a function (helmet middleware)', () => {
      expect(typeof securityHeaders).toBe('function');
    });
  });

  describe('Rate limiters', () => {
    describe('globalLimiter', () => {
      it('should be defined', () => {
        expect(globalLimiter).toBeDefined();
      });

      it('should be a function', () => {
        expect(typeof globalLimiter).toBe('function');
      });
    });

    describe('quoteLimiter', () => {
      it('should be defined', () => {
        expect(quoteLimiter).toBeDefined();
      });

      it('should be a function', () => {
        expect(typeof quoteLimiter).toBe('function');
      });
    });

    describe('submitLimiter', () => {
      it('should be defined', () => {
        expect(submitLimiter).toBeDefined();
      });

      it('should be a function', () => {
        expect(typeof submitLimiter).toBe('function');
      });
    });

    describe('scoreLimiter', () => {
      it('should be defined', () => {
        expect(scoreLimiter).toBeDefined();
      });

      it('should be a function', () => {
        expect(typeof scoreLimiter).toBe('function');
      });
    });
  });

  describe('walletQuoteLimiter', () => {
    it('should be a function', () => {
      expect(typeof walletQuoteLimiter).toBe('function');
    });

    it('should call next if no userPubkey in body', async () => {
      const req = { body: {} };
      const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await walletQuoteLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(redis.incrWalletRateLimit).not.toHaveBeenCalled();
    });

    it('should check wallet rate limit when userPubkey present', async () => {
      redis.incrWalletRateLimit.mockResolvedValue(5);

      const req = {
        body: { userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        ip: '127.0.0.1',
      };
      const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await walletQuoteLimiter(req, res, next);

      expect(redis.incrWalletRateLimit).toHaveBeenCalledWith(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        'quote'
      );
      expect(res.setHeader).toHaveBeenCalledWith('X-Wallet-RateLimit-Limit', 50);
      expect(res.setHeader).toHaveBeenCalledWith('X-Wallet-RateLimit-Remaining', 45);
      expect(next).toHaveBeenCalled();
    });

    it('should return 429 when wallet rate limit exceeded', async () => {
      redis.incrWalletRateLimit.mockResolvedValue(51); // Exceeds limit of 50

      const req = {
        body: { userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        ip: '127.0.0.1',
      };
      const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await walletQuoteLimiter(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Wallet rate limit exceeded (50/quotes per minute)',
        code: 'WALLET_RATE_LIMITED',
        retryAfter: 60,
      });
      expect(next).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'SECURITY',
        'Wallet rate limit exceeded',
        expect.objectContaining({ type: 'quote' })
      );
    });

    it('should fail open on Redis error in dev/test mode', async () => {
      redis.incrWalletRateLimit.mockRejectedValue(new Error('Redis connection failed'));

      const req = {
        body: { userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        ip: '127.0.0.1',
      };
      const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await walletQuoteLimiter(req, res, next);

      // In dev/test (IS_PROD=false), should fail open (call next)
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'SECURITY',
        'Wallet rate limit check failed',
        expect.objectContaining({ error: 'Redis connection failed' })
      );
    });

    it('should normalize IPv6 mapped addresses', async () => {
      redis.incrWalletRateLimit.mockResolvedValue(51); // Exceeds limit

      const req = {
        body: { userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        ip: '::ffff:192.168.1.1',
      };
      const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await walletQuoteLimiter(req, res, next);

      // Check that logger received normalized IP
      expect(logger.warn).toHaveBeenCalledWith(
        'SECURITY',
        'Wallet rate limit exceeded',
        expect.objectContaining({ ip: '192.168.1.1' })
      );
    });
  });

  describe('walletSubmitLimiter', () => {
    it('should be a function', () => {
      expect(typeof walletSubmitLimiter).toBe('function');
    });

    it('should check wallet rate limit for submit', async () => {
      redis.incrWalletRateLimit.mockResolvedValue(3);

      const req = {
        body: { userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        ip: '127.0.0.1',
      };
      const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await walletSubmitLimiter(req, res, next);

      expect(redis.incrWalletRateLimit).toHaveBeenCalledWith(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        'submit'
      );
      expect(res.setHeader).toHaveBeenCalledWith('X-Wallet-RateLimit-Limit', 10);
      expect(res.setHeader).toHaveBeenCalledWith('X-Wallet-RateLimit-Remaining', 7);
      expect(next).toHaveBeenCalled();
    });

    it('should return 429 when submit rate limit exceeded', async () => {
      redis.incrWalletRateLimit.mockResolvedValue(11); // Exceeds limit of 10

      const req = {
        body: { userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        ip: '127.0.0.1',
      };
      const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await walletSubmitLimiter(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Wallet rate limit exceeded (10/submits per minute)',
        code: 'WALLET_RATE_LIMITED',
        retryAfter: 60,
      });
    });

    it('should not set negative remaining count', async () => {
      redis.incrWalletRateLimit.mockResolvedValue(15); // Way over limit

      const req = {
        body: { userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        ip: '127.0.0.1',
      };
      const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await walletSubmitLimiter(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Wallet-RateLimit-Remaining', 0);
    });
  });

  describe('IP normalization', () => {
    it('should handle missing IP gracefully', async () => {
      redis.incrWalletRateLimit.mockResolvedValue(51);

      const req = {
        body: { userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        ip: undefined,
      };
      const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await walletQuoteLimiter(req, res, next);

      expect(logger.warn).toHaveBeenCalledWith(
        'SECURITY',
        'Wallet rate limit exceeded',
        expect.objectContaining({ ip: 'unknown' })
      );
    });

    it('should handle IPv4 addresses unchanged', async () => {
      redis.incrWalletRateLimit.mockResolvedValue(51);

      const req = {
        body: { userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        ip: '10.0.0.1',
      };
      const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await walletQuoteLimiter(req, res, next);

      expect(logger.warn).toHaveBeenCalledWith(
        'SECURITY',
        'Wallet rate limit exceeded',
        expect.objectContaining({ ip: '10.0.0.1' })
      );
    });

    it('should normalize ::ffff: prefixed IPs', async () => {
      redis.incrWalletRateLimit.mockResolvedValue(51);

      const req = {
        body: { userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        ip: '::ffff:10.0.0.1',
      };
      const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await walletQuoteLimiter(req, res, next);

      expect(logger.warn).toHaveBeenCalledWith(
        'SECURITY',
        'Wallet rate limit exceeded',
        expect.objectContaining({ ip: '10.0.0.1' })
      );
    });
  });
});
