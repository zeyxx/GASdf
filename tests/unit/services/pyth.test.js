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

  describe('getPrice()', () => {
    const createMockPriceAccountData = (price, exponent = -8) => {
      // Create minimal PriceUpdateV2 account data
      const buffer = Buffer.alloc(150);
      let offset = 0;

      // Anchor discriminator (8 bytes)
      offset += 8;

      // writeAuthority (32 bytes)
      offset += 32;

      // verificationLevel (1 byte - Full=1)
      buffer.writeUInt8(1, offset);
      offset += 1;

      // feedId (32 bytes)
      offset += 32;

      // price (i64)
      buffer.writeBigInt64LE(BigInt(price), offset);
      offset += 8;

      // conf (u64)
      buffer.writeBigUInt64LE(BigInt(100000), offset);
      offset += 8;

      // exponent (i32)
      buffer.writeInt32LE(exponent, offset);
      offset += 4;

      // publishTime (i64) - current time
      buffer.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), offset);
      offset += 8;

      // prevPublishTime (i64)
      offset += 8;

      // emaPrice (i64)
      buffer.writeBigInt64LE(BigInt(price), offset);

      return buffer;
    };

    it('should fetch price from RPC', async () => {
      const rpc = require('../../../src/utils/rpc');
      const mockConnection = {
        getAccountInfo: jest.fn().mockResolvedValue({
          owner: { toBase58: () => 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ' },
          data: createMockPriceAccountData(20500000000, -8), // $205.00
        }),
      };
      rpc.getConnection.mockReturnValue(mockConnection);

      const result = await pyth.getPrice('SOL/USD');

      expect(result).toHaveProperty('price');
      expect(result).toHaveProperty('confidence');
      expect(result.cached).toBe(false);
      expect(result.feed).toBe('SOL/USD');
    });

    it('should throw error for unknown feed', async () => {
      await expect(pyth.getPrice('INVALID/USD')).rejects.toThrow('Unknown Pyth feed');
    });

    it('should return cached value on second call', async () => {
      const rpc = require('../../../src/utils/rpc');
      const mockConnection = {
        getAccountInfo: jest.fn().mockResolvedValue({
          owner: { toBase58: () => 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ' },
          data: createMockPriceAccountData(20500000000, -8),
        }),
      };
      rpc.getConnection.mockReturnValue(mockConnection);

      // First call
      await pyth.getPrice('BTC/USD');
      // Second call should be cached
      const result = await pyth.getPrice('BTC/USD');

      expect(result.cached).toBe(true);
    });

    it('should throw error when account not found', async () => {
      const rpc = require('../../../src/utils/rpc');
      const mockConnection = {
        getAccountInfo: jest.fn().mockResolvedValue(null),
      };
      rpc.getConnection.mockReturnValue(mockConnection);

      // Clear cache first
      jest.resetModules();
      const freshPyth = require('../../../src/services/pyth');

      await expect(freshPyth.getPrice('ETH/USD')).rejects.toThrow('Pyth account not found');
    });

    it('should throw error for invalid account owner', async () => {
      // Clear cache and re-setup mocks
      jest.resetModules();

      jest.doMock('../../../src/utils/rpc', () => ({
        getConnection: jest.fn().mockReturnValue({
          getAccountInfo: jest.fn().mockResolvedValue({
            owner: { toBase58: () => 'WrongOwner111111111111111111111111111111111' },
            data: createMockPriceAccountData(20500000000, -8),
          }),
        }),
      }));

      const freshPyth = require('../../../src/services/pyth');

      await expect(freshPyth.getPrice('USDC/USD')).rejects.toThrow('Invalid account owner');
    });
  });

  describe('getSolPriceUsd()', () => {
    it('should return SOL price from getPrice', async () => {
      const rpc = require('../../../src/utils/rpc');
      const mockData = Buffer.alloc(150);
      // Set up minimal valid data
      mockData.writeUInt8(1, 41); // verificationLevel = Full
      mockData.writeBigInt64LE(BigInt(20500000000), 74); // price
      mockData.writeBigUInt64LE(BigInt(100000), 82); // conf
      mockData.writeInt32LE(-8, 90); // exponent
      mockData.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 94); // publishTime
      mockData.writeBigInt64LE(BigInt(20500000000), 110); // emaPrice

      const mockConnection = {
        getAccountInfo: jest.fn().mockResolvedValue({
          owner: { toBase58: () => 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ' },
          data: mockData,
        }),
      };
      rpc.getConnection.mockReturnValue(mockConnection);

      const price = await pyth.getSolPriceUsd();

      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0);
    });
  });

  describe('getTokenPriceUsd()', () => {
    it('should return null for token without Pyth feed', async () => {
      const price = await pyth.getTokenPriceUsd('RandomToken123');
      expect(price).toBeNull();
    });

    it('should return price for USDC', async () => {
      const rpc = require('../../../src/utils/rpc');
      const mockData = Buffer.alloc(150);
      mockData.writeUInt8(1, 41);
      mockData.writeBigInt64LE(BigInt(100000000), 74); // $1.00
      mockData.writeBigUInt64LE(BigInt(100000), 82);
      mockData.writeInt32LE(-8, 90);
      mockData.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 94);
      mockData.writeBigInt64LE(BigInt(100000000), 110);

      const mockConnection = {
        getAccountInfo: jest.fn().mockResolvedValue({
          owner: { toBase58: () => 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ' },
          data: mockData,
        }),
      };
      rpc.getConnection.mockReturnValue(mockConnection);

      const price = await pyth.getTokenPriceUsd('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

      expect(typeof price).toBe('number');
    });
  });

  describe('warmCache()', () => {
    it('should warm cache without throwing', async () => {
      const rpc = require('../../../src/utils/rpc');
      const logger = require('../../../src/utils/logger');

      const mockData = Buffer.alloc(150);
      mockData.writeUInt8(1, 41);
      mockData.writeBigInt64LE(BigInt(20500000000), 74);
      mockData.writeBigUInt64LE(BigInt(100000), 82);
      mockData.writeInt32LE(-8, 90);
      mockData.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 94);
      mockData.writeBigInt64LE(BigInt(20500000000), 110);

      const mockConnection = {
        getAccountInfo: jest.fn().mockResolvedValue({
          owner: { toBase58: () => 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ' },
          data: mockData,
        }),
      };
      rpc.getConnection.mockReturnValue(mockConnection);

      await expect(pyth.warmCache()).resolves.toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith('PYTH', 'Cache warmed', expect.any(Object));
    });

    it('should warn on cache warm failure', async () => {
      // Clear cache and re-setup mocks
      jest.resetModules();

      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };

      jest.doMock('../../../src/utils/logger', () => mockLogger);

      jest.doMock('../../../src/utils/rpc', () => ({
        getConnection: jest.fn().mockReturnValue({
          getAccountInfo: jest.fn().mockRejectedValue(new Error('RPC error')),
        }),
      }));

      const freshPyth = require('../../../src/services/pyth');

      await expect(freshPyth.warmCache()).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith('PYTH', 'Cache warm failed', expect.any(Object));
    });
  });

  describe('MINT_TO_FEED', () => {
    it('should map SOL mint to SOL/USD', () => {
      expect(pyth.MINT_TO_FEED['So11111111111111111111111111111111111111112']).toBe('SOL/USD');
    });

    it('should map USDC mint to USDC/USD', () => {
      expect(pyth.MINT_TO_FEED['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']).toBe('USDC/USD');
    });

    it('should map USDT mint to USDT/USD', () => {
      expect(pyth.MINT_TO_FEED['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']).toBe('USDT/USD');
    });
  });

  describe('getFeeInToken() for stablecoins', () => {
    beforeEach(() => {
      const rpc = require('../../../src/utils/rpc');
      const mockData = Buffer.alloc(150);
      mockData.writeUInt8(1, 41);
      mockData.writeBigInt64LE(BigInt(20500000000), 74); // $205.00
      mockData.writeBigUInt64LE(BigInt(100000), 82);
      mockData.writeInt32LE(-8, 90);
      mockData.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 94);
      mockData.writeBigInt64LE(BigInt(20500000000), 110);

      const mockConnection = {
        getAccountInfo: jest.fn().mockResolvedValue({
          owner: { toBase58: () => 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ' },
          data: mockData,
        }),
      };
      rpc.getConnection.mockReturnValue(mockConnection);
    });

    it('should convert SOL to USDC', async () => {
      const result = await pyth.getFeeInToken(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        1000000000 // 1 SOL
      );

      expect(result).not.toBeNull();
      expect(result.symbol).toBe('USDC');
      expect(result.decimals).toBe(6);
      expect(result.source).toBe('pyth');
      expect(result.inputAmount).toBeGreaterThan(0);
    });

    it('should convert SOL to USDT', async () => {
      const result = await pyth.getFeeInToken(
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
        1000000000 // 1 SOL
      );

      expect(result).not.toBeNull();
      expect(result.symbol).toBe('USDT');
      expect(result.decimals).toBe(6);
      expect(result.source).toBe('pyth');
    });
  });
});
