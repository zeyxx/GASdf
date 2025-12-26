const { Transaction, VersionedTransaction, PublicKey, SystemProgram } = require('@solana/web3.js');
const { getAllFeePayerPublicKeys, getTransactionFeePayer } = require('./signer');

// System Program instruction discriminators
const SYSTEM_PROGRAM_ID = SystemProgram.programId.toBase58();
const SYSTEM_TRANSFER_DISCRIMINATOR = 2; // Transfer instruction index

// Token Program IDs
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Max compute units we'll pay for
const MAX_COMPUTE_UNITS = 400000;

function deserializeTransaction(serializedTx) {
  const buffer = Buffer.from(serializedTx, 'base64');

  try {
    return VersionedTransaction.deserialize(buffer);
  } catch {
    return Transaction.from(buffer);
  }
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

  // Check 2: User must have signed the transaction (verify actual signature, not just presence)
  if (transaction instanceof VersionedTransaction) {
    const signerKeys = transaction.message.staticAccountKeys;
    const userIndex = signerKeys.findIndex(
      (key) => key.toBase58() === userPubkey
    );
    if (userIndex === -1) {
      errors.push('User public key not found in transaction');
    } else {
      const signature = transaction.signatures[userIndex];
      if (!signature || signature.every((byte) => byte === 0)) {
        errors.push('Transaction must be signed by user');
      }
    }
  } else {
    const userSig = transaction.signatures.find(
      (sig) => sig.publicKey.toBase58() === userPubkey
    );
    if (!userSig || !userSig.signature) {
      errors.push('Transaction must be signed by user');
    }
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
 */
function validateNoFeePayerDrain(transaction, feePayerPubkeys) {
  const errors = [];
  const instructions = extractInstructions(transaction);
  const accountKeys = getAccountKeys(transaction);

  for (const ix of instructions) {
    const programId = getProgramId(ix, accountKeys);

    // Check System Program transfers
    if (programId === SYSTEM_PROGRAM_ID) {
      const ixData = getInstructionData(ix);
      // System transfer instruction has discriminator 2 as first 4 bytes (little-endian u32)
      if (ixData.length >= 4) {
        const discriminator = ixData.readUInt32LE(0);
        if (discriminator === SYSTEM_TRANSFER_DISCRIMINATOR) {
          // Transfer: accounts[0] = from, accounts[1] = to
          const fromAccount = getAccountAtIndex(ix, 0, accountKeys);
          if (feePayerPubkeys.has(fromAccount)) {
            errors.push('Unauthorized SOL transfer from fee payer detected');
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

    // Check Token Program and Token-2022 transfers
    if (programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID) {
      const ixData = getInstructionData(ix);
      if (ixData.length >= 1) {
        const discriminator = ixData[0];
        // Transfer = 3, TransferChecked = 12
        if (discriminator === 3 || discriminator === 12) {
          // Token transfer: accounts[2] = authority (owner/delegate)
          const authority = getAccountAtIndex(ix, 2, accountKeys);
          if (feePayerPubkeys.has(authority)) {
            errors.push('Unauthorized token transfer with fee payer as authority');
          }
        }
      }
    }
  }

  return errors;
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

module.exports = {
  deserializeTransaction,
  validateTransaction,
  extractInstructions,
  MAX_COMPUTE_UNITS,
};
