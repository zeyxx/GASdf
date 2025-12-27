const { PumpAmmSdk } = require('@pump-fun/pump-swap-sdk');
const { PublicKey, Transaction } = require('@solana/web3.js');
const config = require('../utils/config');
const logger = require('../utils/logger');
const rpc = require('../utils/rpc');
const { getHealthyPayer, signTransaction } = require('./fee-payer-pool');

// Initialize SDK
const pumpAmmSdk = new PumpAmmSdk();

// ASDF pool address (ASDF/SOL)
// This is derived from the ASDF mint and WSOL mint
let _poolKey = null;

async function getPoolKey() {
  if (_poolKey) return _poolKey;

  // Pool key is derived from base (ASDF) and quote (WSOL) mints
  const asdfMint = new PublicKey(config.ASDF_MINT);
  const wsolMint = new PublicKey(config.WSOL_MINT);

  // Find the pool PDA
  const [poolKey] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('pool'),
      asdfMint.toBuffer(),
      wsolMint.toBuffer(),
    ],
    new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA') // PumpSwap program
  );

  _poolKey = poolKey;
  return poolKey;
}

async function getSwapQuote(solAmountLamports, slippageBps = 100) {
  try {
    const poolKey = await getPoolKey();
    const feePayer = getHealthyPayer();

    const swapState = await pumpAmmSdk.swapSolanaState(poolKey, feePayer.publicKey);

    const { globalConfig, pool, poolBaseAmount, poolQuoteAmount } = swapState;

    // Calculate expected ASDF output for given SOL input
    // Using internal calculation (buying base with quote input)
    const baseReserve = poolBaseAmount;
    const quoteReserve = poolQuoteAmount;

    // Simple constant product calculation: x * y = k
    // dy = y * dx / (x + dx) with fee adjustment
    const feeRate = globalConfig.tradeFeeNumerator / globalConfig.tradeFeeDenominator;
    const solAfterFee = solAmountLamports * (1 - feeRate);
    const asdfOut = (baseReserve * solAfterFee) / (quoteReserve + solAfterFee);

    return {
      inputAmount: solAmountLamports,
      outputAmount: Math.floor(asdfOut),
      priceImpact: solAmountLamports / quoteReserve,
      poolKey: poolKey.toBase58(),
    };
  } catch (error) {
    logger.error('PUMPSWAP', 'Failed to get quote', { error: error.message });
    throw error;
  }
}

async function swapSolToAsdf(solAmountLamports, slippageBps = 100) {
  try {
    const poolKey = await getPoolKey();
    const feePayer = getHealthyPayer();

    logger.info('PUMPSWAP', 'Initiating swap', {
      solAmount: solAmountLamports,
      pool: poolKey.toBase58(),
    });

    // Get swap state
    const swapState = await pumpAmmSdk.swapSolanaState(poolKey, feePayer.publicKey);

    // Build swap instruction (buy base with quote input = buy ASDF with SOL)
    const slippage = slippageBps / 10000;
    const instructions = await pumpAmmSdk.buyQuoteInput(
      swapState,
      solAmountLamports,
      slippage,
    );

    // Build transaction
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();

    const transaction = new Transaction({
      feePayer: feePayer.publicKey,
      blockhash,
      lastValidBlockHeight,
    });

    instructions.forEach(ix => transaction.add(ix));

    // Sign with fee payer
    transaction.sign(feePayer);

    // Send and confirm
    const signature = await rpc.sendTransaction(transaction);

    logger.info('PUMPSWAP', 'Swap submitted', { signature });

    // Confirm transaction
    await rpc.confirmTransaction(signature, blockhash, lastValidBlockHeight);

    logger.info('PUMPSWAP', 'Swap confirmed', { signature });

    return {
      signature,
      success: true,
    };
  } catch (error) {
    logger.error('PUMPSWAP', 'Swap failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  getSwapQuote,
  swapSolToAsdf,
  getPoolKey,
};
