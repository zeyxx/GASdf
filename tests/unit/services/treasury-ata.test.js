/**
 * Tests for Treasury ATA Manager
 */

// Mock PublicKey before other imports
const mockPublicKey = jest.fn().mockImplementation((key) => ({
  toBase58: () => key,
  toString: () => key,
  toBuffer: () => Buffer.from(key || ''),
  equals: jest.fn((other) => key === other?.toBase58?.()),
}));
mockPublicKey.findProgramAddressSync = jest.fn().mockReturnValue([{ toBase58: () => 'PDA' }, 255]);

const mockTransaction = {
  add: jest.fn().mockReturnThis(),
  sign: jest.fn(),
  serialize: jest.fn().mockReturnValue(Buffer.from('serialized-tx')),
};

jest.mock('@solana/web3.js', () => ({
  PublicKey: mockPublicKey,
  Transaction: jest.fn().mockImplementation(() => mockTransaction),
}));

// Mock token program IDs
const TOKEN_PROGRAM_ID = { toBase58: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' };
const TOKEN_2022_PROGRAM_ID = { toBase58: () => 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' };

jest.mock('@solana/spl-token', () => ({
  getAssociatedTokenAddress: jest.fn(),
  createAssociatedTokenAccountInstruction: jest.fn().mockReturnValue({ type: 'createAta' }),
  getAccount: jest.fn(),
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
}));

jest.mock('../../../src/utils/config', () => ({
  TREASURY_ADDRESS: null,
  WSOL_MINT: 'So11111111111111111111111111111111111111112',
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/utils/rpc', () => ({
  getConnection: jest.fn(),
  getLatestBlockhash: jest.fn(),
}));

jest.mock('../../../src/services/fee-payer-pool', () => ({
  getFeePayer: jest.fn(),
}));

// Get references to mocks
const { getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const config = require('../../../src/utils/config');
const logger = require('../../../src/utils/logger');
const rpc = require('../../../src/utils/rpc');
const { getFeePayer } = require('../../../src/services/fee-payer-pool');

// Import module under test
const treasuryAta = require('../../../src/services/treasury-ata');

describe('Treasury ATA Manager', () => {
  let mockConnection;

  beforeEach(() => {
    jest.clearAllMocks();
    treasuryAta.clearCache();

    // Setup default mocks
    mockConnection = {
      getAccountInfo: jest.fn(),
      sendRawTransaction: jest.fn().mockResolvedValue('tx-signature-123'),
      confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
    };
    rpc.getConnection.mockReturnValue(mockConnection);
    rpc.getLatestBlockhash.mockResolvedValue({
      blockhash: 'blockhash-123',
      lastValidBlockHeight: 100000,
    });

    getFeePayer.mockReturnValue({
      publicKey: { toBase58: () => 'FeePayer111111111111111111111111111111111111' },
    });

    getAssociatedTokenAddress.mockResolvedValue({
      toBase58: () => 'AtaAddress111111111111111111111111111111111111',
    });
  });

  describe('getTreasuryAddress()', () => {
    it('should return configured treasury address', () => {
      config.TREASURY_ADDRESS = 'Treasury111111111111111111111111111111111111';

      const result = treasuryAta.getTreasuryAddress();

      expect(result.toBase58()).toBe('Treasury111111111111111111111111111111111111');
    });

    it('should fallback to fee payer when treasury not configured', () => {
      config.TREASURY_ADDRESS = null;

      const result = treasuryAta.getTreasuryAddress();

      expect(getFeePayer).toHaveBeenCalled();
      expect(result.toBase58()).toBe('FeePayer111111111111111111111111111111111111');
    });

    it('should return null when no treasury and fee payer throws', () => {
      config.TREASURY_ADDRESS = null;
      getFeePayer.mockImplementation(() => {
        throw new Error('No fee payer');
      });

      const result = treasuryAta.getTreasuryAddress();

      expect(result).toBeNull();
    });
  });

  describe('checkTreasuryAta()', () => {
    beforeEach(() => {
      config.TREASURY_ADDRESS = 'Treasury111111111111111111111111111111111111';
    });

    it('should return cached ATA if available', async () => {
      // First call - populate cache
      getAccount.mockResolvedValueOnce({ amount: BigInt(1000) });
      await treasuryAta.checkTreasuryAta('TokenMint123');

      // Second call - should use cache
      getAccount.mockClear();
      const result = await treasuryAta.checkTreasuryAta('TokenMint123');

      expect(result).toBe('AtaAddress111111111111111111111111111111111111');
      expect(getAccount).not.toHaveBeenCalled();
    });

    it('should check on-chain if not cached', async () => {
      getAccount.mockResolvedValue({ amount: BigInt(1000) });

      const result = await treasuryAta.checkTreasuryAta('NewTokenMint');

      expect(getAssociatedTokenAddress).toHaveBeenCalled();
      expect(getAccount).toHaveBeenCalled();
      expect(result).toBe('AtaAddress111111111111111111111111111111111111');
    });

    it('should return null if ATA does not exist', async () => {
      getAccount.mockRejectedValue(new Error('Account not found'));

      const result = await treasuryAta.checkTreasuryAta('NoAtaToken');

      expect(result).toBeNull();
    });

    it('should return null if treasury not configured', async () => {
      config.TREASURY_ADDRESS = null;
      getFeePayer.mockImplementation(() => {
        throw new Error('No payer');
      });

      const result = await treasuryAta.checkTreasuryAta('SomeToken');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'TREASURY_ATA',
        'Treasury address not configured'
      );
    });

    it('should log debug when ATA exists', async () => {
      getAccount.mockResolvedValue({ amount: BigInt(1000) });

      await treasuryAta.checkTreasuryAta('TokenMint123');

      expect(logger.debug).toHaveBeenCalledWith(
        'TREASURY_ATA',
        'ATA exists',
        expect.any(Object)
      );
    });

    it('should log error on exception', async () => {
      getAssociatedTokenAddress.mockRejectedValue(new Error('RPC error'));

      const result = await treasuryAta.checkTreasuryAta('BadToken');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'TREASURY_ATA',
        'Error checking ATA',
        expect.any(Object)
      );
    });
  });

  describe('createTreasuryAta()', () => {
    beforeEach(() => {
      config.TREASURY_ADDRESS = 'Treasury111111111111111111111111111111111111';
      getAccount.mockRejectedValue(new Error('Account not found'));
    });

    it('should create ATA and cache result', async () => {
      const result = await treasuryAta.createTreasuryAta('NewToken123');

      expect(createAssociatedTokenAccountInstruction).toHaveBeenCalled();
      expect(mockConnection.sendRawTransaction).toHaveBeenCalled();
      expect(mockConnection.confirmTransaction).toHaveBeenCalled();
      expect(result).toBe('AtaAddress111111111111111111111111111111111111');
    });

    it('should return existing ATA if already exists', async () => {
      getAccount.mockResolvedValue({ amount: BigInt(0) });

      const result = await treasuryAta.createTreasuryAta('ExistingToken');

      expect(mockConnection.sendRawTransaction).not.toHaveBeenCalled();
      expect(result).toBe('AtaAddress111111111111111111111111111111111111');
    });

    it('should throw error if treasury not configured', async () => {
      config.TREASURY_ADDRESS = null;
      getFeePayer.mockImplementation(() => {
        throw new Error('No payer');
      });

      await expect(treasuryAta.createTreasuryAta('SomeToken'))
        .rejects.toThrow('Treasury address not configured');
    });

    it('should log creation info', async () => {
      await treasuryAta.createTreasuryAta('LogToken');

      expect(logger.info).toHaveBeenCalledWith(
        'TREASURY_ATA',
        'Creating ATA',
        expect.any(Object)
      );
      expect(logger.info).toHaveBeenCalledWith(
        'TREASURY_ATA',
        'ATA created',
        expect.any(Object)
      );
    });

    it('should handle transaction failure', async () => {
      mockConnection.sendRawTransaction.mockRejectedValue(new Error('TX failed'));

      await expect(treasuryAta.createTreasuryAta('FailToken'))
        .rejects.toThrow('TX failed');

      expect(logger.error).toHaveBeenCalledWith(
        'TREASURY_ATA',
        'Failed to create ATA',
        expect.any(Object)
      );
    });

    it('should use provided token program', async () => {
      await treasuryAta.createTreasuryAta('Token2022Mint', TOKEN_2022_PROGRAM_ID);

      expect(getAssociatedTokenAddress).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        false,
        TOKEN_2022_PROGRAM_ID
      );
    });

    it('should prevent concurrent creation attempts', async () => {
      // Slow down the first creation
      mockConnection.sendRawTransaction.mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 100));
        return 'tx-sig';
      });

      // Start first creation (don't await)
      const first = treasuryAta.createTreasuryAta('ConcurrentToken');

      // Second attempt should wait and check
      getAccount.mockResolvedValueOnce({ amount: BigInt(0) });
      const second = treasuryAta.createTreasuryAta('ConcurrentToken');

      const [result1, result2] = await Promise.all([first, second]);

      // Both should return the ATA address
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe('detectTokenProgram()', () => {
    it('should return TOKEN_PROGRAM_ID for SPL tokens', async () => {
      mockConnection.getAccountInfo.mockResolvedValue({
        owner: { equals: () => false },
      });

      const result = await treasuryAta.detectTokenProgram('SplTokenMint');

      expect(result).toBe(TOKEN_PROGRAM_ID);
    });

    it('should return TOKEN_2022_PROGRAM_ID for Token2022 tokens', async () => {
      mockConnection.getAccountInfo.mockResolvedValue({
        owner: { equals: (id) => id === TOKEN_2022_PROGRAM_ID },
      });

      const result = await treasuryAta.detectTokenProgram('Token2022Mint');

      expect(result).toBe(TOKEN_2022_PROGRAM_ID);
    });

    it('should default to TOKEN_PROGRAM_ID if account not found', async () => {
      mockConnection.getAccountInfo.mockResolvedValue(null);

      const result = await treasuryAta.detectTokenProgram('UnknownMint');

      expect(result).toBe(TOKEN_PROGRAM_ID);
    });

    it('should default to TOKEN_PROGRAM_ID on error', async () => {
      mockConnection.getAccountInfo.mockRejectedValue(new Error('RPC error'));

      const result = await treasuryAta.detectTokenProgram('ErrorMint');

      expect(result).toBe(TOKEN_PROGRAM_ID);
      expect(logger.debug).toHaveBeenCalledWith(
        'TREASURY_ATA',
        'Error detecting token program, defaulting to SPL Token',
        expect.any(Object)
      );
    });
  });

  describe('ensureTreasuryAta()', () => {
    beforeEach(() => {
      config.TREASURY_ADDRESS = 'Treasury111111111111111111111111111111111111';
    });

    it('should return null for native SOL (WSOL_MINT)', async () => {
      const result = await treasuryAta.ensureTreasuryAta(config.WSOL_MINT);

      expect(result).toBeNull();
      expect(getAssociatedTokenAddress).not.toHaveBeenCalled();
    });

    it('should return null for native SOL address', async () => {
      const result = await treasuryAta.ensureTreasuryAta('So11111111111111111111111111111111111111112');

      expect(result).toBeNull();
    });

    it('should return existing ATA if found', async () => {
      getAccount.mockResolvedValue({ amount: BigInt(1000) });

      const result = await treasuryAta.ensureTreasuryAta('ExistingToken');

      expect(result).toBe('AtaAddress111111111111111111111111111111111111');
      expect(mockConnection.sendRawTransaction).not.toHaveBeenCalled();
    });

    it('should create ATA if not found', async () => {
      getAccount.mockRejectedValue(new Error('Not found'));

      const result = await treasuryAta.ensureTreasuryAta('NewToken');

      expect(result).toBe('AtaAddress111111111111111111111111111111111111');
      expect(mockConnection.sendRawTransaction).toHaveBeenCalled();
    });

    it('should auto-detect token program when not specified', async () => {
      getAccount.mockResolvedValue({ amount: BigInt(0) });
      mockConnection.getAccountInfo.mockResolvedValue({
        owner: { equals: () => false },
      });

      await treasuryAta.ensureTreasuryAta('AutoDetectToken');

      expect(mockConnection.getAccountInfo).toHaveBeenCalled();
    });

    it('should use provided token program', async () => {
      getAccount.mockResolvedValue({ amount: BigInt(0) });

      await treasuryAta.ensureTreasuryAta('Token2022', TOKEN_2022_PROGRAM_ID);

      expect(mockConnection.getAccountInfo).not.toHaveBeenCalled();
    });
  });

  describe('getTreasuryAtaInfo()', () => {
    beforeEach(() => {
      config.TREASURY_ADDRESS = 'Treasury111111111111111111111111111111111111';
    });

    it('should return error if treasury not configured', async () => {
      config.TREASURY_ADDRESS = null;
      getFeePayer.mockImplementation(() => {
        throw new Error('No payer');
      });

      const result = await treasuryAta.getTreasuryAtaInfo('SomeToken');

      expect(result).toEqual({
        exists: false,
        error: 'Treasury not configured',
      });
    });

    it('should return native info for WSOL', async () => {
      const result = await treasuryAta.getTreasuryAtaInfo(config.WSOL_MINT);

      expect(result).toEqual({
        exists: true,
        address: 'Treasury111111111111111111111111111111111111',
        isNative: true,
      });
    });

    it('should return native info for SOL address', async () => {
      const result = await treasuryAta.getTreasuryAtaInfo('So11111111111111111111111111111111111111112');

      expect(result.isNative).toBe(true);
    });

    it('should return existing ATA info', async () => {
      getAccount.mockResolvedValue({ amount: BigInt(1000) });

      const result = await treasuryAta.getTreasuryAtaInfo('ExistingToken');

      expect(result).toEqual({
        exists: true,
        address: 'AtaAddress111111111111111111111111111111111111',
        isNative: false,
      });
    });

    it('should return needsCreation for non-existing ATA', async () => {
      getAccount.mockRejectedValue(new Error('Not found'));

      const result = await treasuryAta.getTreasuryAtaInfo('NewToken');

      expect(result).toEqual({
        exists: false,
        address: 'AtaAddress111111111111111111111111111111111111',
        isNative: false,
        needsCreation: true,
      });
    });

    it('should handle error computing expected address', async () => {
      getAccount.mockRejectedValue(new Error('Not found'));
      getAssociatedTokenAddress.mockRejectedValue(new Error('Invalid mint'));

      const result = await treasuryAta.getTreasuryAtaInfo('InvalidMint');

      expect(result).toEqual({
        exists: false,
        error: 'Invalid mint',
      });
    });
  });

  describe('clearCache()', () => {
    it('should clear the ATA cache', async () => {
      config.TREASURY_ADDRESS = 'Treasury111111111111111111111111111111111111';
      getAccount.mockResolvedValue({ amount: BigInt(1000) });

      // Populate cache
      await treasuryAta.checkTreasuryAta('CachedToken');

      // Clear cache
      treasuryAta.clearCache();

      // Should check on-chain again
      getAccount.mockClear();
      await treasuryAta.checkTreasuryAta('CachedToken');

      expect(getAccount).toHaveBeenCalled();
    });
  });
});
