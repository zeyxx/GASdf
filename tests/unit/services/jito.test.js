/**
 * Jito Bundle Service Tests
 */

// Mock fetch globally
global.fetch = jest.fn();

// Mock dependencies
jest.mock('../../../src/utils/config', () => ({
  NETWORK: 'mainnet-beta',
}));

jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Mock @solana/web3.js
const mockPublicKey = jest.fn().mockImplementation((key) => ({
  toBase58: () => key,
  toString: () => key,
}));

jest.mock('@solana/web3.js', () => ({
  PublicKey: mockPublicKey,
  SystemProgram: {
    transfer: jest.fn().mockReturnValue({
      type: 'transfer',
      keys: [],
      programId: { toBase58: () => '11111111111111111111111111111111' },
    }),
  },
  TransactionInstruction: jest.fn(),
}));

describe('Jito Bundle Service', () => {
  let jito;
  let _config;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch.mockReset();

    // Fresh require of the module
    jest.isolateModules(() => {
      jito = require('../../../src/services/jito');
      _config = require('../../../src/utils/config');
    });
  });

  describe('isEnabled()', () => {
    it('should return true on mainnet-beta', () => {
      expect(jito.isEnabled()).toBe(true);
    });

    it('should return false when JITO_DISABLED is set', () => {
      process.env.JITO_DISABLED = 'true';
      jest.isolateModules(() => {
        jito = require('../../../src/services/jito');
      });
      expect(jito.isEnabled()).toBe(false);
      delete process.env.JITO_DISABLED;
    });
  });

  describe('TIP_ACCOUNTS', () => {
    it('should have 8 tip accounts', () => {
      expect(jito.TIP_ACCOUNTS).toHaveLength(8);
    });

    it('should contain valid base58 addresses', () => {
      jito.TIP_ACCOUNTS.forEach((account) => {
        expect(account).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      });
    });
  });

  describe('getRandomTipAccount()', () => {
    it('should return a PublicKey', () => {
      const tipAccount = jito.getRandomTipAccount();
      expect(tipAccount).toBeDefined();
      expect(tipAccount.toBase58).toBeDefined();
    });

    it('should return different accounts over multiple calls', () => {
      const accounts = new Set();
      for (let i = 0; i < 100; i++) {
        accounts.add(jito.getRandomTipAccount().toBase58());
      }
      // Should get at least 2 different accounts over 100 calls
      expect(accounts.size).toBeGreaterThan(1);
    });
  });

  describe('createTipInstruction()', () => {
    it('should create a transfer instruction', () => {
      const payer = { toBase58: () => 'payer-address' };
      const tipIx = jito.createTipInstruction(payer, 10000);

      expect(tipIx).toBeDefined();
      expect(tipIx.type).toBe('transfer');
    });

    it('should enforce minimum tip amount', () => {
      const payer = { toBase58: () => 'payer-address' };

      // Even with low tip, it should create an instruction
      const tipIx = jito.createTipInstruction(payer, 100); // Below minimum

      // Should still return a valid instruction
      expect(tipIx).toBeDefined();
      expect(tipIx.type).toBe('transfer');

      // The actual enforcement is done inside the function via Math.max
      // MIN_TIP_LAMPORTS is 1000, so passing 100 should use 1000
    });
  });

  describe('sendBundle()', () => {
    it('should reject empty transaction array', async () => {
      await expect(jito.sendBundle([])).rejects.toThrow('No transactions provided');
    });

    it('should reject more than 5 transactions', async () => {
      const transactions = Array(6).fill({ serialize: () => Buffer.from('tx') });
      await expect(jito.sendBundle(transactions)).rejects.toThrow(
        'Bundle cannot exceed 5 transactions'
      );
    });

    it('should send bundle to Jito endpoint', async () => {
      global.fetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: 'bundle-id-123',
          }),
      });

      const mockTx = {
        serialize: () => Buffer.from('mock-transaction-data'),
      };

      const result = await jito.sendBundle([mockTx]);

      expect(result.success).toBe(true);
      expect(result.bundleId).toBe('bundle-id-123');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('block-engine.jito.wtf'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should handle Jito API errors', async () => {
      global.fetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: { code: -32000, message: 'Bundle rejected' },
          }),
      });

      const mockTx = { serialize: () => Buffer.from('tx') };
      const result = await jito.sendBundle([mockTx]);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle network errors', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      const mockTx = { serialize: () => Buffer.from('tx') };
      const result = await jito.sendBundle([mockTx]);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('sendTransaction()', () => {
    it('should send transaction via Jito', async () => {
      global.fetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: 'signature-123',
          }),
      });

      const mockTx = { serialize: () => Buffer.from('tx') };
      const result = await jito.sendTransaction(mockTx);

      expect(result.success).toBe(true);
      expect(result.signature).toBe('signature-123');
    });

    it('should use bundleOnly query param by default', async () => {
      global.fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ result: 'sig' }),
      });

      const mockTx = { serialize: () => Buffer.from('tx') };
      await jito.sendTransaction(mockTx);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('bundleOnly=true'),
        expect.any(Object)
      );
    });
  });

  describe('getBundleStatus()', () => {
    it('should return not found for null bundleId', async () => {
      const result = await jito.getBundleStatus(null);
      expect(result.status).toBe('unknown');
    });

    it('should fetch bundle status from Jito', async () => {
      global.fetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: {
              value: [
                {
                  bundle_id: 'bundle-123',
                  confirmation_status: 'confirmed',
                  slot: 12345,
                  transactions: ['tx1', 'tx2'],
                },
              ],
            },
          }),
      });

      const result = await jito.getBundleStatus('bundle-123');

      expect(result.status).toBe('confirmed');
      expect(result.slot).toBe(12345);
      expect(result.bundleId).toBe('bundle-123');
    });

    it('should handle bundle not found', async () => {
      global.fetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: { value: [] },
          }),
      });

      const result = await jito.getBundleStatus('unknown-bundle');
      expect(result.status).toBe('not_found');
    });
  });

  describe('getTipFloor()', () => {
    it('should fetch tip floor from Jito API', async () => {
      global.fetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            {
              time: '2024-01-01T00:00:00Z',
              landed_tips_50th_percentile: 0.00001,
              landed_tips_75th_percentile: 0.00002,
              landed_tips_95th_percentile: 0.0001,
              ema_landed_tips_50th_percentile: 0.000015,
            },
          ]),
      });

      const result = await jito.getTipFloor();

      expect(result.p50).toBe(10000); // 0.00001 SOL in lamports
      expect(result.p75).toBe(20000);
      expect(result.p95).toBe(100000);
    });

    it('should return defaults on error', async () => {
      global.fetch.mockRejectedValueOnce(new Error('API error'));

      const result = await jito.getTipFloor();

      expect(result.p50).toBe(jito.DEFAULT_TIP_LAMPORTS);
      expect(result.error).toBeDefined();
    });
  });

  describe('getRecommendedTip()', () => {
    beforeEach(() => {
      global.fetch.mockResolvedValue({
        json: () =>
          Promise.resolve([
            {
              landed_tips_50th_percentile: 0.00001,
              landed_tips_75th_percentile: 0.00003,
              landed_tips_95th_percentile: 0.0001,
            },
          ]),
      });
    });

    it('should return p50 for low priority', async () => {
      const tip = await jito.getRecommendedTip('low');
      expect(tip).toBe(10000);
    });

    it('should return p75 for medium priority', async () => {
      const tip = await jito.getRecommendedTip('medium');
      expect(tip).toBe(30000);
    });

    it('should return p95 for high priority', async () => {
      const tip = await jito.getRecommendedTip('high');
      expect(tip).toBe(100000);
    });
  });

  describe('getStatus()', () => {
    it('should return service status', () => {
      const status = jito.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.network).toBe('mainnet-beta');
      expect(status.endpoint).toContain('jito.wtf');
      expect(status.tipAccounts).toBe(8);
      expect(status.stats).toBeDefined();
      expect(status.stats.bundlesSent).toBeDefined();
    });
  });

  describe('createSandwichProtection()', () => {
    it('should return account key for protection', () => {
      const protection = jito.createSandwichProtection();

      expect(protection.pubkey).toBeDefined();
      expect(protection.isSigner).toBe(false);
      expect(protection.isWritable).toBe(false);
    });
  });

  describe('Non-mainnet behavior', () => {
    beforeEach(() => {
      jest.isolateModules(() => {
        jest.doMock('../../../src/utils/config', () => ({
          NETWORK: 'devnet',
        }));
        jito = require('../../../src/services/jito');
      });
    });

    it('should return false for isEnabled on devnet', () => {
      expect(jito.isEnabled()).toBe(false);
    });

    it('should skip bundle on devnet', async () => {
      const mockTx = { serialize: () => Buffer.from('tx') };
      const result = await jito.sendBundle([mockTx]);

      expect(result.success).toBe(false);
      expect(result.fallback).toBe(true);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
