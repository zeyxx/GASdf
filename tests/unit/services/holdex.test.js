/**
 * Tests for HolDex Integration
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

  describe('isVerifiedCommunity()', () => {
    const testMint = 'TestMint111111111111111111111111111111111111';

    it('should return verified=true and kScore for verified community', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hasCommunityUpdate: true, kScore: 70 }),
      });

      const result = await holdex.isVerifiedCommunity(testMint);

      expect(result.verified).toBe(true);
      expect(result.kScore).toBe(70);
      expect(result.cached).toBe(false);
    });

    it('should return verified=false and kScore for unverified community', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hasCommunityUpdate: false, kScore: 30 }),
      });

      const result = await holdex.isVerifiedCommunity(testMint);

      expect(result.verified).toBe(false);
      expect(result.kScore).toBe(30);
      expect(result.cached).toBe(false);
    });

    it('should return verified=false and kScore=0 for 404 (token not found)', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await holdex.isVerifiedCommunity(testMint);

      expect(result.verified).toBe(false);
      expect(result.kScore).toBe(0);
      expect(result.cached).toBe(false);
    });

    it('should cache results including kScore', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hasCommunityUpdate: true, kScore: 75 }),
      });

      // First call
      await holdex.isVerifiedCommunity(testMint);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result = await holdex.isVerifiedCommunity(testMint);
      expect(result.cached).toBe(true);
      expect(result.kScore).toBe(75);
      expect(global.fetch).toHaveBeenCalledTimes(1); // No additional call
    });

    it('should return error and kScore=0 when HOLDEX_URL not configured', async () => {
      // Temporarily remove HOLDEX_URL
      const originalUrl = config.HOLDEX_URL;
      config.HOLDEX_URL = undefined;

      const result = await holdex.isVerifiedCommunity(testMint);

      expect(result.verified).toBe(false);
      expect(result.kScore).toBe(0);
      expect(result.error).toContain('not configured');

      // Restore
      config.HOLDEX_URL = originalUrl;
    });

    it('should handle fetch errors gracefully with kScore=0', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      const result = await holdex.isVerifiedCommunity(testMint);

      expect(result.verified).toBe(false);
      expect(result.kScore).toBe(0);
      expect(result.error).toBe('Network error');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should call correct API endpoint', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hasCommunityUpdate: true }),
      });

      await holdex.isVerifiedCommunity(testMint);

      expect(global.fetch).toHaveBeenCalledWith(
        `https://holdex.test/token/${testMint}`,
        expect.objectContaining({
          headers: { 'Accept': 'application/json' },
        })
      );
    });

    it('should log debug on successful verification with kScore', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hasCommunityUpdate: true, kScore: 80 }),
      });

      await holdex.isVerifiedCommunity(testMint);

      expect(logger.debug).toHaveBeenCalledWith(
        'HOLDEX',
        'Verification result',
        expect.objectContaining({ verified: true, kScore: 80 })
      );
    });
  });

  describe('clearCache()', () => {
    it('should clear the cache', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hasCommunityUpdate: true }),
      });

      const testMint = 'CacheMint11111111111111111111111111111111111';

      // Populate cache
      await holdex.isVerifiedCommunity(testMint);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Clear cache
      holdex.clearCache();

      // Should fetch again
      await holdex.isVerifiedCommunity(testMint);
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
        json: () => Promise.resolve({ hasCommunityUpdate: true }),
      });

      await holdex.isVerifiedCommunity('Mint1111111111111111111111111111111111111111');
      await holdex.isVerifiedCommunity('Mint2222222222222222222222222222222222222222');

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
