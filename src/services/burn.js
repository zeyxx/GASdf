const {
  PublicKey,
  Transaction,
} = require('@solana/web3.js');
const {
  createBurnInstruction,
  getAssociatedTokenAddress,
  getAccount,
} = require('@solana/spl-token');
const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const rpc = require('../utils/rpc');
const { getHealthyPayer } = require('./fee-payer-pool');
const pumpswap = require('./pumpswap');
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

async function checkAndExecuteBurn() {
  const pendingAmount = await redis.getPendingSwapAmount();

  if (pendingAmount < config.BURN_THRESHOLD_LAMPORTS) {
    return null;
  }

  // ==========================================================================
  // RACE CONDITION FIX: Distributed lock prevents concurrent burn executions
  // ==========================================================================
  const lockResult = await redis.withLock(BURN_LOCK_NAME, async () => {
    // Re-check pending amount after acquiring lock (double-check pattern)
    const confirmedAmount = await redis.getPendingSwapAmount();
    if (confirmedAmount < config.BURN_THRESHOLD_LAMPORTS) {
      logger.debug('BURN', 'Pending amount below threshold after lock acquired');
      return null;
    }

    return executeBurnWithLock(confirmedAmount);
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
 * Execute burn operation (called while holding distributed lock)
 */
async function executeBurnWithLock(totalAmount) {
  // ==========================================================================
  // 80/20 Treasury Model
  // ==========================================================================
  // 80% → swap to $ASDF → burn (the mission)
  // 20% → treasury for operations (server, RPC, fee payer refill)
  // ==========================================================================

  // Validate total amount
  const validation = validateSolanaAmount(totalAmount, 'totalAmount');
  if (!validation.valid) {
    logger.error('BURN', 'Invalid total amount', { error: validation.error, totalAmount });
    return null;
  }

  // Use safe treasury split calculation (ensures no lamports lost)
  const { burnAmount, treasuryAmount } = calculateTreasurySplit(totalAmount, config.BURN_RATIO);

  logger.info('BURN', 'Processing fees with 80/20 split', {
    totalAmount,
    burnAmount,
    treasuryAmount,
    burnRatio: config.BURN_RATIO,
    treasuryRatio: config.TREASURY_RATIO,
  });

  try {
    // 1. Allocate treasury portion (stays as SOL for operations)
    if (treasuryAmount > 0) {
      await redis.incrTreasuryTotal(treasuryAmount);
      await redis.recordTreasuryEvent({
        type: 'allocation',
        amount: treasuryAmount,
        source: 'fee_split',
      });

      logger.info('TREASURY', 'Allocated to operations fund', {
        amount: treasuryAmount,
        amountSol: treasuryAmount / 1e9,
      });
    }

    // 2. Swap burn portion to ASDF (PumpSwap primary, Jupiter fallback)
    if (burnAmount <= 0) {
      logger.warn('BURN', 'Burn amount too small after split');
      await redis.resetPendingSwap();
      return null;
    }

    const swapResult = await swapWithFallback(burnAmount);

    if (!swapResult.success) {
      logger.warn('BURN', 'Swap failed', { error: swapResult.error });

      // Reverse treasury allocation on failure
      if (treasuryAmount > 0) {
        await redis.incrTreasuryTotal(-treasuryAmount);
        await redis.recordTreasuryEvent({
          type: 'reversal',
          amount: -treasuryAmount,
          reason: 'swap_failed',
        });
      }

      // Reset pending swap to prevent stuck funds
      // The fees will be re-accumulated on next transactions
      await redis.resetPendingSwap();
      logger.warn('BURN', 'Reset pending swap amount after failure');

      return null;
    }

    logger.info('BURN', 'Swap completed', {
      signature: swapResult.signature,
      method: swapResult.method,
    });

    // 3. Get ASDF balance and burn it all
    const feePayer = getHealthyPayer();
    const asdfMint = getAsdfMint();
    const tokenAccount = await getAssociatedTokenAddress(asdfMint, feePayer.publicKey);

    let asdfBalance;
    try {
      const accountInfo = await getAccount(rpc.getConnection(), tokenAccount);
      asdfBalance = Number(accountInfo.amount);
    } catch (error) {
      logger.error('BURN', 'Failed to get ASDF balance', { error: error.message });
      // Swap succeeded but can't verify balance - reset pending to avoid double processing
      await redis.resetPendingSwap();
      return null;
    }

    if (asdfBalance <= 0) {
      logger.warn('BURN', 'No ASDF to burn after swap');
      // Swap may have failed silently - reset pending
      await redis.resetPendingSwap();
      return null;
    }

    // 4. Burn the ASDF
    const burnResult = await burnAsdf(asdfBalance);

    // 5. Update stats
    await redis.incrBurnTotal(asdfBalance);
    await redis.resetPendingSwap();

    // 6. Record burn proof for transparency
    const burnProof = await redis.recordBurnProof({
      burnSignature: burnResult,
      swapSignature: swapResult.signature,
      amountBurned: asdfBalance,
      solAmount: burnAmount,
      treasuryAmount,
      method: swapResult.method,
      network: config.NETWORK,
    });

    logger.info('BURN', 'Burn completed (80/20 model)', {
      asdfBurned: asdfBalance,
      solToBurn: burnAmount,
      solToTreasury: treasuryAmount,
      burnSignature: burnResult,
      proofRecorded: true,
    });

    return {
      amountBurned: asdfBalance,
      treasuryAllocated: treasuryAmount,
      swapSignature: swapResult.signature,
      burnSignature: burnResult,
      method: swapResult.method,
      model: '80/20',
      proof: burnProof,
    };
  } catch (error) {
    logger.error('BURN', 'Burn failed', { error: error.message });
    // Don't reset pending - will retry next cycle
    return null;
  }
}

async function swapWithFallback(solAmountLamports) {
  // Primary: PumpSwap
  try {
    logger.info('BURN', 'Attempting PumpSwap', { solAmount: solAmountLamports });
    const result = await pumpswap.swapSolToAsdf(solAmountLamports);
    return { ...result, method: 'pumpswap' };
  } catch (pumpswapError) {
    logger.warn('BURN', 'PumpSwap failed, trying Jupiter', {
      error: pumpswapError.message,
    });
  }

  // Fallback: Jupiter
  try {
    logger.info('BURN', 'Attempting Jupiter', { solAmount: solAmountLamports });
    const result = await swapViaJupiter(solAmountLamports);
    return { ...result, method: 'jupiter' };
  } catch (jupiterError) {
    logger.error('BURN', 'Jupiter also failed', {
      error: jupiterError.message,
    });
  }

  return { success: false };
}

async function swapViaJupiter(solAmountLamports) {
  const feePayer = getHealthyPayer();

  // Get quote
  const quote = await jupiter.getQuote(
    config.WSOL_MINT,
    config.ASDF_MINT,
    solAmountLamports,
    100, // 1% slippage
  );

  // Get swap transaction
  const swapResponse = await jupiter.getSwapTransaction(
    quote,
    feePayer.publicKey.toBase58(),
  );

  // Deserialize and sign
  const swapTxBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
  const transaction = Transaction.from(swapTxBuf);

  transaction.sign(feePayer);

  // Send and confirm
  const signature = await rpc.sendTransaction(transaction);
  const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
  await rpc.confirmTransaction(signature, blockhash, lastValidBlockHeight);

  return {
    signature,
    success: true,
  };
}

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
};
