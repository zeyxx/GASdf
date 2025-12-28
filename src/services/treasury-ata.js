/**
 * Treasury ATA Manager
 *
 * Manages Associated Token Accounts for the treasury.
 * Ensures treasury can receive any SPL token as fee payment.
 */

const { PublicKey, Transaction } = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} = require('@solana/spl-token');
const config = require('../utils/config');
const logger = require('../utils/logger');
const rpc = require('../utils/rpc');
const { getFeePayer } = require('./fee-payer-pool');

// Cache of known ATAs (mint -> ata address)
const ataCache = new Map();

// Set of tokens we've already tried to create ATAs for
const pendingCreations = new Set();

/**
 * Get treasury address
 */
function getTreasuryAddress() {
  if (config.TREASURY_ADDRESS) {
    return new PublicKey(config.TREASURY_ADDRESS);
  }
  // Default to primary fee payer
  try {
    const payer = getFeePayer();
    return payer.publicKey;
  } catch (e) {
    return null;
  }
}

/**
 * Check if treasury has an ATA for the given token
 * Returns the ATA address if it exists, null otherwise
 */
async function checkTreasuryAta(tokenMint) {
  const mintStr = tokenMint.toString();

  // Check cache first
  if (ataCache.has(mintStr)) {
    return ataCache.get(mintStr);
  }

  const treasury = getTreasuryAddress();
  if (!treasury) {
    logger.error('TREASURY_ATA', 'Treasury address not configured');
    return null;
  }

  try {
    const mint = new PublicKey(tokenMint);
    const ataAddress = await getAssociatedTokenAddress(mint, treasury);

    // Check if account exists
    const connection = rpc.getConnection();
    const account = await getAccount(connection, ataAddress).catch(() => null);

    if (account) {
      // Cache the result
      ataCache.set(mintStr, ataAddress.toBase58());
      logger.debug('TREASURY_ATA', 'ATA exists', { mint: mintStr.slice(0, 8), ata: ataAddress.toBase58().slice(0, 8) });
      return ataAddress.toBase58();
    }

    return null;
  } catch (error) {
    logger.error('TREASURY_ATA', 'Error checking ATA', { mint: mintStr.slice(0, 8), error: error.message });
    return null;
  }
}

/**
 * Create treasury ATA for the given token
 * Uses fee payer to pay for account creation
 */
async function createTreasuryAta(tokenMint, tokenProgram = TOKEN_PROGRAM_ID) {
  const mintStr = tokenMint.toString();

  // Prevent concurrent creation attempts
  if (pendingCreations.has(mintStr)) {
    logger.debug('TREASURY_ATA', 'Creation already pending', { mint: mintStr.slice(0, 8) });
    // Wait a bit and check again
    await new Promise(r => setTimeout(r, 2000));
    return checkTreasuryAta(tokenMint);
  }

  pendingCreations.add(mintStr);

  try {
    const treasury = getTreasuryAddress();
    if (!treasury) {
      throw new Error('Treasury address not configured');
    }

    const mint = new PublicKey(tokenMint);
    const ataAddress = await getAssociatedTokenAddress(mint, treasury, false, tokenProgram);

    // Double-check it doesn't exist
    const connection = rpc.getConnection();
    const existingAccount = await getAccount(connection, ataAddress).catch(() => null);
    if (existingAccount) {
      ataCache.set(mintStr, ataAddress.toBase58());
      return ataAddress.toBase58();
    }

    logger.info('TREASURY_ATA', 'Creating ATA', { mint: mintStr.slice(0, 8), treasury: treasury.toBase58().slice(0, 8) });

    // Get fee payer for creation
    const feePayer = getFeePayer();

    // Build creation transaction
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();

    const transaction = new Transaction({
      feePayer: feePayer.publicKey,
      recentBlockhash: blockhash,
    });

    transaction.add(
      createAssociatedTokenAccountInstruction(
        feePayer.publicKey,  // payer
        ataAddress,          // ata
        treasury,            // owner
        mint,                // mint
        tokenProgram         // token program
      )
    );

    // Sign and send
    transaction.sign(feePayer);
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    // Cache the result
    ataCache.set(mintStr, ataAddress.toBase58());

    logger.info('TREASURY_ATA', 'ATA created', {
      mint: mintStr.slice(0, 8),
      ata: ataAddress.toBase58().slice(0, 8),
      signature: signature.slice(0, 16),
    });

    return ataAddress.toBase58();
  } catch (error) {
    logger.error('TREASURY_ATA', 'Failed to create ATA', { mint: mintStr.slice(0, 8), error: error.message });
    throw error;
  } finally {
    pendingCreations.delete(mintStr);
  }
}

/**
 * Detect token program (SPL Token or Token2022)
 */
async function detectTokenProgram(tokenMint) {
  try {
    const connection = rpc.getConnection();
    const mintPubkey = new PublicKey(tokenMint);
    const accountInfo = await connection.getAccountInfo(mintPubkey);

    if (!accountInfo) {
      return TOKEN_PROGRAM_ID; // Default to SPL Token
    }

    // Check if it's Token2022
    if (accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      return TOKEN_2022_PROGRAM_ID;
    }

    return TOKEN_PROGRAM_ID;
  } catch (error) {
    logger.debug('TREASURY_ATA', 'Error detecting token program, defaulting to SPL Token', {
      mint: tokenMint.slice(0, 8),
      error: error.message,
    });
    return TOKEN_PROGRAM_ID;
  }
}

/**
 * Ensure treasury has an ATA for the given token
 * Creates one if it doesn't exist
 * Automatically detects Token2022 tokens
 */
async function ensureTreasuryAta(tokenMint, tokenProgram = null) {
  // Skip for native SOL
  if (tokenMint === config.WSOL_MINT || tokenMint === 'So11111111111111111111111111111111111111112') {
    return null; // Native SOL doesn't need ATA
  }

  // Auto-detect token program if not specified
  if (!tokenProgram) {
    tokenProgram = await detectTokenProgram(tokenMint);
  }

  let ata = await checkTreasuryAta(tokenMint);

  if (!ata) {
    ata = await createTreasuryAta(tokenMint, tokenProgram);
  }

  return ata;
}

/**
 * Get treasury ATA info for quote response
 */
async function getTreasuryAtaInfo(tokenMint) {
  const treasury = getTreasuryAddress();
  if (!treasury) {
    return { exists: false, error: 'Treasury not configured' };
  }

  // Native SOL doesn't need ATA
  if (tokenMint === config.WSOL_MINT || tokenMint === 'So11111111111111111111111111111111111111112') {
    return {
      exists: true,
      address: treasury.toBase58(),
      isNative: true,
    };
  }

  const ata = await checkTreasuryAta(tokenMint);

  if (ata) {
    return {
      exists: true,
      address: ata,
      isNative: false,
    };
  }

  // ATA doesn't exist - compute expected address
  try {
    const mint = new PublicKey(tokenMint);
    const expectedAta = await getAssociatedTokenAddress(mint, treasury);
    return {
      exists: false,
      address: expectedAta.toBase58(),
      isNative: false,
      needsCreation: true,
    };
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

/**
 * Clear ATA cache (for testing)
 */
function clearCache() {
  ataCache.clear();
}

module.exports = {
  getTreasuryAddress,
  checkTreasuryAta,
  createTreasuryAta,
  ensureTreasuryAta,
  getTreasuryAtaInfo,
  detectTokenProgram,
  clearCache,
};
