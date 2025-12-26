const {
  PublicKey,
  Transaction,
} = require('@solana/web3.js');
const {
  createBurnInstruction,
  getAssociatedTokenAddress,
} = require('@solana/spl-token');
const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const rpc = require('../utils/rpc');
const { getFeePayer } = require('./signer');
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

  logger.info('BURN', 'Burn threshold reached', { pendingAmount });

  try {
    // 1. Swap accumulated SOL to ASDF
    const asdfQuote = await jupiter.swapToAsdf(Math.floor(pendingAmount));
    const asdfAmount = parseInt(asdfQuote.outAmount);

    logger.info('BURN', 'Swapping SOL for ASDF', { pendingAmount, asdfAmount });

    // 2. Execute the swap (would need full implementation)
    // For now, we'll simulate and track

    // 3. Burn the ASDF
    const burnResult = await burnAsdf(asdfAmount);

    // 4. Update stats
    await redis.incrBurnTotal(asdfAmount);
    await redis.resetPendingSwap();

    logger.info('BURN', 'Burn completed', { asdfAmount, signature: burnResult });

    return {
      amountBurned: asdfAmount,
      signature: burnResult,
    };
  } catch (error) {
    logger.error('BURN', 'Burn failed', { error: error.message });
    return null;
  }
}

async function burnAsdf(amount) {
  const feePayer = getFeePayer();
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
