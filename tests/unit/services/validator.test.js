const {
  validateTransactionSize,
  deserializeTransaction,
  validateTransaction,
  validateFeePayment,
  verifyUserSignature,
  extractInstructions,
  getTransactionBlockhash,
  detectDurableNonce,
  getReplayProtectionKey,
  computeTransactionHash,
  getTreasuryAddress,
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

    it('should validate signature on VersionedTransaction', () => {
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
      versionedTx.sign([user]);

      const result = verifyUserSignature(versionedTx, user.publicKey.toBase58());
      expect(result.valid).toBe(true);
    });

    it('should reject VersionedTransaction with all-zero signature', () => {
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
      // Signatures are all-zero by default (not signed)

      const result = verifyUserSignature(versionedTx, user.publicKey.toBase58());
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be signed');
    });

    it('should reject VersionedTransaction when user not in signers', () => {
      const user = Keypair.generate();
      const otherUser = Keypair.generate();

      const message = new TransactionMessage({
        payerKey: mockFeePayer.publicKey,
        recentBlockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
        instructions: [
          SystemProgram.transfer({
            fromPubkey: otherUser.publicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: 1000,
          }),
        ],
      }).compileToV0Message();

      const versionedTx = new VersionedTransaction(message);

      const result = verifyUserSignature(versionedTx, user.publicKey.toBase58());
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject invalid cryptographic signature', () => {
      const user = Keypair.generate();
      const wrongUser = Keypair.generate();

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

      // Sign correctly first
      tx.partialSign(user);

      // Then corrupt the signature by replacing it with a wrong one
      // Create a fake signature from wrong user for the same message
      const nacl = require('tweetnacl');
      const wrongSignature = nacl.sign.detached(tx.serializeMessage(), wrongUser.secretKey);

      // Replace user's valid signature with wrong user's signature
      const userSig = tx.signatures.find(
        (s) => s.publicKey.toBase58() === user.publicKey.toBase58()
      );
      if (userSig) {
        userSig.signature = Buffer.from(wrongSignature);
      }

      const result = verifyUserSignature(tx, user.publicKey.toBase58());
      expect(result.valid).toBe(false);
      expect(result.error).toContain('verification failed');
    });
  });

  describe('Token Drain Protection', () => {
    it('should detect Token.Transfer with fee payer as authority', () => {
      const user = Keypair.generate();
      const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      // Create a malicious token transfer instruction with fee payer as authority
      // Transfer instruction: discriminator (1 byte) = 3, amount (8 bytes)
      const transferData = Buffer.alloc(9);
      transferData[0] = 3; // Transfer discriminator
      transferData.writeBigUInt64LE(BigInt(1000000), 1);

      tx.add({
        programId: new (require('@solana/web3.js').PublicKey)(TOKEN_PROGRAM_ID),
        keys: [
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // source
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // dest
          { pubkey: mockFeePayer.publicKey, isSigner: true, isWritable: false }, // authority (fee payer!)
        ],
        data: transferData,
      });

      // Add user as signer
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
      expect(
        result.errors.some((e) => e.includes('Token.Transfer') && e.includes('fee payer'))
      ).toBe(true);
    });

    it('should detect Token.Approve with fee payer as authority', () => {
      const user = Keypair.generate();
      const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      // Approve instruction: discriminator (1 byte) = 4, amount (8 bytes)
      const approveData = Buffer.alloc(9);
      approveData[0] = 4; // Approve discriminator
      approveData.writeBigUInt64LE(BigInt(1000000), 1);

      tx.add({
        programId: new (require('@solana/web3.js').PublicKey)(TOKEN_PROGRAM_ID),
        keys: [
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // source
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false }, // delegate
          { pubkey: mockFeePayer.publicKey, isSigner: true, isWritable: false }, // authority (fee payer!)
        ],
        data: approveData,
      });

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
      expect(result.errors.some((e) => e.includes('Token.Approve'))).toBe(true);
    });

    it('should detect Token.CloseAccount with fee payer account', () => {
      const user = Keypair.generate();
      const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      // CloseAccount instruction: discriminator (1 byte) = 9
      const closeData = Buffer.alloc(1);
      closeData[0] = 9;

      tx.add({
        programId: new (require('@solana/web3.js').PublicKey)(TOKEN_PROGRAM_ID),
        keys: [
          { pubkey: mockFeePayer.publicKey, isSigner: false, isWritable: true }, // account (fee payer!)
          { pubkey: user.publicKey, isSigner: false, isWritable: true }, // dest
          { pubkey: user.publicKey, isSigner: true, isWritable: false }, // authority
        ],
        data: closeData,
      });

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
      expect(result.errors.some((e) => e.includes('CloseAccount'))).toBe(true);
    });

    it('should detect Token.SetAuthority with fee payer as authority', () => {
      const user = Keypair.generate();
      const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      // SetAuthority instruction: discriminator (1 byte) = 6, type (1 byte), new authority (32 bytes optional)
      const setAuthData = Buffer.alloc(35);
      setAuthData[0] = 6;
      setAuthData[1] = 0; // AccountOwner type

      tx.add({
        programId: new (require('@solana/web3.js').PublicKey)(TOKEN_PROGRAM_ID),
        keys: [
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // account
          { pubkey: mockFeePayer.publicKey, isSigner: true, isWritable: false }, // current authority (fee payer!)
        ],
        data: setAuthData,
      });

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
      expect(result.errors.some((e) => e.includes('Token.SetAuthority'))).toBe(true);
    });

    it('should allow token transfer when user is authority (not fee payer)', () => {
      const user = Keypair.generate();
      const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      // Token transfer with user as authority (legitimate)
      const transferData = Buffer.alloc(9);
      transferData[0] = 3;
      transferData.writeBigUInt64LE(BigInt(1000), 1);

      tx.add({
        programId: new (require('@solana/web3.js').PublicKey)(TOKEN_PROGRAM_ID),
        keys: [
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
          { pubkey: user.publicKey, isSigner: true, isWritable: false }, // user as authority (OK)
        ],
        data: transferData,
      });
      tx.partialSign(user);

      const result = validateTransaction(tx, 5000, user.publicKey.toBase58());
      // Should not have token-related errors
      expect(result.errors.filter((e) => e.includes('Token.'))).toHaveLength(0);
    });
  });

  describe('System Program Drain Protection', () => {
    it('should detect System.TransferWithSeed from fee payer', () => {
      const user = Keypair.generate();

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      // TransferWithSeed instruction: discriminator (4 bytes) = 11
      const transferData = Buffer.alloc(52);
      transferData.writeUInt32LE(11, 0); // TransferWithSeed

      tx.add({
        programId: SystemProgram.programId,
        keys: [
          { pubkey: mockFeePayer.publicKey, isSigner: true, isWritable: true }, // from (fee payer!)
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false }, // base
          { pubkey: user.publicKey, isSigner: false, isWritable: true }, // to
        ],
        data: transferData,
      });

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
      expect(result.errors.some((e) => e.includes('System.TransferWithSeed'))).toBe(true);
    });

    it('should detect System.CreateAccountWithSeed from fee payer', () => {
      const user = Keypair.generate();

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      // CreateAccountWithSeed: discriminator = 3
      const createData = Buffer.alloc(52);
      createData.writeUInt32LE(3, 0);

      tx.add({
        programId: SystemProgram.programId,
        keys: [
          { pubkey: mockFeePayer.publicKey, isSigner: true, isWritable: true }, // from (fee payer!)
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, // to
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false }, // base
        ],
        data: createData,
      });

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
      expect(result.errors.some((e) => e.includes('System.CreateAccountWithSeed'))).toBe(true);
    });
  });

  describe('validateFeePayment()', () => {
    it('should detect missing fee payment', async () => {
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

      const quote = {
        feeAmount: '5000',
        paymentToken: 'So11111111111111111111111111111111111111112',
      };

      const result = await validateFeePayment(tx, quote, user.publicKey.toBase58());
      expect(result.valid).toBe(false);
      expect(result.error).toContain('No fee payment found');
    });

    it('should detect insufficient fee payment', async () => {
      const user = Keypair.generate();
      const treasury = mockFeePayer.publicKey;

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      // Pay only 1000 lamports when 5000 required
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: treasury,
          lamports: 1000,
        })
      );

      const quote = {
        feeAmount: '5000',
        paymentToken: 'So11111111111111111111111111111111111111112',
      };

      const result = await validateFeePayment(tx, quote, user.publicKey.toBase58());
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient');
      expect(result.actualAmount).toBe(1000);
    });

    it('should accept valid SOL fee payment', async () => {
      const user = Keypair.generate();
      const treasury = mockFeePayer.publicKey;

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: treasury,
          lamports: 5000,
        })
      );

      const quote = {
        feeAmount: '5000',
        paymentToken: 'So11111111111111111111111111111111111111112',
      };

      const result = await validateFeePayment(tx, quote, user.publicKey.toBase58());
      expect(result.valid).toBe(true);
      expect(result.actualAmount).toBe(5000);
    });

    it('should accept payment within 1% tolerance', async () => {
      const user = Keypair.generate();
      const treasury = mockFeePayer.publicKey;

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
      // Pay 99.5% of required amount (within 1% tolerance)
      tx.add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: treasury,
          lamports: 4975,
        })
      );

      const quote = {
        feeAmount: '5000',
        paymentToken: 'So11111111111111111111111111111111111111112',
      };

      const result = await validateFeePayment(tx, quote, user.publicKey.toBase58());
      expect(result.valid).toBe(true);
    });
  });

  describe('getTreasuryAddress()', () => {
    it('should return fee payer address when treasury not configured', () => {
      const address = getTreasuryAddress();
      expect(address).toBe(mockFeePayer.publicKey.toBase58());
    });
  });

  describe('Edge Cases', () => {
    it('should handle transaction with no instructions', () => {
      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      const instructions = extractInstructions(tx);
      expect(instructions).toHaveLength(0);
    });

    it('should handle empty instruction data', () => {
      const user = Keypair.generate();

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      // Add instruction with no data
      tx.add({
        programId: SystemProgram.programId,
        keys: [{ pubkey: user.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.alloc(0),
      });
      tx.partialSign(user);

      // Should not crash
      const result = validateTransaction(tx, 5000, user.publicKey.toBase58());
      expect(result).toBeDefined();
    });

    it('should handle instruction with short data (less than discriminator)', () => {
      const user = Keypair.generate();

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      // Add instruction with only 2 bytes (less than 4-byte discriminator)
      tx.add({
        programId: SystemProgram.programId,
        keys: [{ pubkey: user.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.from([1, 2]),
      });
      tx.partialSign(user);

      // Should not crash
      const result = validateTransaction(tx, 5000, user.publicKey.toBase58());
      expect(result).toBeDefined();
    });

    it('should handle Token-2022 program', () => {
      const user = Keypair.generate();
      const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

      const tx = new Transaction();
      tx.feePayer = mockFeePayer.publicKey;
      tx.recentBlockhash = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

      // Token-2022 Transfer with fee payer as authority
      const transferData = Buffer.alloc(9);
      transferData[0] = 3;
      transferData.writeBigUInt64LE(BigInt(1000000), 1);

      tx.add({
        programId: new (require('@solana/web3.js').PublicKey)(TOKEN_2022_PROGRAM_ID),
        keys: [
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
          { pubkey: mockFeePayer.publicKey, isSigner: true, isWritable: false }, // fee payer!
        ],
        data: transferData,
      });

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
      expect(result.errors.some((e) => e.includes('Token.Transfer'))).toBe(true);
    });
  });
});
