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

async function checkAndExecuteBurn() {
  const pendingAmount = await redis.getPendingSwapAmount();

  if (pendingAmount < config.BURN_THRESHOLD_LAMPORTS) {
    return null;
  }

  logger.info('BURN', 'Burn threshold reached', {
    pendingAmount,
    threshold: config.BURN_THRESHOLD_LAMPORTS,
  });

  try {
    // 1. Swap SOL to ASDF (PumpSwap primary, Jupiter fallback)
    const swapResult = await swapWithFallback(Math.floor(pendingAmount));

    if (!swapResult.success) {
      logger.warn('BURN', 'Swap failed, keeping pending for retry');
      return null;
    }

    logger.info('BURN', 'Swap completed', {
      signature: swapResult.signature,
      method: swapResult.method,
    });

    // 2. Get ASDF balance and burn it all
    const feePayer = getHealthyPayer();
    const asdfMint = getAsdfMint();
    const tokenAccount = await getAssociatedTokenAddress(asdfMint, feePayer.publicKey);

    let asdfBalance;
    try {
      const accountInfo = await getAccount(rpc.getConnection(), tokenAccount);
      asdfBalance = Number(accountInfo.amount);
    } catch (error) {
      logger.error('BURN', 'Failed to get ASDF balance', { error: error.message });
      return null;
    }

    if (asdfBalance <= 0) {
      logger.warn('BURN', 'No ASDF to burn');
      return null;
    }

    // 3. Burn the ASDF
    const burnResult = await burnAsdf(asdfBalance);

    // 4. Update stats
    await redis.incrBurnTotal(asdfBalance);
    await redis.resetPendingSwap();

    logger.info('BURN', 'Burn completed', {
      asdfAmount: asdfBalance,
      signature: burnResult,
    });

    return {
      amountBurned: asdfBalance,
      swapSignature: swapResult.signature,
      burnSignature: burnResult,
      method: swapResult.method,
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
