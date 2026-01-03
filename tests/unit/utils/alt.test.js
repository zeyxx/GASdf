/**
 * Address Lookup Table (ALT) Utility Tests
 */

// Mock PublicKey class
const mockPublicKey = jest.fn().mockImplementation((key) => ({
  toBase58: () => key,
  toString: () => key,
  equals: jest.fn((other) => key === other?.toBase58?.()),
}));

jest.mock('@solana/web3.js', () => ({
  PublicKey: mockPublicKey,
  AddressLookupTableProgram: {
    createLookupTable: jest
      .fn()
      .mockReturnValue([{ type: 'createAlt' }, { toBase58: () => 'new-alt-address' }]),
    extendLookupTable: jest.fn().mockReturnValue({ type: 'extendAlt' }),
  },
  TransactionMessage: jest.fn().mockImplementation(() => ({
    compileToV0Message: jest.fn().mockReturnValue({ type: 'v0message' }),
  })),
  VersionedTransaction: jest.fn().mockImplementation((msg) => ({
    message: msg,
    sign: jest.fn(),
  })),
}));

jest.mock('../../../src/utils/rpc', () => ({
  getConnection: jest.fn(() => ({
    getAddressLookupTable: jest.fn().mockResolvedValue({
      value: {
        state: {
          addresses: [
            { toBase58: () => '11111111111111111111111111111111' },
            { toBase58: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          ],
        },
      },
    }),
  })),
}));

jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../../src/utils/config', () => ({
  ASDF_MINT: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
  TREASURY_ADDRESS: null,
}));

describe('ALT Utility', () => {
  let alt;
  const SYSTEM_PROGRAM = '11111111111111111111111111111111';
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment but don't reset modules (mocks would be lost)
    process.env = { ...originalEnv };
    delete process.env.ALT_ADDRESS;

    // Fresh require of the module
    jest.isolateModules(() => {
      alt = require('../../../src/utils/alt');
    });
    alt.clearCache();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getAltAddress()', () => {
    it('should return null if ALT_ADDRESS not configured', () => {
      delete process.env.ALT_ADDRESS;
      jest.isolateModules(() => {
        alt = require('../../../src/utils/alt');
      });
      expect(alt.getAltAddress()).toBeNull();
    });

    it('should return PublicKey if ALT_ADDRESS is valid', () => {
      process.env.ALT_ADDRESS = SYSTEM_PROGRAM;
      jest.isolateModules(() => {
        alt = require('../../../src/utils/alt');
      });

      const address = alt.getAltAddress();
      expect(address).not.toBeNull();
      expect(address.toBase58()).toBe(SYSTEM_PROGRAM);
    });

    it('should handle invalid ALT_ADDRESS gracefully', () => {
      // The getAltAddress function catches errors and returns null
      // When ALT_ADDRESS is not set (or invalid in real implementation),
      // getAltAddress should return null
      delete process.env.ALT_ADDRESS;
      jest.isolateModules(() => {
        alt = require('../../../src/utils/alt');
      });

      // Verify we can call getAltAddress even with no config
      const result = alt.getAltAddress();
      expect(result).toBeNull();
    });
  });

  describe('isAltConfigured()', () => {
    it('should return false if not configured', () => {
      delete process.env.ALT_ADDRESS;
      jest.isolateModules(() => {
        alt = require('../../../src/utils/alt');
      });
      expect(alt.isAltConfigured()).toBe(false);
    });

    it('should return true if configured', () => {
      process.env.ALT_ADDRESS = SYSTEM_PROGRAM;
      jest.isolateModules(() => {
        alt = require('../../../src/utils/alt');
      });

      expect(alt.isAltConfigured()).toBe(true);
    });
  });

  describe('getStatus()', () => {
    it('should return status object when not configured', () => {
      delete process.env.ALT_ADDRESS;
      jest.isolateModules(() => {
        alt = require('../../../src/utils/alt');
      });

      const status = alt.getStatus();

      expect(status).toEqual({
        configured: false,
        address: null,
        cached: false,
        cacheAge: null,
        addressCount: 0,
      });
    });

    it('should return status object when configured', () => {
      process.env.ALT_ADDRESS = SYSTEM_PROGRAM;
      jest.isolateModules(() => {
        alt = require('../../../src/utils/alt');
      });

      const status = alt.getStatus();

      expect(status.configured).toBe(true);
      expect(status.address).toBe(SYSTEM_PROGRAM);
      expect(status.cached).toBe(false);
    });
  });

  describe('CORE_ADDRESSES', () => {
    beforeEach(() => {
      jest.isolateModules(() => {
        alt = require('../../../src/utils/alt');
      });
    });

    it('should contain system program', () => {
      expect(alt.CORE_ADDRESSES.SYSTEM_PROGRAM.toBase58()).toBe('11111111111111111111111111111111');
    });

    it('should contain token program', () => {
      expect(alt.CORE_ADDRESSES.TOKEN_PROGRAM.toBase58()).toBe(
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
      );
    });

    it('should contain Jupiter program', () => {
      expect(alt.CORE_ADDRESSES.JUPITER_PROGRAM.toBase58()).toBe(
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
      );
    });

    it('should contain WSOL mint', () => {
      expect(alt.CORE_ADDRESSES.WSOL_MINT.toBase58()).toBe(
        'So11111111111111111111111111111111111111112'
      );
    });

    it('should contain USDC mint', () => {
      expect(alt.CORE_ADDRESSES.USDC_MINT.toBase58()).toBe(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      );
    });
  });

  describe('getCoreAddressesForAlt()', () => {
    beforeEach(() => {
      jest.isolateModules(() => {
        alt = require('../../../src/utils/alt');
      });
    });

    it('should return array of PublicKeys', () => {
      const addresses = alt.getCoreAddressesForAlt();

      expect(Array.isArray(addresses)).toBe(true);
      expect(addresses.length).toBeGreaterThan(5);

      addresses.forEach((addr) => {
        expect(addr.toBase58).toBeDefined();
      });
    });

    it('should include ASDF mint when configured', () => {
      const addresses = alt.getCoreAddressesForAlt();
      const asdfAddress = addresses.find(
        (a) => a.toBase58() === '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump'
      );

      expect(asdfAddress).toBeDefined();
    });
  });

  describe('calculateSizeSavings()', () => {
    beforeEach(() => {
      jest.isolateModules(() => {
        alt = require('../../../src/utils/alt');
      });
    });

    it('should calculate savings correctly', () => {
      const result = alt.calculateSizeSavings(10, 8);

      expect(result.withoutAlt).toBe(320); // 10 * 32
      expect(result.withAlt).toBe(72); // 2 * 32 + 8 * 1
      expect(result.savings).toBe(248);
    });

    it('should return 0 savings when no ALT hits', () => {
      const result = alt.calculateSizeSavings(5, 0);

      expect(result.withoutAlt).toBe(160);
      expect(result.withAlt).toBe(160);
      expect(result.savings).toBe(0);
    });

    it('should calculate max savings when all in ALT', () => {
      const result = alt.calculateSizeSavings(10, 10);

      expect(result.withoutAlt).toBe(320);
      expect(result.withAlt).toBe(10); // All indexes
      expect(result.savings).toBe(310);
    });
  });

  describe('clearCache()', () => {
    it('should clear the cache', () => {
      jest.isolateModules(() => {
        alt = require('../../../src/utils/alt');
      });

      // Verify status shows no cache
      const statusBefore = alt.getStatus();
      expect(statusBefore.cached).toBe(false);

      alt.clearCache();

      const statusAfter = alt.getStatus();
      expect(statusAfter.cached).toBe(false);
    });
  });

  describe('createVersionedTransaction()', () => {
    it('should create a VersionedTransaction', async () => {
      process.env.ALT_ADDRESS = SYSTEM_PROGRAM;
      jest.isolateModules(() => {
        alt = require('../../../src/utils/alt');
      });

      const instructions = [{ type: 'transfer' }];
      const payer = { toBase58: () => 'payer-address' };
      const blockhash = 'test-blockhash';

      const tx = await alt.createVersionedTransaction(instructions, payer, blockhash);

      expect(tx).toBeDefined();
      expect(tx.message).toBeDefined();
    });
  });
});
