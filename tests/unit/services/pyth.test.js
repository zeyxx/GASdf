/**
 * Pyth Oracle Service Tests
 */

jest.mock('../../../src/utils/rpc', () => ({
  getConnection: jest.fn(() => ({
    getAccountInfo: jest.fn(),
  })),
}));

jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../../src/utils/config', () => ({
  WSOL_MINT: 'So11111111111111111111111111111111111111112',
}));

describe('Pyth Oracle Service', () => {
  let pyth;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    pyth = require('../../../src/services/pyth');
  });

  describe('getStatus()', () => {
    it('should return status object', () => {
      const status = pyth.getStatus();

      expect(status).toHaveProperty('type', 'pyth');
      expect(status).toHaveProperty('feeds');
      expect(status).toHaveProperty('cache');
      expect(status).toHaveProperty('rpcCalls');
      expect(status.cache).toHaveProperty('ttlMs');
      expect(status.cache).toHaveProperty('hits');
      expect(status.cache).toHaveProperty('misses');
    });
  });

  describe('hasPythFeed()', () => {
    it('should return true for SOL', () => {
      expect(pyth.hasPythFeed('So11111111111111111111111111111111111111112')).toBe(true);
    });

    it('should return true for USDC', () => {
      expect(pyth.hasPythFeed('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    });

    it('should return true for USDT', () => {
      expect(pyth.hasPythFeed('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')).toBe(true);
    });

    it('should return false for unknown token', () => {
      expect(pyth.hasPythFeed('UnknownMint123')).toBe(false);
    });
  });

  describe('PYTH_FEEDS', () => {
    it('should have SOL/USD feed', () => {
      expect(pyth.PYTH_FEEDS['SOL/USD']).toBeDefined();
      expect(pyth.PYTH_FEEDS['SOL/USD'].toBase58()).toBe(
        '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'
      );
    });

    it('should have BTC/USD feed', () => {
      expect(pyth.PYTH_FEEDS['BTC/USD']).toBeDefined();
    });

    it('should have ETH/USD feed', () => {
      expect(pyth.PYTH_FEEDS['ETH/USD']).toBeDefined();
    });
  });

  describe('getFeeInToken()', () => {
    it('should return native source for SOL', async () => {
      const result = await pyth.getFeeInToken('So11111111111111111111111111111111111111112', 50000);

      expect(result).toEqual({
        inputAmount: 50000,
        outputAmount: 50000,
        priceImpactPct: 0,
        symbol: 'SOL',
        decimals: 9,
        source: 'native',
      });
    });

    it('should return null for token without Pyth feed when RPC unavailable', async () => {
      // For tokens without MINT_TO_FEED mapping, returns null immediately
      const result = await pyth.getFeeInToken('UnknownMint123', 50000);
      expect(result).toBeNull();
    });
  });
});
