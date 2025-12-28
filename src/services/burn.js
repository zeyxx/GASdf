const {
  PublicKey,
  Transaction,
} = require('@solana/web3.js');
const {
  createBurnInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const rpc = require('../utils/rpc');
const { getHealthyPayer } = require('./fee-payer-pool');
const { getTreasuryAddress } = require('./treasury-ata');
const jupiter = require('./jupiter');
const { calculateTreasurySplit, validateSolanaAmount } = require('../utils/safe-math');

// Lazy-load ASDF mint to avoid startup errors in dev
let _asdfMint = null;
function getAsdfMint() {
  if (!_asdfMint) {
    if (!config.ASDF_MINT) {
      throw new Error('ASDF_MINT not configured');
    }
    _asdfMint = new PublicKey(config.ASDF_MINT);
  }
  return _asdfMint;
}

// Burn lock name for distributed locking
const BURN_LOCK_NAME = 'burn-worker';
const BURN_LOCK_TTL = 120; // 2 minutes max for burn operation

// =============================================================================
// ECONOMIC EFFICIENCY: Minimum USD value to process
// =============================================================================
// Swap costs: ~0.1-0.3% Jupiter fee + slippage
// TX costs: ~0.000005 SOL (~$0.001) per transaction
// We do 2-3 swaps per token, so ~$0.003-0.005 in TX fees
// To be efficient, we want fees to be <5% of value
// Minimum: $0.50 ensures fees are ~1% of value (efficient)
const MIN_VALUE_USD = 0.50;

// SOL price cache (refreshed each burn cycle)
let cachedSolPrice = null;
let solPriceTimestamp = 0;
const SOL_PRICE_TTL = 60000; // 1 minute

/**
 * Get current SOL price in USD via Jupiter
 */
async function getSolPriceUsd() {
  // Use cache if fresh
  if (cachedSolPrice && Date.now() - solPriceTimestamp < SOL_PRICE_TTL) {
    return cachedSolPrice;
  }

  try {
    // Get quote: 1 SOL → USDC
    const quote = await jupiter.getQuote(
      config.WSOL_MINT,
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      1_000_000_000, // 1 SOL in lamports
      50
    );

    // outAmount is in USDC (6 decimals)
    const solPrice = parseInt(quote.outAmount) / 1_000_000;
    cachedSolPrice = solPrice;
    solPriceTimestamp = Date.now();

    logger.debug('BURN', 'SOL price fetched', { solPrice });
    return solPrice;
  } catch (error) {
    logger.warn('BURN', 'Failed to get SOL price, using fallback', { error: error.message });
    return cachedSolPrice || 200; // Fallback to ~$200
  }
}

/**
 * Get USD value of a token amount
 */
async function getTokenValueUsd(mint, amount, decimals) {
  if (amount <= 0) return 0;

  try {
    // For USDC/USDT, value is direct (1:1 with USD)
    if (mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' || // USDC
        mint === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB') {  // USDT
      return amount / Math.pow(10, decimals);
    }

    // For SOL, use cached price
    if (mint === config.WSOL_MINT) {
      const solPrice = await getSolPriceUsd();
      return (amount / 1_000_000_000) * solPrice;
    }

    // For other tokens, get quote to USDC
    const quote = await jupiter.getQuote(mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount, 100);
    return parseInt(quote.outAmount) / 1_000_000;
  } catch (error) {
    logger.debug('BURN', 'Failed to get token value, estimating via SOL', {
      mint: mint.slice(0, 8),
      error: error.message,
    });

    // Fallback: try to get value via SOL
    try {
      const solQuote = await jupiter.getTokenToSolQuote(mint, amount, 100);
      const solAmount = parseInt(solQuote.outAmount);
      const solPrice = await getSolPriceUsd();
      return (solAmount / 1_000_000_000) * solPrice;
    } catch {
      return 0; // Can't determine value
    }
  }
}

/**
 * Get all token accounts owned by treasury with balances
 * Filters by USD value for economic efficiency
 */
async function getTreasuryTokenBalances() {
  const treasury = getTreasuryAddress();
  if (!treasury) {
    logger.warn('BURN', 'Treasury address not configured');
    return [];
  }

  try {
    const connection = rpc.getConnection();

    // Get all token accounts owned by treasury
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      treasury,
      { programId: TOKEN_PROGRAM_ID }
    );

    const balances = [];
    for (const { account, pubkey } of tokenAccounts.value) {
      const parsed = account.data.parsed;
      if (parsed?.info) {
        const mint = parsed.info.mint;
        const balance = parseInt(parsed.info.tokenAmount?.amount || '0');
        const decimals = parsed.info.tokenAmount?.decimals || 0;

        if (balance <= 0) continue;

        // Get USD value for economic efficiency check
        const valueUsd = await getTokenValueUsd(mint, balance, decimals);

        if (valueUsd >= MIN_VALUE_USD) {
          balances.push({
            mint,
            balance,
            decimals,
            valueUsd,
            ataAddress: pubkey.toBase58(),
            symbol: jupiter.TOKEN_INFO[mint]?.symbol || 'UNKNOWN',
          });

          logger.debug('BURN', 'Token eligible for processing', {
            symbol: jupiter.TOKEN_INFO[mint]?.symbol || 'UNKNOWN',
            balance,
            valueUsd: valueUsd.toFixed(2),
          });
        } else if (valueUsd > 0) {
          logger.debug('BURN', 'Token below minimum value', {
            mint: mint.slice(0, 8),
            valueUsd: valueUsd.toFixed(4),
            minRequired: MIN_VALUE_USD,
          });
        }
      }
    }

    // Sort by value (highest first) for optimal processing
    balances.sort((a, b) => b.valueUsd - a.valueUsd);

    logger.info('BURN', 'Treasury token balances scanned', {
      totalAccounts: tokenAccounts.value.length,
      eligibleTokens: balances.length,
      totalValueUsd: balances.reduce((sum, b) => sum + b.valueUsd, 0).toFixed(2),
    });

    return balances;
  } catch (error) {
    logger.error('BURN', 'Failed to get treasury token balances', { error: error.message });
    return [];
  }
}

/**
 * Main burn check and execution
 * Now scans actual treasury token balances instead of tracked amounts
 */
async function checkAndExecuteBurn() {
  // Get actual token balances in treasury
  const tokenBalances = await getTreasuryTokenBalances();

  if (tokenBalances.length === 0) {
    return null;
  }

  // ==========================================================================
  // RACE CONDITION FIX: Distributed lock prevents concurrent burn executions
  // ==========================================================================
  const lockResult = await redis.withLock(BURN_LOCK_NAME, async () => {
    // Re-check balances after acquiring lock (double-check pattern)
    const confirmedBalances = await getTreasuryTokenBalances();
    if (confirmedBalances.length === 0) {
      logger.debug('BURN', 'No token balances after lock acquired');
      return null;
    }

    return executeBurnWithLock(confirmedBalances);
  }, BURN_LOCK_TTL);

  if (!lockResult.success) {
    if (lockResult.error === 'LOCK_HELD') {
      logger.debug('BURN', 'Burn already in progress, skipping');
    } else {
      logger.error('BURN', 'Burn execution failed', { error: lockResult.message });
    }
    return null;
  }

  return lockResult.result;
}

/**
 * Execute burn operation for all collected tokens
 *
 * Flow for each token:
 * - If $ASDF: Burn 80% directly, swap 20% → SOL for treasury
 * - If other: Swap 80% → ASDF → Burn, swap 20% → SOL for treasury
 */
async function executeBurnWithLock(tokenBalances) {
  const results = {
    processed: [],
    failed: [],
    totalBurned: 0,
    totalTreasury: 0,
  };

  for (const token of tokenBalances) {
    try {
      const result = await processTokenBurn(token);
      if (result) {
        results.processed.push(result);
        results.totalBurned += result.asdfBurned || 0;
        results.totalTreasury += result.solToTreasury || 0;
      }
    } catch (error) {
      logger.error('BURN', 'Failed to process token', {
        mint: token.mint.slice(0, 8),
        symbol: token.symbol,
        error: error.message,
      });
      results.failed.push({ mint: token.mint, error: error.message });
    }
  }

  if (results.processed.length > 0) {
    logger.info('BURN', 'Burn cycle completed', {
      tokensProcessed: results.processed.length,
      tokensFailed: results.failed.length,
      totalAsdfBurned: results.totalBurned,
      totalSolToTreasury: results.totalTreasury,
    });
  }

  return results;
}

/**
 * Process a single token type for burning
 */
async function processTokenBurn(token) {
  const { mint, balance, symbol, decimals, valueUsd } = token;
  const isAsdf = mint === config.ASDF_MINT;

  // Calculate 80/20 split
  const { burnAmount, treasuryAmount } = calculateTreasurySplit(balance, config.BURN_RATIO);

  logger.info('BURN', `Processing ${symbol}`, {
    mint: mint.slice(0, 8),
    totalBalance: balance,
    valueUsd: valueUsd?.toFixed(2) || 'unknown',
    burnPortion: burnAmount,
    treasuryPortion: treasuryAmount,
    isAsdf,
  });

  let asdfBurned = 0;
  let solToTreasury = 0;
  let burnSignature = null;
  let swapSignatures = [];

  const feePayer = getHealthyPayer();
  if (!feePayer) {
    throw new Error('No healthy fee payer available');
  }

  if (isAsdf) {
    // ==========================================================================
    // $ASDF TOKEN: Burn 80% directly, swap 20% → SOL for treasury
    // ==========================================================================

    // 1. Burn 80% directly
    if (burnAmount > 0) {
      burnSignature = await burnAsdfFromTreasury(burnAmount);
      asdfBurned = burnAmount;
      logger.info('BURN', 'Direct ASDF burn', {
        amount: burnAmount,
        signature: burnSignature,
      });
    }

    // 2. Swap 20% → SOL for treasury operations
    if (treasuryAmount > 0) {
      const treasurySwap = await swapTokenToSol(mint, treasuryAmount, feePayer);
      if (treasurySwap.success) {
        solToTreasury = parseInt(treasurySwap.solReceived);
        swapSignatures.push(treasurySwap.signature);

        await redis.incrTreasuryTotal(solToTreasury);
        await redis.recordTreasuryEvent({
          type: 'fee_conversion',
          tokenMint: mint,
          tokenAmount: treasuryAmount,
          solAmount: solToTreasury,
          source: 'asdf_treasury_portion',
        });
      }
    }

  } else {
    // ==========================================================================
    // OTHER TOKENS: Swap 80% → ASDF → Burn, swap 20% → SOL for treasury
    // ==========================================================================

    // 1. Swap 80% → ASDF and burn
    if (burnAmount > 0) {
      const burnSwap = await swapTokenToAsdf(mint, burnAmount, feePayer);
      if (burnSwap.success) {
        const asdfToBurn = parseInt(burnSwap.asdfReceived);
        swapSignatures.push(burnSwap.signature);

        // Burn the ASDF we received
        burnSignature = await burnAsdf(asdfToBurn);
        asdfBurned = asdfToBurn;

        logger.info('BURN', 'Swap and burn completed', {
          tokenIn: burnAmount,
          asdfBurned: asdfToBurn,
          swapSignature: burnSwap.signature,
          burnSignature,
        });
      }
    }

    // 2. Swap 20% → SOL for treasury operations
    if (treasuryAmount > 0) {
      const treasurySwap = await swapTokenToSol(mint, treasuryAmount, feePayer);
      if (treasurySwap.success) {
        solToTreasury = parseInt(treasurySwap.solReceived);
        swapSignatures.push(treasurySwap.signature);

        await redis.incrTreasuryTotal(solToTreasury);
        await redis.recordTreasuryEvent({
          type: 'fee_conversion',
          tokenMint: mint,
          tokenAmount: treasuryAmount,
          solAmount: solToTreasury,
          source: 'token_treasury_portion',
        });

        logger.info('TREASURY', 'Token converted to SOL', {
          tokenMint: mint.slice(0, 8),
          tokenAmount: treasuryAmount,
          solReceived: solToTreasury,
        });
      }
    }
  }

  // Update burn stats
  if (asdfBurned > 0) {
    await redis.incrBurnTotal(asdfBurned);

    // Record burn proof for transparency
    await redis.recordBurnProof({
      burnSignature,
      swapSignatures,
      amountBurned: asdfBurned,
      sourceToken: mint,
      sourceAmount: burnAmount,
      treasuryAmount: solToTreasury,
      method: isAsdf ? 'direct' : 'swap',
      network: config.NETWORK,
    });
  }

  return {
    mint,
    symbol,
    asdfBurned,
    solToTreasury,
    burnSignature,
    swapSignatures,
  };
}

/**
 * Swap token → ASDF via Jupiter
 */
async function swapTokenToAsdf(tokenMint, amount, feePayer) {
  try {
    // Get quote
    const quote = await jupiter.getTokenToAsdfQuote(tokenMint, amount, 150); // 1.5% slippage

    if (quote.noSwapNeeded) {
      return { success: true, asdfReceived: amount, signature: null };
    }

    // Get swap transaction
    const swapResponse = await jupiter.getSwapTransaction(quote, feePayer.publicKey.toBase58());

    // Deserialize, sign, and send
    const swapTxBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = Transaction.from(swapTxBuf);
    transaction.sign(feePayer);

    const signature = await rpc.sendTransaction(transaction);
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
    await rpc.confirmTransaction(signature, blockhash, lastValidBlockHeight);

    return {
      success: true,
      asdfReceived: quote.outAmount,
      signature,
    };
  } catch (error) {
    logger.error('BURN', 'Token → ASDF swap failed', {
      tokenMint: tokenMint.slice(0, 8),
      amount,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
}

/**
 * Swap token → SOL via Jupiter
 */
async function swapTokenToSol(tokenMint, amount, feePayer) {
  try {
    // Get quote
    const quote = await jupiter.getTokenToSolQuote(tokenMint, amount, 150); // 1.5% slippage

    if (quote.noSwapNeeded) {
      return { success: true, solReceived: amount, signature: null };
    }

    // Get swap transaction
    const swapResponse = await jupiter.getSwapTransaction(quote, feePayer.publicKey.toBase58());

    // Deserialize, sign, and send
    const swapTxBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = Transaction.from(swapTxBuf);
    transaction.sign(feePayer);

    const signature = await rpc.sendTransaction(transaction);
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
    await rpc.confirmTransaction(signature, blockhash, lastValidBlockHeight);

    return {
      success: true,
      solReceived: quote.outAmount,
      signature,
    };
  } catch (error) {
    logger.error('BURN', 'Token → SOL swap failed', {
      tokenMint: tokenMint.slice(0, 8),
      amount,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
}

/**
 * Burn ASDF from fee payer's token account
 */
async function burnAsdf(amount) {
  const feePayer = getHealthyPayer();
  const asdfMint = getAsdfMint();

  // Get fee payer's ASDF token account
  const tokenAccount = await getAssociatedTokenAddress(
    asdfMint,
    feePayer.publicKey
  );

  // Create burn instruction
  const burnIx = createBurnInstruction(
    tokenAccount,
    asdfMint,
    feePayer.publicKey,
    amount
  );

  // Build and send transaction
  const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();

  const transaction = new Transaction({
    feePayer: feePayer.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(burnIx);

  transaction.sign(feePayer);

  const signature = await rpc.sendTransaction(transaction);
  await rpc.confirmTransaction(signature, blockhash, lastValidBlockHeight);

  return signature;
}

/**
 * Burn ASDF directly from treasury token account
 * Used when treasury already holds ASDF
 */
async function burnAsdfFromTreasury(amount) {
  const feePayer = getHealthyPayer();
  const treasury = getTreasuryAddress();
  const asdfMint = getAsdfMint();

  // Get treasury's ASDF token account
  const treasuryAta = await getAssociatedTokenAddress(
    asdfMint,
    treasury
  );

  // Check if fee payer is the treasury (can burn directly)
  const feePayerIsTreasury = feePayer.publicKey.equals(treasury);

  if (!feePayerIsTreasury) {
    // Treasury and fee payer are different - need to transfer first
    // For now, log warning and skip (requires multi-sig or treasury signing)
    logger.warn('BURN', 'Treasury differs from fee payer, cannot burn directly');

    // Alternative: Transfer to fee payer, then burn
    // This requires treasury to sign, which we may not have
    // For now, we'll swap ASDF → SOL → ASDF burn via fee payer
    return null;
  }

  // Create burn instruction (treasury is fee payer, so we have authority)
  const burnIx = createBurnInstruction(
    treasuryAta,
    asdfMint,
    treasury,
    amount
  );

  // Build and send transaction
  const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();

  const transaction = new Transaction({
    feePayer: feePayer.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(burnIx);

  transaction.sign(feePayer);

  const signature = await rpc.sendTransaction(transaction);
  await rpc.confirmTransaction(signature, blockhash, lastValidBlockHeight);

  return signature;
}

// Schedule periodic burn checks
function startBurnWorker(intervalMs = 60000) {
  // Initial check after 10 seconds
  setTimeout(async () => {
    try {
      await checkAndExecuteBurn();
    } catch (error) {
      logger.error('BURN', 'Initial burn check failed', { error: error.message });
    }
  }, 10000);

  // Then check periodically
  setInterval(async () => {
    try {
      await checkAndExecuteBurn();
    } catch (error) {
      logger.error('BURN', 'Burn worker error', { error: error.message });
    }
  }, intervalMs);

  logger.info('BURN', 'Burn worker started', { intervalMs });
}

module.exports = {
  checkAndExecuteBurn,
  burnAsdf,
  startBurnWorker,
  getTreasuryTokenBalances,
};
