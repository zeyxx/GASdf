/**
 * Tests for Burn Service
 *
 * HYBRID MODEL:
 * - For $ASDF: 100% burn (every $ASDF fee is burned!)
 * - For other tokens: Swap 100% → $ASDF → 76.4% burn / 23.6% treasury (unified)
 */

// Mock dependencies before requiring the module
const mockPublicKey = jest.fn().mockImplementation((key) => ({
  toBase58: () => key,
  toString: () => key,
  equals: jest.fn((other) => key === other?.toBase58?.()),
}));

const mockTransaction = {
  add: jest.fn().mockReturnThis(),
  sign: jest.fn(),
};

jest.mock('@solana/web3.js', () => ({
  PublicKey: mockPublicKey,
  Transaction: Object.assign(
    jest.fn().mockImplementation(() => mockTransaction),
    { from: jest.fn().mockReturnValue(mockTransaction) }
  ),
}));

jest.mock('@solana/spl-token', () => ({
  createBurnInstruction: jest.fn().mockReturnValue({ type: 'burn' }),
  getAssociatedTokenAddress: jest.fn().mockResolvedValue('token-account-address'),
  getAccount: jest.fn().mockResolvedValue({ amount: BigInt(1000000) }),
  TOKEN_PROGRAM_ID: { toBase58: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
}));

jest.mock('../../../src/utils/config', () => ({
  ASDF_MINT: 'AsdfMint111111111111111111111111111111111111',
  WSOL_MINT: 'So11111111111111111111111111111111111111112',
  BURN_THRESHOLD_LAMPORTS: 100000,
  BURN_RATIO: 0.8,
  TREASURY_RATIO: 0.2,
  NETWORK: 'devnet',
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/utils/redis', () => ({
  getPendingSwapAmount: jest.fn(),
  resetPendingSwap: jest.fn().mockResolvedValue(true),
  incrBurnTotal: jest.fn().mockResolvedValue(true),
  incrTreasuryTotal: jest.fn().mockResolvedValue(true),
  recordTreasuryEvent: jest.fn().mockResolvedValue(true),
  recordBurnProof: jest.fn().mockResolvedValue({ id: 'proof-123' }),
  withLock: jest.fn(),
}));

jest.mock('../../../src/utils/rpc', () => ({
  getConnection: jest.fn().mockReturnValue({
    getParsedTokenAccountsByOwner: jest.fn(),
  }),
  sendTransaction: jest.fn().mockResolvedValue('tx-signature-123'),
  confirmTransaction: jest.fn().mockResolvedValue(true),
  getLatestBlockhash: jest.fn().mockResolvedValue({
    blockhash: 'blockhash-123',
    lastValidBlockHeight: 100000,
  }),
}));

jest.mock('../../../src/services/fee-payer-pool', () => ({
  pool: {
    getHealthyPayer: jest.fn().mockReturnValue({
      publicKey: {
        toBase58: () => 'FeePayer111111111111111111111111111111111111',
        equals: jest.fn(() => true), // Fee payer is treasury
      },
    }),
  },
}));

jest.mock('../../../src/services/treasury-ata', () => ({
  getTreasuryAddress: jest.fn().mockReturnValue({
    toBase58: () => 'Treasury111111111111111111111111111111111111',
    equals: jest.fn(() => true),
  }),
}));

jest.mock('../../../src/services/jupiter', () => ({
  getQuote: jest.fn().mockResolvedValue({ outAmount: '200000000' }), // 200 USDC for 1 SOL
  getSwapTransaction: jest.fn().mockResolvedValue({
    swapTransaction: Buffer.from('mock-transaction').toString('base64'),
  }),
  getTokenToSolQuote: jest.fn().mockResolvedValue({ outAmount: '500000000' }), // 0.5 SOL
  getTokenToAsdfQuote: jest.fn().mockResolvedValue({ outAmount: '800000' }),
  TOKEN_INFO: {
    So11111111111111111111111111111111111111112: { symbol: 'SOL', decimals: 9 },
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
    AsdfMint111111111111111111111111111111111111: { symbol: '$ASDF', decimals: 6 },
  },
}));

jest.mock('../../../src/utils/safe-math', () => ({
  calculateTreasurySplit: jest.fn().mockImplementation((total, ratio) => ({
    burnAmount: Math.floor(total * ratio),
    treasuryAmount: total - Math.floor(total * ratio),
  })),
  validateSolanaAmount: jest.fn().mockReturnValue({ valid: true }),
}));

// Get references to mocked modules
const redis = require('../../../src/utils/redis');
const rpc = require('../../../src/utils/rpc');
const jupiter = require('../../../src/services/jupiter');
const feePayerPool = require('../../../src/services/fee-payer-pool');
const _treasuryAta = require('../../../src/services/treasury-ata');
const safeMath = require('../../../src/utils/safe-math');
const splToken = require('@solana/spl-token');
const logger = require('../../../src/utils/logger');
const _config = require('../../../src/utils/config');

// Require burn service after mocks are set up
const burnService = require('../../../src/services/burn');

// Helper to create mock token account
// Note: For USDC (6 decimals), 1,000,000 units = $1.00
function createMockTokenAccount(mint, balance, decimals = 6) {
  return {
    pubkey: { toBase58: () => `ATA_${mint.slice(0, 8)}` },
    account: {
      data: {
        parsed: {
          info: {
            mint,
            tokenAmount: {
              amount: balance.toString(),
              decimals,
            },
          },
        },
      },
    },
  };
}

// Minimum balance to pass $0.50 threshold for USDC = 500,000 units

describe('Burn Service', () => {
  let mockConnection;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up mock connection
    mockConnection = {
      getParsedTokenAccountsByOwner: jest.fn().mockResolvedValue({ value: [] }),
      getBalance: jest.fn().mockResolvedValue(500_000_000), // 0.5 SOL (above refill threshold)
    };
    rpc.getConnection.mockReturnValue(mockConnection);

    // Default lock behavior
    redis.withLock.mockImplementation(async (name, fn, _ttl) => {
      const result = await fn();
      return { success: true, result };
    });

    // Default fee payer
    feePayerPool.pool.getHealthyPayer.mockReturnValue({
      publicKey: {
        toBase58: () => 'FeePayer111111111111111111111111111111111111',
        equals: jest.fn(() => true),
      },
    });

    // Default jupiter responses
    jupiter.getTokenToAsdfQuote.mockResolvedValue({ outAmount: '800000' });
    jupiter.getTokenToSolQuote.mockResolvedValue({ outAmount: '500000' });
    jupiter.getSwapTransaction.mockResolvedValue({
      swapTransaction: Buffer.from('mock-transaction').toString('base64'),
    });
  });

  describe('getTreasuryTokenBalances()', () => {
    it('should return empty array when no tokens', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({ value: [] });

      const balances = await burnService.getTreasuryTokenBalances();

      expect(balances).toEqual([]);
    });

    it('should return token balances above minimum USD value', async () => {
      // 1,000,000 USDC units = $1.00 (above $0.50 threshold)
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [
          createMockTokenAccount('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1000000),
          createMockTokenAccount('AsdfMint111111111111111111111111111111111111', 5000000),
        ],
      });

      const balances = await burnService.getTreasuryTokenBalances();

      expect(balances).toHaveLength(2);
      // Sorted by value (highest first)
      expect(balances[0].valueUsd).toBeGreaterThan(0);
    });

    it('should filter out tokens below $0.50 value', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [
          createMockTokenAccount('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 100000), // $0.10 - too low
          createMockTokenAccount('AsdfMint111111111111111111111111111111111111', 5000000), // Higher value
        ],
      });

      const balances = await burnService.getTreasuryTokenBalances();

      // Only the ASDF token should pass (has higher value via Jupiter quote)
      expect(balances.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle RPC errors gracefully', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockRejectedValue(new Error('RPC error'));

      const balances = await burnService.getTreasuryTokenBalances();

      expect(balances).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        'BURN',
        'Failed to get treasury token balances',
        expect.any(Object)
      );
    });

    it('should include valueUsd in returned balances', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [createMockTokenAccount('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 2000000)],
      });

      const balances = await burnService.getTreasuryTokenBalances();

      expect(balances[0].valueUsd).toBe(2); // $2.00 for 2M USDC units
    });
  });

  describe('checkAndExecuteBurn()', () => {
    it('should return null when no token balances', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({ value: [] });

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
      expect(redis.withLock).not.toHaveBeenCalled();
    });

    it('should acquire lock when tokens are present', async () => {
      // 1M USDC = $1.00 (above threshold)
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [createMockTokenAccount('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1000000)],
      });

      await burnService.checkAndExecuteBurn();

      expect(redis.withLock).toHaveBeenCalledWith('burn-worker', expect.any(Function), 120);
    });

    it('should return null when lock is already held', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [createMockTokenAccount('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1000000)],
      });
      redis.withLock.mockResolvedValue({ success: false, error: 'LOCK_HELD' });

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith('BURN', 'Burn already in progress, skipping');
    });
  });

  describe('Token Processing - Non-ASDF tokens', () => {
    beforeEach(() => {
      // 10M USDC = $10.00 (well above threshold)
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [createMockTokenAccount('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 10000000)],
      });
    });

    it('should swap 100% to ASDF (unified model for non-ASDF tokens)', async () => {
      const result = await burnService.checkAndExecuteBurn();

      // UNIFIED MODEL: Swap 100% to $ASDF (1 swap instead of 2!)
      expect(jupiter.getTokenToAsdfQuote).toHaveBeenCalledWith(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        10000000, // 100% of balance → $ASDF
        150
      );
      expect(result.processed).toHaveLength(1);
      expect(result.model).toBe('hybrid'); // Hybrid: $ASDF=100% burn, others=unified
    });

    it('should NOT swap to SOL (unified model keeps treasury as $ASDF)', async () => {
      await burnService.checkAndExecuteBurn();

      // UNIFIED MODEL: No separate SOL swap!
      // Treasury is kept as $ASDF and only swapped when fee payer needs refill
      expect(jupiter.getTokenToSolQuote).not.toHaveBeenCalled();
    });

    it('should record treasury retention as $ASDF (unified model)', async () => {
      await burnService.checkAndExecuteBurn();

      // UNIFIED MODEL: Treasury recorded as $ASDF retention, not SOL conversion
      expect(redis.recordTreasuryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'asdf_retained',
          source: 'unified_model_treasury',
        })
      );
    });

    it('should record burn proof with batch method', async () => {
      await burnService.checkAndExecuteBurn();

      // Now uses batched burning - all burns in one tx
      expect(redis.recordBurnProof).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'batch',
          burnCount: expect.any(Number),
          tokens: expect.arrayContaining([
            expect.objectContaining({
              mint: expect.any(String),
              amount: expect.any(Number),
              type: 'asdf',
            }),
          ]),
        })
      );
    });
  });

  describe('Token Processing - $ASDF token', () => {
    beforeEach(() => {
      // 10M ASDF (gets value via Jupiter quote)
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [createMockTokenAccount('AsdfMint111111111111111111111111111111111111', 10000000)],
      });
    });

    it('should burn 100% directly without swap (purist model)', async () => {
      const result = await burnService.checkAndExecuteBurn();

      // Should NOT swap ASDF to ASDF
      expect(jupiter.getTokenToAsdfQuote).not.toHaveBeenCalled();
      // PURIST MODEL: 100% of $ASDF fees are burned!
      expect(result.processed[0].asdfBurned).toBe(10000000);
    });

    it('should NOT retain any $ASDF in treasury (100% burn)', async () => {
      await burnService.checkAndExecuteBurn();

      // PURIST MODEL: 100% burn, no treasury retention for $ASDF
      expect(jupiter.getTokenToSolQuote).not.toHaveBeenCalledWith(
        'AsdfMint111111111111111111111111111111111111',
        expect.any(Number),
        expect.any(Number)
      );

      // NO retention event for $ASDF (100% burned)
      expect(redis.recordTreasuryEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({
          tokenMint: 'AsdfMint111111111111111111111111111111111111',
          type: 'asdf_retained',
        })
      );
    });

    it('should record burn proof with batch method', async () => {
      await burnService.checkAndExecuteBurn();

      // $ASDF burns now use batched method too
      expect(redis.recordBurnProof).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'batch',
          burnCount: expect.any(Number),
          tokens: expect.arrayContaining([
            expect.objectContaining({
              mint: 'AsdfMint111111111111111111111111111111111111',
              type: 'asdf',
            }),
          ]),
        })
      );
    });
  });

  describe('Multiple Token Processing', () => {
    it('should process multiple tokens in one cycle', async () => {
      // Both tokens above $0.50 threshold
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [
          createMockTokenAccount('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 5000000), // $5
          createMockTokenAccount('AsdfMint111111111111111111111111111111111111', 3000000),
        ],
      });

      const result = await burnService.checkAndExecuteBurn();

      expect(result.processed).toHaveLength(2);
      expect(result.totalBurned).toBeGreaterThan(0);
    });

    it('should continue processing even if one token partially fails', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [
          createMockTokenAccount('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 5000000),
          createMockTokenAccount('BadToken11111111111111111111111111111111111', 3000000),
        ],
      });

      // First token succeeds fully, second token's ASDF swap fails but SOL swap succeeds
      jupiter.getTokenToAsdfQuote
        .mockResolvedValueOnce({ outAmount: '4000000' })
        .mockResolvedValueOnce({ success: false }); // Simulates failure

      const result = await burnService.checkAndExecuteBurn();

      // Both tokens are processed (second one has partial success - treasury portion)
      expect(result.processed).toHaveLength(2);
      expect(result.totalBurned).toBeGreaterThan(0);
    });

    it('should process token with zero values when all swaps fail', async () => {
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [createMockTokenAccount('BadToken11111111111111111111111111111111111', 3000000)],
      });

      // Both swaps fail (caught internally, return {success: false})
      jupiter.getTokenToAsdfQuote.mockRejectedValue(new Error('No route'));
      jupiter.getTokenToSolQuote.mockRejectedValue(new Error('No route'));

      const result = await burnService.checkAndExecuteBurn();

      // Token is still "processed" but with 0 values
      expect(result.processed).toHaveLength(1);
      expect(result.processed[0].asdfBurned).toBe(0);
      // Unified model: no more solToTreasury, treasury is kept as $ASDF
    });
  });

  describe('burnAsdf()', () => {
    it('should be exported', () => {
      expect(typeof burnService.burnAsdf).toBe('function');
    });

    it('should send burn transaction', async () => {
      const signature = await burnService.burnAsdf(100000);

      expect(rpc.sendTransaction).toHaveBeenCalled();
      expect(rpc.confirmTransaction).toHaveBeenCalled();
      expect(signature).toBe('tx-signature-123');
    });

    it('should create burn instruction with correct amount', async () => {
      await burnService.burnAsdf(750000);

      expect(splToken.createBurnInstruction).toHaveBeenCalledWith(
        'token-account-address',
        expect.anything(),
        expect.anything(),
        750000
      );
    });
  });

  describe('startBurnWorker()', () => {
    let setTimeoutSpy;
    let setIntervalSpy;

    beforeEach(() => {
      setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(() => 1);
      setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation(() => 2);
    });

    afterEach(() => {
      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
    });

    it('should be exported', () => {
      expect(typeof burnService.startBurnWorker).toBe('function');
    });

    it('should log worker start', () => {
      burnService.startBurnWorker(60000);

      expect(logger.info).toHaveBeenCalledWith('BURN', 'Burn worker started', {
        intervalMs: 60000,
      });
    });

    it('should schedule initial check after 10 seconds', () => {
      burnService.startBurnWorker(60000);

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10000);
    });

    it('should schedule periodic checks', () => {
      burnService.startBurnWorker(30000);

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      // 5M USDC = $5 (above threshold)
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [createMockTokenAccount('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 5000000)],
      });
    });

    it('should handle complete swap failure gracefully', async () => {
      // Both swaps fail (errors caught internally)
      jupiter.getTokenToAsdfQuote.mockRejectedValue(new Error('Jupiter timeout'));
      jupiter.getTokenToSolQuote.mockRejectedValue(new Error('Jupiter timeout'));

      const result = await burnService.checkAndExecuteBurn();

      // Token processed with 0 values (errors handled internally)
      expect(result.processed).toHaveLength(1);
      expect(result.processed[0].asdfBurned).toBe(0);

      // Swap errors are logged
      expect(logger.error).toHaveBeenCalledWith(
        'BURN',
        'Token → ASDF swap failed',
        expect.any(Object)
      );
    });

    it('should handle swap failure in unified model (no partial results)', async () => {
      jupiter.getTokenToAsdfQuote.mockRejectedValue(new Error('No route'));
      // UNIFIED MODEL: Only 1 swap to $ASDF, so if it fails, nothing happens

      const result = await burnService.checkAndExecuteBurn();

      // Token is processed but with 0 values (unified model = 1 swap only)
      expect(result.processed).toHaveLength(1);
      expect(result.processed[0].asdfBurned).toBe(0);
      // No solToTreasury in unified model - treasury is kept as $ASDF
    });

    it('should handle no healthy fee payer', async () => {
      feePayerPool.pool.getHealthyPayer.mockReturnValue(null);

      const result = await burnService.checkAndExecuteBurn();

      expect(result.failed).toHaveLength(1);
    });
  });

  describe('Return Value', () => {
    beforeEach(() => {
      // 10M USDC = $10
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [createMockTokenAccount('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 10000000)],
      });
      safeMath.calculateTreasurySplit.mockReturnValue({
        burnAmount: 8000000,
        treasuryAmount: 2000000,
      });
    });

    it('should return complete burn result (hybrid model)', async () => {
      const result = await burnService.checkAndExecuteBurn();

      expect(result).not.toBeNull();
      expect(result.processed).toHaveLength(1);
      expect(result.totalBurned).toBeGreaterThan(0);
      expect(result.totalAsdfRetained).toBeGreaterThanOrEqual(0); // Unified: treasury in $ASDF
      expect(result.model).toBe('hybrid'); // Hybrid: $ASDF=100% burn, others=unified
    });

    it('should include token details in processed results (hybrid model)', async () => {
      const result = await burnService.checkAndExecuteBurn();

      expect(result.processed[0]).toEqual(
        expect.objectContaining({
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          symbol: 'USDC',
          asdfBurned: expect.any(Number),
          model: 'unified', // Non-ASDF tokens use unified model
          // No more solToTreasury - unified model keeps treasury as $ASDF
        })
      );
    });
  });
});
