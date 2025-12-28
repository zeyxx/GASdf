const { Transaction, VersionedTransaction, PublicKey, SystemProgram } = require('@solana/web3.js');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const { getAllFeePayerPublicKeys, getTransactionFeePayer } = require('./signer');

// System Program instruction discriminators
const SYSTEM_PROGRAM_ID = SystemProgram.programId.toBase58();
const SYSTEM_TRANSFER_DISCRIMINATOR = 2; // Transfer instruction index

// Token Program IDs
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Token Program dangerous instructions (fee payer as authority)
// Using BLOCKLIST approach - these drain tokens or change ownership
const TOKEN_DANGEROUS_INSTRUCTIONS = {
  3: 'Transfer',
  4: 'Approve',           // Grants delegate access
  5: 'Revoke',            // Could be part of exploit chain
  6: 'SetAuthority',      // Changes ownership
  7: 'MintTo',            // Could mint if fee payer is mint authority
  8: 'Burn',              // Burns tokens
  9: 'CloseAccount',      // Closes account, sends SOL to destination
  12: 'TransferChecked',
  13: 'ApproveChecked',
  14: 'MintToChecked',
  15: 'BurnChecked',
};

// System Program dangerous instructions
const SYSTEM_DANGEROUS_INSTRUCTIONS = {
  2: 'Transfer',
  3: 'CreateAccountWithSeed',  // Could create account for draining
  8: 'Allocate',               // Could manipulate account data
  9: 'AllocateWithSeed',
  10: 'AssignWithSeed',
  11: 'TransferWithSeed',
};

// Durable nonce instruction discriminator
const ADVANCE_NONCE_DISCRIMINATOR = 4;

// =========================================================================
// Solana Mainnet Specifications (2025)
// =========================================================================

// Maximum transaction size in bytes (MTU constraint: 1500 - 48 headers - 220 overhead)
// See: https://solana.com/docs/core/transactions
const MAX_TRANSACTION_SIZE = 1232;

// Maximum compute units per transaction (Solana mainnet limit)
const MAX_COMPUTE_UNITS = 1_400_000;

// Signature size in bytes (Ed25519)
const SIGNATURE_SIZE = 64;

function deserializeTransaction(serializedTx) {
  const buffer = Buffer.from(serializedTx, 'base64');

  try {
    return VersionedTransaction.deserialize(buffer);
  } catch {
    return Transaction.from(buffer);
  }
}

/**
 * Validate transaction size against Solana mainnet limit
 * @param {string} serializedTx - Base64 encoded transaction
 * @returns {{ valid: boolean, size: number, maxSize: number, error?: string }}
 */
function validateTransactionSize(serializedTx) {
  const buffer = Buffer.from(serializedTx, 'base64');
  const size = buffer.length;

  if (size > MAX_TRANSACTION_SIZE) {
    return {
      valid: false,
      size,
      maxSize: MAX_TRANSACTION_SIZE,
      error: `Transaction size ${size} bytes exceeds Solana limit of ${MAX_TRANSACTION_SIZE} bytes`,
    };
  }

  return {
    valid: true,
    size,
    maxSize: MAX_TRANSACTION_SIZE,
  };
}

function validateTransaction(transaction, expectedFeeAmount, userPubkey) {
  const errors = [];

  // Get all valid fee payer pubkeys
  const validFeePayerPubkeys = getAllFeePayerPublicKeys();
  const validPubkeySet = new Set(validFeePayerPubkeys.map(p => p.toBase58()));

  // Check 1: Fee payer must be one of our wallets
  let txFeePayer;
  if (transaction instanceof VersionedTransaction) {
    txFeePayer = transaction.message.staticAccountKeys[0];
  } else {
    txFeePayer = transaction.feePayer;
  }

  if (!txFeePayer || !validPubkeySet.has(txFeePayer.toBase58())) {
    errors.push('Transaction fee payer must be a GASdf fee payer');
  }

  // Check 2: User must have signed the transaction (cryptographic verification)
  const signatureVerification = verifyUserSignature(transaction, userPubkey);
  if (!signatureVerification.valid) {
    errors.push(signatureVerification.error);
  }

  // Check 3: Validate no unauthorized SOL transfers from any fee payer
  const drainErrors = validateNoFeePayerDrain(transaction, validPubkeySet);
  errors.push(...drainErrors);

  // Check 4: Validate no unauthorized token transfers from any fee payer
  const tokenErrors = validateNoFeePayerTokenDrain(transaction, validPubkeySet);
  errors.push(...tokenErrors);

  return {
    valid: errors.length === 0,
    errors,
    feePayer: txFeePayer?.toBase58(),
  };
}

/**
 * Ensures no SOL is transferred out of any fee payer account
 * (except for transaction fees which are handled by the network)
 *
 * Checks for all dangerous System Program instructions:
 * - Transfer, TransferWithSeed
 * - CreateAccountWithSeed (could be used to drain)
 * - Allocate/AllocateWithSeed (account manipulation)
 */
function validateNoFeePayerDrain(transaction, feePayerPubkeys) {
  const errors = [];
  const instructions = extractInstructions(transaction);
  const accountKeys = getAccountKeys(transaction);

  for (const ix of instructions) {
    const programId = getProgramId(ix, accountKeys);

    // Check System Program for dangerous instructions
    if (programId === SYSTEM_PROGRAM_ID) {
      const ixData = getInstructionData(ix);
      if (ixData.length >= 4) {
        const discriminator = ixData.readUInt32LE(0);
        const instructionName = SYSTEM_DANGEROUS_INSTRUCTIONS[discriminator];

        if (instructionName) {
          // For transfer-type instructions, check the 'from' account (index 0)
          const fromAccount = getAccountAtIndex(ix, 0, accountKeys);
          if (feePayerPubkeys.has(fromAccount)) {
            errors.push(`Unauthorized System.${instructionName} from fee payer detected`);
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Ensures no tokens are transferred from any fee payer's token accounts
 *
 * Comprehensive check for ALL dangerous Token Program instructions:
 * - Transfer, TransferChecked (drain tokens)
 * - Approve, ApproveChecked (delegate access)
 * - Burn, BurnChecked (destroy tokens)
 * - CloseAccount (close and recover SOL)
 * - SetAuthority (change ownership)
 * - MintTo, MintToChecked (if fee payer is mint authority)
 */
function validateNoFeePayerTokenDrain(transaction, feePayerPubkeys) {
  const errors = [];
  const instructions = extractInstructions(transaction);
  const accountKeys = getAccountKeys(transaction);

  for (const ix of instructions) {
    const programId = getProgramId(ix, accountKeys);

    // Check Token Program and Token-2022
    if (programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID) {
      const ixData = getInstructionData(ix);
      if (ixData.length >= 1) {
        const discriminator = ixData[0];
        const instructionName = TOKEN_DANGEROUS_INSTRUCTIONS[discriminator];

        if (instructionName) {
          // Different instructions have authority at different positions
          let authorityIndex;

          switch (discriminator) {
            case 3:  // Transfer
            case 4:  // Approve
            case 5:  // Revoke
            case 8:  // Burn
              authorityIndex = 2; // source, (dest|delegate), authority
              break;
            case 6:  // SetAuthority
              authorityIndex = 1; // account, currentAuthority
              break;
            case 7:  // MintTo
              authorityIndex = 2; // mint, dest, mintAuthority
              break;
            case 9:  // CloseAccount
              authorityIndex = 2; // account, dest, authority
              break;
            case 12: // TransferChecked
            case 13: // ApproveChecked
            case 15: // BurnChecked
              authorityIndex = 3; // source, mint, dest, authority
              break;
            case 14: // MintToChecked
              authorityIndex = 2; // mint, dest, mintAuthority
              break;
            default:
              authorityIndex = 2; // Default fallback
          }

          const authority = getAccountAtIndex(ix, authorityIndex, accountKeys);
          if (feePayerPubkeys.has(authority)) {
            errors.push(`Unauthorized Token.${instructionName} with fee payer as authority`);
          }

          // Additional check: CloseAccount sends SOL to destination
          if (discriminator === 9) {
            const source = getAccountAtIndex(ix, 0, accountKeys);
            // Block if source is a fee payer account (even if not authority)
            if (feePayerPubkeys.has(source)) {
              errors.push('Unauthorized CloseAccount on fee payer token account');
            }
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Cryptographically verify user signature on transaction
 * Uses Ed25519 verification via tweetnacl
 */
function verifyUserSignature(transaction, userPubkey) {
  try {
    let messageBytes;
    let userIndex;
    let signature;
    let publicKeyBytes;

    if (transaction instanceof VersionedTransaction) {
      // VersionedTransaction
      messageBytes = transaction.message.serialize();
      const signerKeys = transaction.message.staticAccountKeys;
      userIndex = signerKeys.findIndex((key) => key.toBase58() === userPubkey);

      if (userIndex === -1) {
        return { valid: false, error: 'User public key not found in transaction signers' };
      }

      signature = transaction.signatures[userIndex];
      if (!signature || signature.length !== 64) {
        return { valid: false, error: 'Invalid or missing user signature' };
      }

      // Check for empty signature (all zeros)
      if (signature.every((byte) => byte === 0)) {
        return { valid: false, error: 'Transaction must be signed by user' };
      }

      publicKeyBytes = signerKeys[userIndex].toBytes();
    } else {
      // Legacy Transaction
      messageBytes = transaction.serializeMessage();
      const userSig = transaction.signatures.find(
        (sig) => sig.publicKey.toBase58() === userPubkey
      );

      if (!userSig) {
        return { valid: false, error: 'User public key not found in transaction signers' };
      }

      signature = userSig.signature;
      if (!signature || signature.length !== 64) {
        return { valid: false, error: 'Invalid or missing user signature' };
      }

      publicKeyBytes = userSig.publicKey.toBytes();
    }

    // Cryptographic Ed25519 signature verification
    const signatureBytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
    const messageUint8 = messageBytes instanceof Uint8Array ? messageBytes : new Uint8Array(messageBytes);
    const pubkeyUint8 = publicKeyBytes instanceof Uint8Array ? publicKeyBytes : new Uint8Array(publicKeyBytes);

    const isValid = nacl.sign.detached.verify(messageUint8, signatureBytes, pubkeyUint8);

    if (!isValid) {
      return { valid: false, error: 'User signature cryptographic verification failed' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Signature verification error: ${error.message}` };
  }
}

/**
 * Helper: Get account keys array from transaction
 */
function getAccountKeys(transaction) {
  if (transaction instanceof VersionedTransaction) {
    return transaction.message.staticAccountKeys.map((k) => k.toBase58());
  } else {
    return transaction.compileMessage().accountKeys.map((k) => k.toBase58());
  }
}

/**
 * Helper: Get program ID for an instruction
 */
function getProgramId(instruction, accountKeys) {
  if ('programIdIndex' in instruction) {
    // VersionedTransaction compiled instruction
    return accountKeys[instruction.programIdIndex];
  } else {
    // Legacy Transaction instruction
    return instruction.programId.toBase58();
  }
}

/**
 * Helper: Get instruction data as Buffer
 */
function getInstructionData(instruction) {
  if ('data' in instruction) {
    if (Buffer.isBuffer(instruction.data)) {
      return instruction.data;
    }
    // VersionedTransaction uses Uint8Array
    return Buffer.from(instruction.data);
  }
  return Buffer.alloc(0);
}

/**
 * Helper: Get account at specific index in instruction
 */
function getAccountAtIndex(instruction, index, accountKeys) {
  if ('accountKeyIndexes' in instruction) {
    // VersionedTransaction compiled instruction
    const keyIndex = instruction.accountKeyIndexes[index];
    return keyIndex !== undefined ? accountKeys[keyIndex] : null;
  } else {
    // Legacy Transaction instruction
    const key = instruction.keys[index];
    return key ? key.pubkey.toBase58() : null;
  }
}

function extractInstructions(transaction) {
  if (transaction instanceof VersionedTransaction) {
    return transaction.message.compiledInstructions;
  } else {
    return transaction.instructions;
  }
}

/**
 * Extract blockhash from transaction
 */
function getTransactionBlockhash(transaction) {
  if (transaction instanceof VersionedTransaction) {
    return transaction.message.recentBlockhash;
  } else {
    return transaction.recentBlockhash;
  }
}

/**
 * Detect if transaction uses a durable nonce
 * Durable nonce transactions have AdvanceNonce as first instruction
 *
 * Returns: { isDurableNonce: boolean, nonceAccount?: string, nonceAuthority?: string }
 */
function detectDurableNonce(transaction) {
  const instructions = extractInstructions(transaction);
  const accountKeys = getAccountKeys(transaction);

  if (instructions.length === 0) {
    return { isDurableNonce: false };
  }

  const firstIx = instructions[0];
  const programId = getProgramId(firstIx, accountKeys);

  // Check if first instruction is System Program AdvanceNonce
  if (programId !== SYSTEM_PROGRAM_ID) {
    return { isDurableNonce: false };
  }

  const ixData = getInstructionData(firstIx);
  if (ixData.length < 4) {
    return { isDurableNonce: false };
  }

  const discriminator = ixData.readUInt32LE(0);
  if (discriminator !== ADVANCE_NONCE_DISCRIMINATOR) {
    return { isDurableNonce: false };
  }

  // AdvanceNonce accounts: [nonce_account, recent_blockhashes_sysvar, nonce_authority]
  const nonceAccount = getAccountAtIndex(firstIx, 0, accountKeys);
  const nonceAuthority = getAccountAtIndex(firstIx, 2, accountKeys);

  return {
    isDurableNonce: true,
    nonceAccount,
    nonceAuthority,
  };
}

/**
 * Get replay protection key for transaction
 * Uses durable nonce account if present, otherwise blockhash
 */
function getReplayProtectionKey(transaction) {
  const nonceInfo = detectDurableNonce(transaction);

  if (nonceInfo.isDurableNonce) {
    // For durable nonce, use nonce account + nonce value (stored in blockhash field)
    const nonceValue = getTransactionBlockhash(transaction);
    return `nonce:${nonceInfo.nonceAccount}:${nonceValue}`;
  }

  // For regular transactions, use blockhash
  return `blockhash:${getTransactionBlockhash(transaction)}`;
}

/**
 * Compute SHA256 hash of serialized transaction (for anti-replay)
 * Uses the serialized message to ensure consistent hashing
 */
function computeTransactionHash(transaction) {
  let messageBytes;

  if (transaction instanceof VersionedTransaction) {
    messageBytes = transaction.message.serialize();
  } else {
    messageBytes = transaction.serializeMessage();
  }

  return crypto.createHash('sha256').update(messageBytes).digest('hex');
}

module.exports = {
  deserializeTransaction,
  validateTransaction,
  validateTransactionSize,
  verifyUserSignature,
  extractInstructions,
  getTransactionBlockhash,
  detectDurableNonce,
  getReplayProtectionKey,
  computeTransactionHash,
  MAX_COMPUTE_UNITS,
  MAX_TRANSACTION_SIZE,
  SIGNATURE_SIZE,
};
