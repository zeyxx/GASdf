/**
 * Tests for Burn Service
 */

// Mock dependencies before requiring the module
jest.mock('@solana/web3.js', () => {
  const mockTransaction = {
    add: jest.fn().mockReturnThis(),
    sign: jest.fn(),
  };
  return {
    PublicKey: jest.fn().mockImplementation((key) => ({
      toBase58: () => key,
      toString: () => key,
    })),
    Transaction: Object.assign(
      jest.fn().mockImplementation(() => mockTransaction),
      { from: jest.fn().mockReturnValue(mockTransaction) }
    ),
  };
});

jest.mock('@solana/spl-token', () => ({
  createBurnInstruction: jest.fn().mockReturnValue({ type: 'burn' }),
  getAssociatedTokenAddress: jest.fn().mockResolvedValue('token-account-address'),
  getAccount: jest.fn().mockResolvedValue({ amount: BigInt(1000000) }),
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
  getConnection: jest.fn().mockReturnValue({}),
  sendTransaction: jest.fn().mockResolvedValue('tx-signature-123'),
  confirmTransaction: jest.fn().mockResolvedValue(true),
  getLatestBlockhash: jest.fn().mockResolvedValue({
    blockhash: 'blockhash-123',
    lastValidBlockHeight: 100000,
  }),
}));

jest.mock('../../../src/services/fee-payer-pool', () => ({
  getHealthyPayer: jest.fn().mockReturnValue({
    publicKey: {
      toBase58: () => 'FeePayer111111111111111111111111111111111111',
    },
  }),
}));

jest.mock('../../../src/services/jupiter', () => ({
  getQuote: jest.fn().mockResolvedValue({ outAmount: 1000000 }),
  getSwapTransaction: jest.fn().mockResolvedValue({
    swapTransaction: Buffer.from('mock-transaction').toString('base64'),
  }),
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
const safeMath = require('../../../src/utils/safe-math');
const splToken = require('@solana/spl-token');
const logger = require('../../../src/utils/logger');

// Require burn service after mocks are set up
const burnService = require('../../../src/services/burn');

describe('Burn Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset default mock implementations
    redis.getPendingSwapAmount.mockResolvedValue(0);
    redis.withLock.mockImplementation(async (name, fn, ttl) => {
      const result = await fn();
      return { success: true, result };
    });
    redis.resetPendingSwap.mockResolvedValue(true);
    redis.incrBurnTotal.mockResolvedValue(true);
    redis.incrTreasuryTotal.mockResolvedValue(true);
    redis.recordTreasuryEvent.mockResolvedValue(true);
    redis.recordBurnProof.mockResolvedValue({ id: 'proof-123' });

    rpc.sendTransaction.mockResolvedValue('tx-signature-123');
    rpc.confirmTransaction.mockResolvedValue(true);
    rpc.getLatestBlockhash.mockResolvedValue({
      blockhash: 'blockhash-123',
      lastValidBlockHeight: 100000,
    });

    jupiter.getQuote.mockResolvedValue({ outAmount: 1000000 });
    jupiter.getSwapTransaction.mockResolvedValue({
      swapTransaction: Buffer.from('mock-transaction').toString('base64'),
    });

    splToken.getAccount.mockResolvedValue({ amount: BigInt(1000000) });

    safeMath.validateSolanaAmount.mockReturnValue({ valid: true });
    safeMath.calculateTreasurySplit.mockImplementation((total, ratio) => ({
      burnAmount: Math.floor(total * ratio),
      treasuryAmount: total - Math.floor(total * ratio),
    }));
  });

  describe('checkAndExecuteBurn()', () => {
    it('should return null when pending amount is below threshold', async () => {
      redis.getPendingSwapAmount.mockResolvedValue(50000); // Below 100000 threshold

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
      expect(redis.withLock).not.toHaveBeenCalled();
    });

    it('should acquire lock when pending amount exceeds threshold', async () => {
      redis.getPendingSwapAmount.mockResolvedValue(200000);

      await burnService.checkAndExecuteBurn();

      expect(redis.withLock).toHaveBeenCalledWith(
        'burn-worker',
        expect.any(Function),
        120
      );
    });

    it('should return null when lock is already held', async () => {
      redis.getPendingSwapAmount.mockResolvedValue(200000);
      redis.withLock.mockResolvedValue({
        success: false,
        error: 'LOCK_HELD',
      });

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        'BURN',
        'Burn already in progress, skipping'
      );
    });

    it('should log error when lock operation fails', async () => {
      redis.getPendingSwapAmount.mockResolvedValue(200000);
      redis.withLock.mockResolvedValue({
        success: false,
        error: 'REDIS_ERROR',
        message: 'Connection failed',
      });

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'BURN',
        'Burn execution failed',
        expect.objectContaining({ error: 'Connection failed' })
      );
    });

    it('should return null if amount drops below threshold after lock', async () => {
      // First call returns high amount, second call (inside lock) returns low
      redis.getPendingSwapAmount
        .mockResolvedValueOnce(200000)
        .mockResolvedValueOnce(50000);

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
    });

    it('should execute full burn cycle when conditions are met', async () => {
      redis.getPendingSwapAmount.mockResolvedValue(200000);
      splToken.getAccount.mockResolvedValue({ amount: BigInt(1500000) });

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeDefined();
      expect(result.model).toBe('80/20');
      expect(redis.incrBurnTotal).toHaveBeenCalled();
      expect(redis.resetPendingSwap).toHaveBeenCalled();
      expect(redis.recordBurnProof).toHaveBeenCalled();
    });
  });

  describe('80/20 Treasury Split', () => {
    beforeEach(() => {
      redis.getPendingSwapAmount.mockResolvedValue(1000000);
      splToken.getAccount.mockResolvedValue({ amount: BigInt(800000) });
    });

    it('should calculate correct treasury split', async () => {
      await burnService.checkAndExecuteBurn();

      expect(safeMath.calculateTreasurySplit).toHaveBeenCalledWith(
        1000000,
        0.8
      );
    });

    it('should allocate treasury portion', async () => {
      safeMath.calculateTreasurySplit.mockReturnValue({
        burnAmount: 800000,
        treasuryAmount: 200000,
      });

      await burnService.checkAndExecuteBurn();

      expect(redis.incrTreasuryTotal).toHaveBeenCalledWith(200000);
      expect(redis.recordTreasuryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'allocation',
          amount: 200000,
          source: 'fee_split',
        })
      );
    });

    it('should reverse treasury allocation on swap failure', async () => {
      safeMath.calculateTreasurySplit.mockReturnValue({
        burnAmount: 800000,
        treasuryAmount: 200000,
      });
      jupiter.getQuote.mockRejectedValue(new Error('Jupiter failed'));

      await burnService.checkAndExecuteBurn();

      // Check that treasury was reversed
      expect(redis.incrTreasuryTotal).toHaveBeenCalledWith(-200000);
      expect(redis.recordTreasuryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'reversal',
          amount: -200000,
          reason: 'swap_failed',
        })
      );
    });

    it('should skip treasury allocation when amount is zero', async () => {
      safeMath.calculateTreasurySplit.mockReturnValue({
        burnAmount: 1000000,
        treasuryAmount: 0,
      });

      await burnService.checkAndExecuteBurn();

      expect(redis.incrTreasuryTotal).not.toHaveBeenCalled();
    });
  });

  describe('Jupiter Swap', () => {
    beforeEach(() => {
      redis.getPendingSwapAmount.mockResolvedValue(200000);
      splToken.getAccount.mockResolvedValue({ amount: BigInt(150000) });
    });

    it('should use Jupiter for swapping', async () => {
      const result = await burnService.checkAndExecuteBurn();

      expect(jupiter.getQuote).toHaveBeenCalled();
      expect(jupiter.getSwapTransaction).toHaveBeenCalled();
      expect(result.method).toBe('jupiter');
    });

    it('should return null when Jupiter swap fails', async () => {
      jupiter.getQuote.mockRejectedValue(new Error('Jupiter down'));

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'BURN',
        'Jupiter swap failed',
        expect.any(Object)
      );
    });

    it('should log swap initiation', async () => {
      await burnService.checkAndExecuteBurn();

      expect(logger.info).toHaveBeenCalledWith(
        'BURN',
        'Swapping SOL to ASDF via Jupiter',
        expect.objectContaining({ solAmount: expect.any(Number) })
      );
    });
  });

  describe('ASDF Burn', () => {
    beforeEach(() => {
      redis.getPendingSwapAmount.mockResolvedValue(200000);
    });

    it('should get ASDF balance before burning', async () => {
      splToken.getAccount.mockResolvedValue({ amount: BigInt(500000) });

      await burnService.checkAndExecuteBurn();

      expect(splToken.getAssociatedTokenAddress).toHaveBeenCalled();
      expect(splToken.getAccount).toHaveBeenCalled();
    });

    it('should return null when no ASDF to burn', async () => {
      splToken.getAccount.mockResolvedValue({ amount: BigInt(0) });

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith('BURN', 'No ASDF to burn after swap');
    });

    it('should return null when getting balance fails', async () => {
      splToken.getAccount.mockRejectedValue(new Error('Account not found'));

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'BURN',
        'Failed to get ASDF balance',
        expect.any(Object)
      );
    });

    it('should create burn instruction with correct amount', async () => {
      splToken.getAccount.mockResolvedValue({ amount: BigInt(750000) });

      await burnService.checkAndExecuteBurn();

      expect(splToken.createBurnInstruction).toHaveBeenCalledWith(
        'token-account-address',
        expect.anything(),
        expect.anything(),
        750000
      );
    });

    it('should record burn proof after successful burn', async () => {
      splToken.getAccount.mockResolvedValue({ amount: BigInt(800000) });

      await burnService.checkAndExecuteBurn();

      expect(redis.recordBurnProof).toHaveBeenCalledWith(
        expect.objectContaining({
          amountBurned: 800000,
          method: 'jupiter',
          network: 'devnet',
        })
      );
    });
  });

  describe('Amount Validation', () => {
    beforeEach(() => {
      redis.getPendingSwapAmount.mockResolvedValue(200000);
    });

    it('should validate total amount before processing', async () => {
      await burnService.checkAndExecuteBurn();

      expect(safeMath.validateSolanaAmount).toHaveBeenCalledWith(
        200000,
        'totalAmount'
      );
    });

    it('should return null for invalid amount', async () => {
      safeMath.validateSolanaAmount.mockReturnValue({
        valid: false,
        error: 'Amount too large',
      });

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'BURN',
        'Invalid total amount',
        expect.objectContaining({ error: 'Amount too large' })
      );
    });

    it('should return null when burn amount is zero after split', async () => {
      safeMath.calculateTreasurySplit.mockReturnValue({
        burnAmount: 0,
        treasuryAmount: 200000,
      });

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'BURN',
        'Burn amount too small after split'
      );
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

    it('should get fee payer for burn', async () => {
      await burnService.burnAsdf(100000);

      expect(feePayerPool.getHealthyPayer).toHaveBeenCalled();
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

      expect(logger.info).toHaveBeenCalledWith(
        'BURN',
        'Burn worker started',
        { intervalMs: 60000 }
      );
    });

    it('should schedule initial check after 10 seconds', () => {
      burnService.startBurnWorker(60000);

      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        10000
      );
    });

    it('should schedule periodic checks', () => {
      burnService.startBurnWorker(30000);

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        30000
      );
    });

    it('should use default interval of 60 seconds', () => {
      burnService.startBurnWorker();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        60000
      );
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      redis.getPendingSwapAmount.mockResolvedValue(200000);
      splToken.getAccount.mockResolvedValue({ amount: BigInt(500000) });
    });

    it('should handle swap errors gracefully', async () => {
      jupiter.getQuote.mockRejectedValue(new Error('Jupiter timeout'));

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'BURN',
        'Jupiter swap failed',
        expect.any(Object)
      );
    });

    it('should reset pending on swap failure to prevent stuck funds', async () => {
      jupiter.getQuote.mockRejectedValue(new Error('Network error'));

      await burnService.checkAndExecuteBurn();

      // resetPendingSwap IS called on swap failure to prevent stuck funds
      expect(redis.resetPendingSwap).toHaveBeenCalled();
    });

    it('should handle burn phase errors gracefully', async () => {
      // Swap succeeds, but burn transaction fails
      rpc.sendTransaction
        .mockResolvedValueOnce('swap-sig-123') // First call: swap succeeds
        .mockRejectedValueOnce(new Error('RPC timeout')); // Second call: burn fails

      const result = await burnService.checkAndExecuteBurn();

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'BURN',
        'Burn failed',
        expect.any(Object)
      );
    });
  });

  describe('Return Value', () => {
    beforeEach(() => {
      // Set up all mocks for a successful burn
      redis.getPendingSwapAmount.mockResolvedValue(1000000);
      redis.withLock.mockImplementation(async (name, fn, ttl) => {
        const result = await fn();
        return { success: true, result };
      });
      splToken.getAccount.mockResolvedValue({ amount: BigInt(800000) });
      safeMath.calculateTreasurySplit.mockReturnValue({
        burnAmount: 800000,
        treasuryAmount: 200000,
      });
      safeMath.validateSolanaAmount.mockReturnValue({ valid: true });
      jupiter.getQuote.mockResolvedValue({ outAmount: 1000000 });
      jupiter.getSwapTransaction.mockResolvedValue({
        swapTransaction: Buffer.from('mock-transaction').toString('base64'),
      });
    });

    it('should return complete burn result', async () => {
      const result = await burnService.checkAndExecuteBurn();

      expect(result).not.toBeNull();
      expect(result.amountBurned).toBe(800000);
      expect(result.treasuryAllocated).toBe(200000);
      expect(result.method).toBe('jupiter');
      expect(result.model).toBe('80/20');
      expect(result.proof).toBeDefined();
      expect(result.swapSignature).toBeDefined();
      expect(result.burnSignature).toBeDefined();
    });
  });
});
