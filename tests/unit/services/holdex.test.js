/**
 * HolDex Verification Service Tests
 */

// Mock logger first
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock fetch
jest.mock('../../../src/utils/fetch-timeout', () => ({
  fetchWithTimeout: jest.fn(),
}));

const { isVerified, requireVerified, clearCache } = require('../../../src/services/holdex');
const config = require('../../../src/utils/config');
const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');

describe('HolDex Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });

  describe('isVerified()', () => {
    it('should return false for missing mint', async () => {
      const result = await isVerified(null);
      expect(result.verified).toBe(false);
      expect(result.error).toBe('Missing mint address');
    });

    it('should return true for verified token', async () => {
      fetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          token: {
            mint: 'VerifiedMint123',
            name: 'Verified Token',
            ticker: 'VER',
            hasCommunityUpdate: true,
            k_score: 75,
          },
        }),
      });

      const result = await isVerified('VerifiedMint123');
      expect(result.verified).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.token.name).toBe('Verified Token');
      expect(result.error).toBeNull();
    });

    it('should return false for unverified token', async () => {
      fetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          token: {
            mint: 'UnverifiedMint123',
            name: 'Unverified Token',
            ticker: 'UNV',
            hasCommunityUpdate: false,
            k_score: 10,
          },
        }),
      });

      const result = await isVerified('UnverifiedMint123');
      expect(result.verified).toBe(false);
      expect(result.error).toBe('Community not verified on HolDex');
    });

    it('should return false for 404 (token not found)', async () => {
      fetchWithTimeout.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await isVerified('NonExistentMint');
      expect(result.verified).toBe(false);
      expect(result.error).toBe('Token not listed on HolDex');
    });

    it('should cache verification results', async () => {
      fetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          token: {
            mint: 'CachedMint123',
            name: 'Cached Token',
            ticker: 'CACHE',
            hasCommunityUpdate: true,
            k_score: 50,
          },
        }),
      });

      // First call
      await isVerified('CachedMint123');

      // Second call should use cache
      await isVerified('CachedMint123');

      expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    });

    it('should bypass verification in dev mode on API failure', async () => {
      const originalIsDev = config.IS_DEV;
      config.IS_DEV = true;

      fetchWithTimeout.mockRejectedValueOnce(new Error('Network error'));

      const result = await isVerified('FailingMint123');
      expect(result.verified).toBe(true);

      config.IS_DEV = originalIsDev;
    });

    it('should handle hascommunityupdate lowercase field', async () => {
      fetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          token: {
            mint: 'LowercaseMint',
            name: 'Lowercase Token',
            ticker: 'LOW',
            hascommunityupdate: true, // lowercase
            k_score: 60,
          },
        }),
      });

      const result = await isVerified('LowercaseMint');
      expect(result.verified).toBe(true);
    });
  });

  describe('requireVerified middleware', () => {
    it('should call next for SOL payment (always allowed)', (done) => {
      const req = { body: { paymentToken: config.WSOL_MINT } };
      const res = {};
      const next = () => {
        done();
      };

      requireVerified(req, res, next);
    });

    it('should call next for $ASDF payment (always allowed)', (done) => {
      const req = { body: { paymentToken: config.ASDF_MINT } };
      const res = {};
      const next = () => {
        done();
      };

      requireVerified(req, res, next);
    });

    it('should reject missing paymentToken', (done) => {
      const req = { body: {} };
      const res = {
        status: (code) => {
          expect(code).toBe(400);
          return res;
        },
        json: (data) => {
          expect(data.error).toBe('Missing paymentToken');
          done();
        },
      };
      const next = jest.fn();

      requireVerified(req, res, next);
    });

    it('should reject unverified token with 403', (done) => {
      fetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          token: {
            mint: 'UnverifiedToken',
            hasCommunityUpdate: false,
          },
        }),
      });

      const req = { body: { paymentToken: 'UnverifiedToken' } };
      const res = {
        status: (code) => {
          expect(code).toBe(403);
          return res;
        },
        json: (data) => {
          expect(data.code).toBe('HOLDEX_NOT_VERIFIED');
          done();
        },
      };
      const next = jest.fn();

      requireVerified(req, res, next);
    });

    it('should attach token data to request for verified tokens', (done) => {
      fetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          token: {
            mint: 'VerifiedCommunity',
            name: 'Verified Community',
            ticker: 'VCOM',
            hasCommunityUpdate: true,
            k_score: 80,
          },
        }),
      });

      const req = { body: { paymentToken: 'VerifiedCommunity' } };
      const res = {};
      const next = () => {
        expect(req.holdexToken).toBeDefined();
        expect(req.holdexToken.name).toBe('Verified Community');
        done();
      };

      requireVerified(req, res, next);
    });
  });
});
