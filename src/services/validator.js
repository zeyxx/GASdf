const { Transaction, VersionedTransaction, PublicKey, SystemProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const { getFeePayer } = require('./fee-payer');
const { MAX_TX_SIZE } = require('../constants');
const config = require('../utils/config');
const logger = require('../utils/logger');

// System Program instruction discriminators
const SYSTEM_PROGRAM_ID = SystemProgram.programId.toBase58();
const SYSTEM_TRANSFER_DISCRIMINATOR = 2; // Transfer instruction index

// Token Program IDs
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// =============================================================================
// SECURITY MODEL: Isolation-Based (Permissionless Compatible)
// =============================================================================
//
// GASdf is permissionless - anyone can integrate via SDK.
// We CANNOT restrict programs (would break integrations).
//
// Instead, security is achieved through ISOLATION:
//
// 1. FEE PAYER HOLDS ONLY SOL
//    - No token accounts = no token drain possible
//    - Only risk is SOL drain, which simulation catches
//
// 2. SIMULATION VALIDATES BALANCE DELTA
//    - Pre-simulation: record fee payer SOL balance
//    - Post-simulation: verify delta = network fee only
//    - ANY unexpected balance change = reject
//
// 3. INSTRUCTION VALIDATION (defense in depth)
//    - Still block obvious attacks (System.Transfer from fee payer)
//    - But don't rely on this alone - simulation is the real guard
//
// This allows ANY program while maintaining security.
// =============================================================================

// Token Program dangerous instructions (fee payer as authority)
// Defense-in-depth: block obvious attacks, but simulation is primary defense
const TOKEN_DANGEROUS_INSTRUCTIONS = {
  3: 'Transfer',
  4: 'Approve', // Grants delegate access
  5: 'Revoke', // Could be part of exploit chain
  6: 'SetAuthority', // Changes ownership
  7: 'MintTo', // Could mint if fee payer is mint authority
  8: 'Burn', // Burns tokens
  9: 'CloseAccount', // Closes account, sends SOL to destination
  12: 'TransferChecked',
  13: 'ApproveChecked',
  14: 'MintToChecked',
  15: 'BurnChecked',
};

// System Program dangerous instructions
const SYSTEM_DANGEROUS_INSTRUCTIONS = {
  2: 'Transfer',
  3: 'CreateAccountWithSeed', // Could create account for draining
  8: 'Allocate', // Could manipulate account data
  9: 'AllocateWithSeed',
  10: 'AssignWithSeed',
  11: 'TransferWithSeed',
};

// Durable nonce instruction discriminator
const ADVANCE_NONCE_DISCRIMINATOR = 4;

// =========================================================================
// Solana Mainnet Specifications (2025)
// =========================================================================

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

  if (size > MAX_TX_SIZE) {
    return {
      valid: false,
      size,
      maxSize: MAX_TX_SIZE,
      error: `Transaction size ${size} bytes exceeds Solana limit of ${MAX_TX_SIZE} bytes`,
    };
  }

  return {
    valid: true,
    size,
    maxSize: MAX_TX_SIZE,
  };
}

/**
 * Validate a submitted transaction against its quote.
 *
 * @param {string} txBase64 - Base64-encoded serialized transaction
 * @param {Object} quoteData - The stored quote object
 * @returns {Promise<{ valid: boolean, errors: string[], feePayer?: string, transaction?: Transaction|VersionedTransaction }>}
 */
async function validateTransaction(txBase64, quoteData) {
  const errors = [];

  // --- Deserialize ----------------------------------------------------------
  let transaction;
  try {
    transaction = deserializeTransaction(txBase64);
  } catch (err) {
    return { valid: false, errors: ['Failed to deserialize transaction: ' + err.message] };
  }

  // --- Size check -----------------------------------------------------------
  const sizeResult = validateTransactionSize(txBase64);
  if (!sizeResult.valid) {
    errors.push(sizeResult.error);
  }

  // --- Fee payer check ------------------------------------------------------
  const kp = getFeePayer();
  const feePayerPubkey = kp.publicKey.toBase58();
  const feePayerSet = new Set([feePayerPubkey]);

  let txFeePayer;
  if (transaction instanceof VersionedTransaction) {
    txFeePayer = transaction.message.staticAccountKeys[0];
  } else {
    txFeePayer = transaction.feePayer;
  }

  if (!txFeePayer || txFeePayer.toBase58() !== feePayerPubkey) {
    errors.push('Transaction fee payer must be the GASdf fee payer');
  }

  // --- User signature verification -----------------------------------------
  const userPubkey = quoteData.userPubkey;
  if (userPubkey) {
    const signatureVerification = verifyUserSignature(transaction, userPubkey);
    if (!signatureVerification.valid) {
      errors.push(signatureVerification.error);
    }
  }

  // --- Payment instruction check --------------------------------------------
  const paymentResult = await validateFeePayment(
    transaction,
    quoteData,
    userPubkey,
    feePayerPubkey
  );
  if (!paymentResult.valid) {
    errors.push(paymentResult.error);
  }

  // --- CPI drain checks (defense in depth) ----------------------------------
  const drainErrors = validateNoFeePayerDrain(transaction, feePayerSet);
  errors.push(...drainErrors);

  const tokenErrors = validateNoFeePayerTokenDrain(transaction, feePayerSet);
  errors.push(...tokenErrors);

  return {
    valid: errors.length === 0,
    errors,
    feePayer: txFeePayer?.toBase58(),
    transaction,
  };
}

/**
 * Ensures no SOL is transferred out of any fee payer account
 * (except for transaction fees which are handled by the network)
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
            case 3: // Transfer
            case 4: // Approve
            case 5: // Revoke
            case 8: // Burn
              authorityIndex = 2; // source, (dest|delegate), authority
              break;
            case 6: // SetAuthority
              authorityIndex = 1; // account, currentAuthority
              break;
            case 7: // MintTo
              authorityIndex = 2; // mint, dest, mintAuthority
              break;
            case 9: // CloseAccount
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
    const signatureBytes =
      signature instanceof Uint8Array ? signature : new Uint8Array(signature);
    const messageUint8 =
      messageBytes instanceof Uint8Array ? messageBytes : new Uint8Array(messageBytes);
    const pubkeyUint8 =
      publicKeyBytes instanceof Uint8Array ? publicKeyBytes : new Uint8Array(publicKeyBytes);

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
 * Validate that transaction contains a fee payment instruction
 *
 * Checks for:
 * - SPL Token Transfer or TransferChecked to treasury ATA
 * - System Program Transfer (for SOL payments) to treasury
 */
async function validateFeePayment(transaction, quote, userPubkey, treasuryAddress) {
  const instructions = extractInstructions(transaction);
  const accountKeys = getAccountKeys(transaction);

  if (!treasuryAddress) {
    treasuryAddress = config.TREASURY_ADDRESS || getFeePayer().publicKey.toBase58();
  }
  if (!treasuryAddress) {
    return { valid: false, error: 'Treasury address not configured' };
  }

  const expectedAmount = parseInt(quote.feeAmount);
  const paymentToken = quote.paymentToken?.mint || quote.paymentToken;
  const isSOL =
    paymentToken === config.WSOL_MINT ||
    paymentToken === 'So11111111111111111111111111111111111111112';

  let foundPayment = false;
  let actualAmount = 0;

  for (const ix of instructions) {
    const programId = getProgramId(ix, accountKeys);
    const ixData = getInstructionData(ix);

    // Check for SOL transfer (System Program)
    if (isSOL && programId === SYSTEM_PROGRAM_ID) {
      if (ixData.length >= 12) {
        const discriminator = ixData.readUInt32LE(0);
        if (discriminator === SYSTEM_TRANSFER_DISCRIMINATOR) {
          const fromAccount = getAccountAtIndex(ix, 0, accountKeys);
          const toAccount = getAccountAtIndex(ix, 1, accountKeys);
          const amount = ixData.readBigUInt64LE(4);

          if (fromAccount === userPubkey && toAccount === treasuryAddress) {
            actualAmount = Number(amount);
            foundPayment = true;
            break;
          }
        }
      }
    }

    // Check for SPL Token Transfer or TransferChecked
    if (programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID) {
      if (ixData.length >= 1) {
        const discriminator = ixData[0];

        // Transfer (3) or TransferChecked (12)
        if (discriminator === 3 || discriminator === 12) {
          const destAccount =
            discriminator === 3
              ? getAccountAtIndex(ix, 1, accountKeys)
              : getAccountAtIndex(ix, 2, accountKeys); // TransferChecked has mint at index 1
          const authority =
            discriminator === 3
              ? getAccountAtIndex(ix, 2, accountKeys)
              : getAccountAtIndex(ix, 3, accountKeys);

          // Verify authority is the user
          if (authority !== userPubkey) continue;

          // Get expected treasury ATA for this token
          let expectedTreasuryAta;
          try {
            expectedTreasuryAta = await getAssociatedTokenAddress(
              new PublicKey(paymentToken),
              new PublicKey(treasuryAddress)
            );
          } catch (e) {
            continue; // Skip if we can't compute ATA
          }

          // Check if destination matches treasury ATA
          if (destAccount === expectedTreasuryAta.toBase58()) {
            // Parse amount based on instruction type
            if (discriminator === 3) {
              // Transfer: amount is u64 at offset 1
              actualAmount = Number(ixData.readBigUInt64LE(1));
            } else {
              // TransferChecked: amount is u64 at offset 1
              actualAmount = Number(ixData.readBigUInt64LE(1));
            }
            foundPayment = true;
            break;
          }
        }
      }
    }
  }

  if (!foundPayment) {
    return {
      valid: false,
      error: `No fee payment found. Expected ${expectedAmount} of ${paymentToken} to treasury`,
    };
  }

  // Allow 1% tolerance for rounding
  const tolerance = Math.max(1, Math.floor(expectedAmount * 0.01));
  if (actualAmount < expectedAmount - tolerance) {
    return {
      valid: false,
      error: `Insufficient fee payment: got ${actualAmount}, expected ${expectedAmount}`,
      actualAmount,
    };
  }

  return { valid: true, actualAmount };
}

/**
 * Get treasury address (from config or primary fee payer)
 */
function getTreasuryAddress() {
  return config.TREASURY_ADDRESS || getFeePayer().publicKey.toBase58();
}

// =============================================================================
// Helper functions
// =============================================================================

function getAccountKeys(transaction) {
  if (transaction instanceof VersionedTransaction) {
    return transaction.message.staticAccountKeys.map((k) => k.toBase58());
  } else {
    return transaction.compileMessage().accountKeys.map((k) => k.toBase58());
  }
}

function getProgramId(instruction, accountKeys) {
  if ('programIdIndex' in instruction) {
    return accountKeys[instruction.programIdIndex];
  } else {
    return instruction.programId.toBase58();
  }
}

function getInstructionData(instruction) {
  if ('data' in instruction) {
    if (Buffer.isBuffer(instruction.data)) {
      return instruction.data;
    }
    return Buffer.from(instruction.data);
  }
  return Buffer.alloc(0);
}

function getAccountAtIndex(instruction, index, accountKeys) {
  if ('accountKeyIndexes' in instruction) {
    const keyIndex = instruction.accountKeyIndexes[index];
    return keyIndex !== undefined ? accountKeys[keyIndex] : null;
  } else {
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

function getTransactionBlockhash(transaction) {
  if (transaction instanceof VersionedTransaction) {
    return transaction.message.recentBlockhash;
  } else {
    return transaction.recentBlockhash;
  }
}

/**
 * Detect if transaction uses a durable nonce
 */
function detectDurableNonce(transaction) {
  const instructions = extractInstructions(transaction);
  const accountKeys = getAccountKeys(transaction);

  if (instructions.length === 0) {
    return { isDurableNonce: false };
  }

  const firstIx = instructions[0];
  const programId = getProgramId(firstIx, accountKeys);

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

  const nonceAccount = getAccountAtIndex(firstIx, 0, accountKeys);
  const nonceAuthority = getAccountAtIndex(firstIx, 2, accountKeys);

  return {
    isDurableNonce: true,
    nonceAccount,
    nonceAuthority,
  };
}

function getReplayProtectionKey(transaction) {
  const nonceInfo = detectDurableNonce(transaction);

  if (nonceInfo.isDurableNonce) {
    const nonceValue = getTransactionBlockhash(transaction);
    return `nonce:${nonceInfo.nonceAccount}:${nonceValue}`;
  }

  return `blockhash:${getTransactionBlockhash(transaction)}`;
}

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
  validateFeePayment,
  verifyUserSignature,
  extractInstructions,
  getTransactionBlockhash,
  detectDurableNonce,
  getReplayProtectionKey,
  computeTransactionHash,
  getTreasuryAddress,
  MAX_COMPUTE_UNITS,
  SIGNATURE_SIZE,
};
