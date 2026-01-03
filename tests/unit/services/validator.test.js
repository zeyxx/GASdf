const {
  validateTransactionSize,
  deserializeTransaction,
  validateTransaction,
  verifyUserSignature,
  extractInstructions,
  getTransactionBlockhash,
  detectDurableNonce,
  getReplayProtectionKey,
  computeTransactionHash,
  MAX_TRANSACTION_SIZE,
  MAX_COMPUTE_UNITS,
  SIGNATURE_SIZE,
} = require('../../../src/services/validator');
const {
  Keypair,
  Transaction,
  SystemProgram,
  PublicKey: _PublicKey,
  VersionedTransaction,
  TransactionMessage,
} = require('@solana/web3.js');

// Create mock fee payer for tests
const mockFeePayer = Keypair.generate();

// Mock signer module
jest.mock('../../../src/services/signer', () => ({
  getAllFeePayerPublicKeys: jest.fn(),
  getTransactionFeePayer: jest.fn(),
}));

const signer = require('../../../src/services/signer');

describe('Validator Service', () => {
  beforeAll(() => {
    // Setup mock implementations
    signer.getAllFeePayerPublicKeys.mockReturnValue([mockFeePayer.publicKey]);
    signer.getTransactionFeePayer.mockReturnValue(mockFeePayer);
  });

  describe('Solana Mainnet Constants', () => {
    it('MAX_TRANSACTION_SIZE should be 1232 bytes', () => {
      expect(MAX_TRANSACTION_SIZE).toBe(1232);
    });

    it('MAX_COMPUTE_UNITS should be 1,400,000', () => {
      expect(MAX_COMPUTE_UNITS).toBe(1_400_000);
    });

    it('SIGNATURE_SIZE should be 64 bytes', () => {
      expect(SIGNATURE_SIZE).toBe(64);
    });
  });

  describe('validateTransactionSize()', () => {
    it('should accept transaction within size limit', () => {
      // Create a small valid base64 transaction (100 bytes)
      const smallTx = Buffer.alloc(100).toString('base64');
      const result = validateTransactionSize(smallTx);

      expect(result.valid).toBe(true);
      expect(result.size).toBe(100);
      expect(result.maxSize).toBe(1232);
      expect(result.error).toBeUndefined();
    });

    it('should accept transaction at exact size limit', () => {
      // Create transaction at exactly 1232 bytes
      const exactTx = Buffer.alloc(1232).toString('base64');
      const result = validateTransactionSize(exactTx);

      expect(result.valid).toBe(true);
      expect(result.size).toBe(1232);
    });

    it('should reject transaction exceeding size limit', () => {
      // Create transaction at 1233 bytes (1 byte over limit)
      const largeTx = Buffer.alloc(1233).toString('base64');
      const result = validateTransactionSize(largeTx);

      expect(result.valid).toBe(false);
      expect(result.size).toBe(1233);
      expect(result.maxSize).toBe(1232);
      expect(result.error).toContain('1233 bytes exceeds Solana limit of 1232 bytes');
    });

    it('should reject very large transaction', () => {
      // Create transaction at 2000 bytes
      const veryLargeTx = Buffer.alloc(2000).toString('base64');
      const result = validateTransactionSize(veryLargeTx);

      expect(result.valid).toBe(false);
      expect(result.size).toBe(2000);
      expect(result.error).toContain('2000 bytes exceeds Solana limit');
    });

    it('should handle empty transaction', () => {
      const emptyTx = Buffer.alloc(0).toString('base64');
      const result = validateTransactionSize(emptyTx);

      expect(result.valid).toBe(true);
      expect(result.size).toBe(0);
    });

    it('should correctly decode base64 before measuring size', () => {
      // Base64 encoding increases size by ~33%, so we need to verify
      // we're measuring decoded bytes, not base64 string length
      const data = Buffer.alloc(100);
      const base64 = data.toString('base64');

      // Base64 string is longer than original data
      expect(base64.length).toBeGreaterThan(100);

      const result = validateTransactionSize(base64);
      // But validated size should be original bytes
      expect(result.size).toBe(100);
    });
  });

  describe('deserializeTransaction()', () => {
    it('should deserialize a legacy transaction', () => {
      const user = Keypair.generate();
      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        })
      );

      const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');
      const deserialized = deserializeTransaction(serialized);

      expect(deserialized).toBeDefined();
      // Deserialized transaction should have instructions
      const instructions = extractInstructions(deserialized);
      expect(instructions.length).toBeGreaterThan(0);
    });

    it('should handle versioned transactions', () => {
      const user = Keypair.generate();
      const message = new TransactionMessage({
        payerKey: mockFeePayer.publicKey,
        recentBlockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
        instructions: [
          SystemProgram.transfer({
            fromPubkey: user.publicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: 1000,
          }),
        ],
      }).compileToV0Message();

      const versionedTx = new VersionedTransaction(message);
      const serialized = Buffer.from(versionedTx.serialize()).toString('base64');
      const deserialized = deserializeTransaction(serialized);

      expect(deserialized).toBeDefined();
      expect(deserialized instanceof VersionedTransaction).toBe(true);
    });
  });

  describe('extractInstructions()', () => {
    it('should extract instructions from legacy transaction', () => {
      const user = Keypair.generate();
      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        })
      );

      const instructions = extractInstructions(tx);
      expect(instructions).toHaveLength(1);
      expect(instructions[0].programId.toBase58()).toBe(SystemProgram.programId.toBase58());
    });

    it('should extract instructions from versioned transaction', () => {
      const user = Keypair.generate();
      const message = new TransactionMessage({
        payerKey: mockFeePayer.publicKey,
        recentBlockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
        instructions: [
          SystemProgram.transfer({
            fromPubkey: user.publicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: 1000,
          }),
        ],
      }).compileToV0Message();

      const versionedTx = new VersionedTransaction(message);
      const instructions = extractInstructions(versionedTx);
      expect(instructions).toHaveLength(1);
    });
  });

  describe('getTransactionBlockhash()', () => {
    it('should get blockhash from legacy transaction', () => {
      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      expect(getTransactionBlockhash(tx)).toBe('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N');
    });

    it('should get blockhash from versioned transaction', () => {
      const message = new TransactionMessage({
        payerKey: mockFeePayer.publicKey,
        recentBlockhash: 'DemoBlockhash123456789012345678901234567890123',
        instructions: [],
      }).compileToV0Message();

      const versionedTx = new VersionedTransaction(message);
      expect(getTransactionBlockhash(versionedTx)).toBe(
        'DemoBlockhash123456789012345678901234567890123'
      );
    });
  });

  describe('detectDurableNonce()', () => {
    it('should return false for empty transaction', () => {
      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      const result = detectDurableNonce(tx);
      expect(result.isDurableNonce).toBe(false);
    });

    it('should return false for regular transfer transaction', () => {
      const user = Keypair.generate();
      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        })
      );

      const result = detectDurableNonce(tx);
      expect(result.isDurableNonce).toBe(false);
    });
  });

  describe('getReplayProtectionKey()', () => {
    it('should return blockhash-based key for regular transaction', () => {
      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'TestBlockhash12345678901234567890123456789012';

      const key = getReplayProtectionKey(tx);
      expect(key).toBe('blockhash:TestBlockhash12345678901234567890123456789012');
    });
  });

  describe('computeTransactionHash()', () => {
    it('should compute SHA256 hash of legacy transaction', () => {
      const user = Keypair.generate();
      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        })
      );

      const hash = computeTransactionHash(tx);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should compute SHA256 hash of versioned transaction', () => {
      const message = new TransactionMessage({
        payerKey: mockFeePayer.publicKey,
        recentBlockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
        instructions: [],
      }).compileToV0Message();

      const versionedTx = new VersionedTransaction(message);
      const hash = computeTransactionHash(versionedTx);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different transactions', () => {
      const tx1 = new Transaction();
      tx1.feePayer = mockFeePayer.publicKey;
      tx1.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      const tx2 = new Transaction();
      tx2.feePayer = mockFeePayer.publicKey;
      tx2.recentBlockhash = 'FkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      const hash1 = computeTransactionHash(tx1);
      const hash2 = computeTransactionHash(tx2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce same hash for identical transactions', () => {
      const user = Keypair.generate();
      const dest = Keypair.generate();

      const createTx = () => {
        const tx = new Transaction();
        tx.feePayer = mockFeePayer.publicKey;
        tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
        tx.add(
          SystemProgram.transfer({
            fromPubkey: user.publicKey,
            toPubkey: dest.publicKey,
            lamports: 1000,
          })
        );
        return tx;
      };

      const hash1 = computeTransactionHash(createTx());
      const hash2 = computeTransactionHash(createTx());

      expect(hash1).toBe(hash2);
    });
  });

  describe('validateTransaction()', () => {
    it('should reject transaction with non-GASdf fee payer', () => {
      const unknownFeePayer = Keypair.generate();
      const user = Keypair.generate();

      const tx = new Transaction();
      tx.feePayer = unknownFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        })
      );

      const result = validateTransaction(tx, 5000, user.publicKey.toBase58());
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Transaction fee payer must be a GASdf fee payer');
    });

    it('should reject transaction without user signature', () => {
      const user = Keypair.generate();

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        })
      );

      const result = validateTransaction(tx, 5000, user.publicKey.toBase58());
      expect(result.valid).toBe(false);
      // Should have signature-related error
      expect(result.errors.some((e) => e.includes('signature') || e.includes('signer'))).toBe(true);
    });

    it('should detect unauthorized SOL transfer from fee payer', () => {
      const user = Keypair.generate();

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      // Try to transfer SOL FROM the fee payer TO the user
      tx.add(
        SystemProgram.transfer({
          fromPubkey: mockFeePayer.publicKey,
          toPubkey: user.publicKey,
          lamports: 1000000,
        })
      );
      // Also add a legitimate transfer from user so they're a signer
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 100,
        })
      );
      tx.partialSign(user);

      const result = validateTransaction(tx, 5000, user.publicKey.toBase58());
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Unauthorized') && e.includes('Transfer'))).toBe(
        true
      );
    });
  });

  describe('verifyUserSignature()', () => {
    it('should return error when user not in signers', () => {
      const user = Keypair.generate();
      const otherUser = Keypair.generate();

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      tx.add(
        SystemProgram.transfer({
          fromPubkey: otherUser.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        })
      );

      const result = verifyUserSignature(tx, user.publicKey.toBase58());
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should validate correct signature', () => {
      const user = Keypair.generate();

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        })
      );
      tx.partialSign(user);

      const result = verifyUserSignature(tx, user.publicKey.toBase58());
      expect(result.valid).toBe(true);
    });

    it('should reject empty signature', () => {
      const user = Keypair.generate();

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1000,
        })
      );
      // Don't sign - signatures will be null/empty

      const result = verifyUserSignature(tx, user.publicKey.toBase58());
      expect(result.valid).toBe(false);
    });
  });
});
