const { PublicKey, Transaction } = require('@solana/web3.js');
const {
  createBurnInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const db = require('../utils/db');
const rpc = require('../utils/rpc');
const { pool: feePayerPool } = require('./fee-payer-pool');
const { getTreasuryAddress } = require('./treasury-ata');
const jupiter = require('./jupiter');
const holdex = require('./holdex');
const jito = require('./jito');
const {
  calculateTreasurySplit,
  validateSolanaAmount: _validateSolanaAmount,
} = require('../utils/safe-math');

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
// HYBRID MODEL: $ASDF purist + unified treasury
// - $ASDF fees: 100% burn (every $ASDF paid as fee is burned!)
// - Other tokens: Swap → $ASDF → 76.4% burn / 23.6% treasury (unified)
// - Only swap $ASDF → SOL when fee payer needs refill
//
// This maximizes $ASDF deflation while keeping unified model for other tokens
// TX costs: ~0.000005 SOL (~$0.001) per transaction
const MIN_VALUE_USD = 0.5;

// =============================================================================
// VELOCITY-BASED REFILL (Behavioral Proof > Fixed Thresholds)
// =============================================================================
// Instead of fixed 0.1 SOL threshold, we calculate based on actual tx velocity:
//   requiredBuffer = (txPerHour × avgCostPerTx) × bufferHours
//
// This adapts to actual usage patterns - behavioral proof, not promises.
// =============================================================================
const LAMPORTS_PER_SOL = 1_000_000_000;

// Minimum buffer regardless of velocity (safety floor: 0.05 SOL)
const MIN_BUFFER_LAMPORTS = 50_000_000;

// How many hours of runway to maintain (2 hours = comfortable margin)
const BUFFER_HOURS = 2;

// Legacy fallback thresholds (used when no velocity data)
const LEGACY_REFILL_THRESHOLD_SOL = 0.1;
const LEGACY_REFILL_TARGET_SOL = 0.3;

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
    // For $ASDF, always return high value (we burn it directly, no swap needed)
    // This ensures $ASDF is always eligible for burning regardless of liquidity
    if (mint === config.ASDF_MINT) {
      // Estimate value based on SOL price (rough approximation)
      // We don't need exact value - $ASDF is always burnable
      const uiAmount = amount / Math.pow(10, decimals);
      return Math.max(uiAmount * 0.001, MIN_VALUE_USD + 0.01); // Ensure always above threshold
    }

    // For USDC/USDT, value is direct (1:1 with USD)
    if (
      mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' || // USDC
      mint === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
    ) {
      // USDT
      return amount / Math.pow(10, decimals);
    }

    // For SOL, use cached price
    if (mint === config.WSOL_MINT) {
      const solPrice = await getSolPriceUsd();
      return (amount / 1_000_000_000) * solPrice;
    }

    // For other tokens, get quote to USDC
    const quote = await jupiter.getQuote(
      mint,
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount,
      100
    );
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
 * Check if fee payer needs SOL refill (VELOCITY-BASED)
 *
 * Instead of fixed threshold (0.1 SOL), we calculate based on actual tx velocity:
 *   requiredBuffer = (txPerHour × avgCostPerTx) × bufferHours
 *
 * This is "behavioral proof" - the threshold adapts to actual usage patterns.
 *
 * Returns { needsRefill, currentBalance, refillAmount, velocity, explanation } or null if no fee payer
 */
async function checkFeePayerNeedsRefill() {
  const feePayer = feePayerPool.getHealthyPayer();
  if (!feePayer) return null;

  try {
    const connection = rpc.getConnection();
    const balance = await connection.getBalance(feePayer.publicKey);
    const balanceSol = balance / LAMPORTS_PER_SOL;

    // Calculate velocity-based threshold
    const bufferCalc = await redis.calculateVelocityBasedBuffer(BUFFER_HOURS, MIN_BUFFER_LAMPORTS);

    const needsRefill = balance < bufferCalc.required;
    const refillAmount = needsRefill ? bufferCalc.target - balance : 0;

    logger.debug('BURN', 'Fee payer balance check (velocity-based)', {
      balance: balanceSol.toFixed(4),
      requiredBuffer: (bufferCalc.required / LAMPORTS_PER_SOL).toFixed(4),
      targetBuffer: (bufferCalc.target / LAMPORTS_PER_SOL).toFixed(4),
      velocity: bufferCalc.velocity,
      needsRefill,
      explanation: bufferCalc.explanation,
    });

    return {
      needsRefill,
      currentBalance: balance,
      balanceSol,
      refillAmount,
      requiredBuffer: bufferCalc.required,
      targetBuffer: bufferCalc.target,
      velocity: bufferCalc.velocity,
      explanation: bufferCalc.explanation,
    };
  } catch (error) {
    logger.error('BURN', 'Failed to check fee payer balance', { error: error.message });

    // Fallback to legacy fixed threshold if velocity check fails
    try {
      const connection = rpc.getConnection();
      const balance = await connection.getBalance(feePayer.publicKey);
      const balanceSol = balance / LAMPORTS_PER_SOL;
      const needsRefill = balanceSol < LEGACY_REFILL_THRESHOLD_SOL;
      const refillAmount = needsRefill
        ? Math.ceil((LEGACY_REFILL_TARGET_SOL - balanceSol) * LAMPORTS_PER_SOL)
        : 0;

      logger.warn('BURN', 'Using legacy fixed threshold (velocity check failed)', {
        balance: balanceSol.toFixed(4),
        threshold: LEGACY_REFILL_THRESHOLD_SOL,
        needsRefill,
      });

      return {
        needsRefill,
        currentBalance: balance,
        balanceSol,
        refillAmount,
        requiredBuffer: LEGACY_REFILL_THRESHOLD_SOL * LAMPORTS_PER_SOL,
        targetBuffer: LEGACY_REFILL_TARGET_SOL * LAMPORTS_PER_SOL,
        velocity: null,
        explanation: 'Legacy fixed threshold (velocity unavailable)',
      };
    } catch (fallbackError) {
      logger.error('BURN', 'Fallback balance check also failed', { error: fallbackError.message });
      return null;
    }
  }
}

/**
 * Refill fee payer SOL by swapping $ASDF from treasury
 * Uses VELOCITY-BASED thresholds for adaptive refill
 *
 * @returns {{ success: boolean, solReceived?: number, signature?: string, velocity?: object }}
 */
async function refillFeePayerFromAsdf() {
  const refillCheck = await checkFeePayerNeedsRefill();
  if (!refillCheck || !refillCheck.needsRefill) {
    return { success: true, message: 'No refill needed' };
  }

  const feePayer = feePayerPool.getHealthyPayer();
  const treasury = getTreasuryAddress();
  const asdfMint = getAsdfMint();

  // Get treasury's $ASDF balance
  try {
    const treasuryAsdfAta = await getAssociatedTokenAddress(asdfMint, treasury);
    const account = await getAccount(rpc.getConnection(), treasuryAsdfAta);
    const asdfBalance = Number(account.amount);

    if (asdfBalance <= 0) {
      logger.warn('BURN', 'No $ASDF in treasury for fee payer refill');
      return { success: false, error: 'No ASDF balance' };
    }

    // Calculate how much $ASDF to swap for target SOL (velocity-based target)
    // Get quote: ASDF → SOL
    const solNeeded = refillCheck.refillAmount;
    const quote = await jupiter.getQuote(
      config.ASDF_MINT,
      config.WSOL_MINT,
      asdfBalance, // Quote max available
      100 // 1% slippage
    );

    const solOut = parseInt(quote.outAmount);

    // If we can get enough SOL, swap only what we need
    // Otherwise swap all available $ASDF
    let asdfToSwap = asdfBalance;
    if (solOut > solNeeded * 1.1) {
      // We have more than enough, calculate exact amount needed
      // Rough estimate: (solNeeded / solOut) * asdfBalance
      asdfToSwap = Math.ceil((solNeeded / solOut) * asdfBalance * 1.05); // 5% buffer
      asdfToSwap = Math.min(asdfToSwap, asdfBalance); // Don't exceed balance
    }

    logger.info('BURN', 'Refilling fee payer SOL from treasury $ASDF (velocity-based)', {
      feePayerBalance: refillCheck.balanceSol.toFixed(4),
      requiredBuffer: (refillCheck.requiredBuffer / LAMPORTS_PER_SOL).toFixed(4),
      targetBuffer: (refillCheck.targetBuffer / LAMPORTS_PER_SOL).toFixed(4),
      solNeeded: (solNeeded / LAMPORTS_PER_SOL).toFixed(4),
      asdfToSwap,
      asdfBalance,
      velocity: refillCheck.velocity,
      explanation: refillCheck.explanation,
    });

    // Execute swap
    const swapResult = await swapTokenToSol(config.ASDF_MINT, asdfToSwap, feePayer);

    if (swapResult.success) {
      logger.info('BURN', 'Fee payer refilled successfully (velocity-based)', {
        solReceived: (parseInt(swapResult.solReceived) / LAMPORTS_PER_SOL).toFixed(4),
        signature: swapResult.signature,
        velocity: refillCheck.velocity,
      });

      await redis.recordTreasuryEvent({
        type: 'fee_payer_refill',
        asdfAmount: asdfToSwap,
        solAmount: swapResult.solReceived,
        previousBalance: refillCheck.currentBalance,
        velocity: refillCheck.velocity,
        requiredBuffer: refillCheck.requiredBuffer,
        targetBuffer: refillCheck.targetBuffer,
        explanation: refillCheck.explanation,
      });
    }

    return {
      ...swapResult,
      velocity: refillCheck.velocity,
      explanation: refillCheck.explanation,
    };
  } catch (error) {
    logger.error('BURN', 'Fee payer refill failed', { error: error.message });
    return { success: false, error: error.message };
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
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(treasury, {
      programId: TOKEN_PROGRAM_ID,
    });

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
  // ==========================================================================
  // OPTIMIZED MODEL: Check if fee payer needs refill before processing burns
  // Only swap $ASDF → SOL when fee payer SOL drops below threshold
  // ==========================================================================
  const refillCheck = await checkFeePayerNeedsRefill();
  if (refillCheck?.needsRefill) {
    logger.info('BURN', 'Fee payer needs refill, swapping $ASDF → SOL', {
      currentBalance: refillCheck.balanceSol.toFixed(4),
      threshold: LEGACY_REFILL_THRESHOLD_SOL,
    });
    await refillFeePayerFromAsdf();
  }

  // Get actual token balances in treasury
  const tokenBalances = await getTreasuryTokenBalances();

  if (tokenBalances.length === 0) {
    return null;
  }

  // ==========================================================================
  // RACE CONDITION FIX: Distributed lock prevents concurrent burn executions
  // ==========================================================================
  const lockResult = await redis.withLock(
    BURN_LOCK_NAME,
    async () => {
      // Re-check balances after acquiring lock (double-check pattern)
      const confirmedBalances = await getTreasuryTokenBalances();
      if (confirmedBalances.length === 0) {
        logger.debug('BURN', 'No token balances after lock acquired');
        return null;
      }

      return executeBurnWithLock(confirmedBalances);
    },
    BURN_LOCK_TTL
  );

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
 * BATCHED FLOW (optimized):
 * 1. Process all tokens - do swaps, collect burn amounts
 * 2. Execute ALL burns in a single batched transaction
 * 3. Record stats
 *
 * This saves ~0.000005 SOL per additional burn (base tx fee)
 */
async function executeBurnWithLock(tokenBalances) {
  const results = {
    processed: [],
    failed: [],
    totalBurned: 0,
    totalAsdfRetained: 0,
    batchSignature: null,
    model: 'hybrid',
  };

  // Collect all burns to execute in a single batch
  const pendingBurns = [];

  // Phase 1: Process tokens (swaps to $ASDF) and collect burn amounts
  // UNIFIED MODEL: All value flows through $ASDF
  for (const token of tokenBalances) {
    try {
      const result = await processTokenForBatch(token, pendingBurns);
      if (result) {
        results.processed.push(result);
        results.totalBurned += result.asdfBurned || 0;
        results.totalAsdfRetained += result.asdfRetained || 0;
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

  // Phase 2: Execute all burns in a single batched transaction
  if (pendingBurns.length > 0) {
    logger.info('BURN', 'Executing batched burns', {
      burnCount: pendingBurns.length,
      tokens: pendingBurns.map((b) => b.mint.slice(0, 8)),
    });

    try {
      const batchResult = await batchBurnFromTreasury(pendingBurns);
      results.batchSignature = batchResult.signature;

      if (batchResult.signature) {
        // Update burn stats
        const totalAsdfBurned = pendingBurns
          .filter((b) => b.type === 'asdf')
          .reduce((sum, b) => sum + b.amount, 0);

        if (totalAsdfBurned > 0) {
          await redis.incrBurnTotal(totalAsdfBurned);
        }

        // Record batch burn proof
        await redis.recordBurnProof({
          burnSignature: batchResult.signature,
          amountBurned: totalAsdfBurned,
          method: 'batch',
          burnCount: batchResult.burns,
          tokens: pendingBurns.map((b) => ({
            mint: b.mint,
            amount: b.amount,
            type: b.type,
          })),
          network: config.NETWORK,
        });

        // Record burn in PostgreSQL for persistent audit trail
        await db.recordBurn({
          signature: batchResult.signature,
          amountBurned: totalAsdfBurned,
          method: 'batch',
          treasuryAmount: results.totalAsdfRetained || 0,
        });
      }
    } catch (error) {
      logger.error('BURN', 'Batch burn failed, falling back to individual burns', {
        error: error.message,
        pendingBurns: pendingBurns.length,
      });

      // Fallback: try individual burns
      for (const burn of pendingBurns) {
        try {
          if (burn.type === 'asdf') {
            await burnAsdfFromTreasury(burn.amount);
            await redis.incrBurnTotal(burn.amount);
          } else {
            await burnTokenFromTreasury(burn.mint, burn.amount, feePayerPool.getHealthyPayer());
          }
        } catch (fallbackError) {
          logger.error('BURN', 'Individual burn also failed', {
            mint: burn.mint.slice(0, 8),
            error: fallbackError.message,
          });
        }
      }
    }
  }

  if (results.processed.length > 0) {
    logger.info('BURN', 'Burn cycle completed (hybrid model)', {
      tokensProcessed: results.processed.length,
      tokensFailed: results.failed.length,
      totalAsdfBurned: results.totalBurned,
      totalAsdfRetained: results.totalAsdfRetained,
      batchSignature: results.batchSignature,
      burnsBatched: pendingBurns.length,
      model: 'hybrid',
      philosophy: '$ASDF → 100% burn | Others → unified (76.4% burn)',
    });
  }

  return results;
}

/**
 * Process a single token for batched burning
 * Does swaps immediately, but collects burns for batch execution
 *
 * @param {Object} token - Token to process
 * @param {Array} pendingBurns - Array to collect burns for batch execution
 * @returns {Object} Processing result (without burn execution)
 */
async function processTokenForBatch(token, pendingBurns) {
  const { mint, balance, symbol, valueUsd: _valueUsd } = token;
  const isAsdf = mint === config.ASDF_MINT;

  // Get ecosystem burn bonus for non-ASDF tokens
  // Default: Golden Ratio split (no ecosystem burn bonus for unverified tokens)
  let ecosystemBurnBonus = {
    ecosystemBurnPct: 0,
    asdfBurnPct: config.BURN_RATIO, // 76.4% (1 - 1/φ³)
    treasuryPct: config.TREASURY_RATIO, // 23.6% (1/φ³)
  };
  let tokenBurnedPercent = 0;

  if (!isAsdf) {
    try {
      const tokenData = await holdex.getToken(mint);
      if (tokenData.ecosystemBurn) {
        ecosystemBurnBonus = tokenData.ecosystemBurn;
        tokenBurnedPercent = tokenData.supply?.burnedPercent || 0;
      }
    } catch (error) {
      logger.debug('BURN', 'Could not get ecosystem burn data', { mint: mint.slice(0, 8) });
    }
  }

  const feePayer = feePayerPool.getHealthyPayer();
  if (!feePayer) {
    throw new Error('No healthy fee payer available');
  }

  let asdfBurned = 0;
  let ecosystemBurned = 0;
  const swapSignatures = [];

  if (isAsdf) {
    // ==========================================================================
    // $ASDF: 100% BURN - Every $ASDF paid as fee is burned!
    // This maximizes $ASDF deflation - purist model
    // ==========================================================================
    if (balance > 0) {
      // Queue 100% for batch burn
      pendingBurns.push({
        mint: config.ASDF_MINT,
        amount: balance,
        type: 'asdf',
        symbol: 'asdfasdfa',
      });
      asdfBurned = balance;

      logger.info('BURN', '$ASDF fee: 100% queued for burn (purist model)', {
        amount: balance,
        model: 'purist',
      });
    }
  } else {
    // ==========================================================================
    // UNIFIED $ASDF MODEL: Everything flows through $ASDF
    //
    // Philosophy: All value → $ASDF → burn/treasury
    // - 1 swap instead of 2 (50% less swap fees!)
    // - Treasury kept in $ASDF (more $ASDF in ecosystem)
    // - Only swap $ASDF → SOL when fee payer needs refill
    // ==========================================================================

    // Ecosystem burn portion (direct token burn for dual-burn flywheel)
    const ecosystemBurnAmount = Math.floor(balance * ecosystemBurnBonus.ecosystemBurnPct);

    // Everything else → swap to $ASDF (1 swap only!)
    const amountToSwapToAsdf = balance - ecosystemBurnAmount;

    // 1. Ecosystem burn (queue for batch) - supports token burning ecosystem
    if (ecosystemBurnAmount > 0) {
      pendingBurns.push({
        mint,
        amount: ecosystemBurnAmount,
        type: 'ecosystem',
        symbol,
      });
      ecosystemBurned = ecosystemBurnAmount;
    }

    // 2. UNIFIED: Swap remaining 100% → $ASDF (1 swap instead of 2!)
    if (amountToSwapToAsdf > 0) {
      const swapResult = await swapTokenToAsdf(mint, amountToSwapToAsdf, feePayer);

      if (swapResult.success && swapResult.asdfReceived) {
        const asdfReceived = parseInt(swapResult.asdfReceived);
        swapSignatures.push(swapResult.signature);

        // Split received $ASDF using Golden Ratio
        const { burnAmount, treasuryAmount } = calculateTreasurySplit(
          asdfReceived,
          config.BURN_RATIO
        );

        // 2a. Queue 76.4% for burn
        if (burnAmount > 0) {
          pendingBurns.push({
            mint: config.ASDF_MINT,
            amount: burnAmount,
            type: 'asdf',
            symbol: 'asdfasdfa',
            sourceToken: mint,
          });
          asdfBurned = burnAmount;
        }

        // 2b. Keep 23.6% as $ASDF in treasury (UNIFIED MODEL!)
        // This $ASDF will be used to refill fee payer only when needed
        if (treasuryAmount > 0) {
          await redis.recordTreasuryEvent({
            type: 'asdf_retained',
            tokenMint: config.ASDF_MINT,
            tokenAmount: treasuryAmount,
            sourceToken: mint,
            source: 'unified_model_treasury',
          });

          logger.info('BURN', 'Treasury retained as $ASDF (unified model)', {
            sourceToken: mint.slice(0, 8),
            asdfRetained: treasuryAmount,
            willSwapToSolWhen: 'fee payer < 0.1 SOL',
          });
        }
      }
    }
  }

  logger.info('BURN', `Processed ${symbol} for batch`, {
    mint: mint.slice(0, 8),
    asdfBurned,
    ecosystemBurned,
    tokenBurnedPercent: tokenBurnedPercent > 0 ? tokenBurnedPercent.toFixed(1) + '%' : null,
    ecosystemBurnBonus:
      ecosystemBurnBonus.ecosystemBurnPct > 0
        ? (ecosystemBurnBonus.ecosystemBurnPct * 100).toFixed(1) + '%'
        : null,
    swapsUsed: swapSignatures.length,
    pendingBurnsTotal: pendingBurns.length,
    model: isAsdf ? '100% burn' : 'unified (76.4% burn)',
  });

  return {
    mint,
    symbol,
    asdfBurned,
    ecosystemBurned,
    asdfRetained:
      !isAsdf && asdfBurned > 0
        ? Math.floor((asdfBurned * (1 - config.BURN_RATIO)) / config.BURN_RATIO)
        : 0,
    swapSignatures,
    swapsUsed: swapSignatures.length,
    batched: true,
    model: isAsdf ? 'purist' : 'unified',
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

    // Deserialize and sign
    const swapTxBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = Transaction.from(swapTxBuf);

    // Add Jito tip instruction for MEV protection (if enabled)
    if (jito.isEnabled()) {
      const tipIx = jito.createTipInstruction(feePayer.publicKey, jito.DEFAULT_TIP_LAMPORTS);
      transaction.add(tipIx);
    }

    transaction.sign(feePayer);

    // Try Jito bundle first for MEV protection
    if (jito.isEnabled()) {
      const jitoResult = await jito.sendTransaction(transaction, { bundleOnly: true });

      if (jitoResult.success && jitoResult.signature) {
        logger.info('BURN', 'Swap sent via Jito', {
          signature: jitoResult.signature,
          tokenMint: tokenMint.slice(0, 8),
        });

        // Wait for confirmation
        const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
        await rpc.confirmTransaction(jitoResult.signature, blockhash, lastValidBlockHeight);

        return {
          success: true,
          asdfReceived: quote.outAmount,
          signature: jitoResult.signature,
          mevProtected: true,
        };
      }

      // Jito failed, fall back to regular RPC
      logger.warn('BURN', 'Jito failed, falling back to RPC', { error: jitoResult.error });
    }

    // Standard RPC submission (fallback or non-mainnet)
    const signature = await rpc.sendTransaction(transaction);
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
    await rpc.confirmTransaction(signature, blockhash, lastValidBlockHeight);

    return {
      success: true,
      asdfReceived: quote.outAmount,
      signature,
      mevProtected: false,
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

    // Deserialize and sign
    const swapTxBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = Transaction.from(swapTxBuf);

    // Add Jito tip instruction for MEV protection (if enabled)
    if (jito.isEnabled()) {
      const tipIx = jito.createTipInstruction(feePayer.publicKey, jito.DEFAULT_TIP_LAMPORTS);
      transaction.add(tipIx);
    }

    transaction.sign(feePayer);

    // Try Jito bundle first for MEV protection
    if (jito.isEnabled()) {
      const jitoResult = await jito.sendTransaction(transaction, { bundleOnly: true });

      if (jitoResult.success && jitoResult.signature) {
        logger.info('BURN', 'SOL swap sent via Jito', {
          signature: jitoResult.signature,
          tokenMint: tokenMint.slice(0, 8),
        });

        // Wait for confirmation
        const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
        await rpc.confirmTransaction(jitoResult.signature, blockhash, lastValidBlockHeight);

        return {
          success: true,
          solReceived: quote.outAmount,
          signature: jitoResult.signature,
          mevProtected: true,
        };
      }

      // Jito failed, fall back to regular RPC
      logger.warn('BURN', 'Jito failed for SOL swap, falling back to RPC', {
        error: jitoResult.error,
      });
    }

    // Standard RPC submission (fallback or non-mainnet)
    const signature = await rpc.sendTransaction(transaction);
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
    await rpc.confirmTransaction(signature, blockhash, lastValidBlockHeight);

    return {
      success: true,
      solReceived: quote.outAmount,
      signature,
      mevProtected: false,
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
  const feePayer = feePayerPool.getHealthyPayer();
  const asdfMint = getAsdfMint();

  // Get fee payer's ASDF token account
  const tokenAccount = await getAssociatedTokenAddress(asdfMint, feePayer.publicKey);

  // Create burn instruction
  const burnIx = createBurnInstruction(tokenAccount, asdfMint, feePayer.publicKey, amount);

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
 * BATCHED BURN: Execute multiple burn operations in a single transaction
 * Saves ~0.000005 SOL per additional burn (base tx fee)
 *
 * @param {Array<{mint: string, amount: number, type: 'asdf'|'ecosystem'}>} burns
 * @returns {Promise<{signature: string, burns: number}>}
 */
async function batchBurnFromTreasury(burns) {
  if (!burns || burns.length === 0) {
    return { signature: null, burns: 0 };
  }

  const feePayer = feePayerPool.getHealthyPayer();
  const treasury = getTreasuryAddress();

  if (!feePayer.publicKey.equals(treasury)) {
    logger.warn('BURN', 'Treasury differs from fee payer, cannot batch burn directly');
    return { signature: null, burns: 0, error: 'Treasury mismatch' };
  }

  const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();

  const transaction = new Transaction({
    feePayer: feePayer.publicKey,
    blockhash,
    lastValidBlockHeight,
  });

  let burnCount = 0;

  for (const burn of burns) {
    try {
      const tokenMint = new PublicKey(burn.mint);
      const treasuryAta = await getAssociatedTokenAddress(tokenMint, treasury);

      const burnIx = createBurnInstruction(treasuryAta, tokenMint, treasury, burn.amount);

      transaction.add(burnIx);
      burnCount++;

      logger.debug('BURN', 'Added burn instruction to batch', {
        mint: burn.mint.slice(0, 8),
        amount: burn.amount,
        type: burn.type,
      });
    } catch (error) {
      logger.warn('BURN', 'Failed to add burn to batch', {
        mint: burn.mint?.slice(0, 8),
        error: error.message,
      });
    }
  }

  if (burnCount === 0) {
    return { signature: null, burns: 0 };
  }

  transaction.sign(feePayer);

  const signature = await rpc.sendTransaction(transaction);
  await rpc.confirmTransaction(signature, blockhash, lastValidBlockHeight);

  logger.info('BURN', 'Batch burn executed', {
    signature,
    burnCount,
    savedTxFees: `~${((burnCount - 1) * 0.000005).toFixed(6)} SOL`,
  });

  return { signature, burns: burnCount };
}

/**
 * Burn ASDF directly from treasury token account
 * Used when treasury already holds ASDF
 */
async function burnAsdfFromTreasury(amount) {
  const feePayer = feePayerPool.getHealthyPayer();
  const treasury = getTreasuryAddress();
  const asdfMint = getAsdfMint();

  // Get treasury's ASDF token account
  const treasuryAta = await getAssociatedTokenAddress(asdfMint, treasury);

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
  const burnIx = createBurnInstruction(treasuryAta, asdfMint, treasury, amount);

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
 * Burn any SPL token directly from treasury token account
 * Used for ecosystem burn bonus in dual-burn flywheel
 *
 * @param {string} mint - Token mint address
 * @param {number} amount - Amount to burn (raw, with decimals)
 * @param {Keypair} feePayer - Fee payer keypair (must be treasury owner)
 * @returns {Promise<string>} - Transaction signature
 */
async function burnTokenFromTreasury(mint, amount, feePayer) {
  const treasury = getTreasuryAddress();
  const tokenMint = new PublicKey(mint);

  // Get treasury's token account for this mint
  const treasuryAta = await getAssociatedTokenAddress(tokenMint, treasury);

  // Verify the token account exists and has sufficient balance
  try {
    const account = await getAccount(rpc.getConnection(), treasuryAta);
    if (BigInt(account.amount) < BigInt(amount)) {
      throw new Error(`Insufficient balance: ${account.amount} < ${amount}`);
    }
  } catch (error) {
    if (error.message.includes('could not find account')) {
      throw new Error(`Token account not found for mint ${mint.slice(0, 8)}`);
    }
    throw error;
  }

  // Check if fee payer is the treasury (can burn directly)
  const feePayerIsTreasury = feePayer.publicKey.equals(treasury);

  if (!feePayerIsTreasury) {
    // Treasury and fee payer are different - cannot burn without treasury signing
    throw new Error('Fee payer is not treasury owner, cannot burn directly');
  }

  // Create burn instruction (treasury is fee payer, so we have authority)
  const burnIx = createBurnInstruction(treasuryAta, tokenMint, treasury, amount);

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

  logger.info('BURN', 'Token burned from treasury (ecosystem burn)', {
    mint: mint.slice(0, 8),
    amount,
    signature,
  });

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
  burnTokenFromTreasury,
  startBurnWorker,
  getTreasuryTokenBalances,
};
