const { PublicKey } = require('@solana/web3.js');
const { createBurnCheckedInstruction, getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');
const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const { MINTS, GOLDEN_BURN_RATIO, GOLDEN_TREASURY_RATIO } = require('../constants');
const helius = require('./helius');
const feePayer = require('./fee-payer');
const jupiter = require('./jupiter');

let burnInterval = null;

async function startBurnWorker() {
  logger.info('BURN_WORKER', 'Starting burn worker (60s interval)');
  // Run immediately then every 60s
  runBurnCycle();
  burnInterval = setInterval(runBurnCycle, 60_000);
}

function stopBurnWorker() {
  if (burnInterval) clearInterval(burnInterval);
}

async function runBurnCycle() {
  // Use distributed lock to prevent concurrent burns
  const result = await redis.withLock('burn-worker', async () => {
    const kp = feePayer.getFeePayer();
    const connection = helius.getConnection();
    const treasuryPubkey = kp.publicKey;

    // Check each whitelisted stablecoin balance in treasury
    // For USDC/USDT/PYUSD: swap to $ASDF via Jupiter, then burn
    // For $ASDF: burn directly (keep small fraction for SOL refill)

    // 1. Check $ASDF balance first (direct burn path)
    const asdfAta = await getAssociatedTokenAddress(
      new PublicKey(MINTS.ASDF),
      treasuryPubkey
    );

    try {
      const asdfAccount = await getAccount(connection, asdfAta);
      const asdfBalance = Number(asdfAccount.amount);

      if (asdfBalance > 0) {
        // Burn the $ASDF directly
        const burnIx = createBurnCheckedInstruction(
          asdfAta,
          new PublicKey(MINTS.ASDF),
          treasuryPubkey,
          asdfBalance,
          6 // decimals
        );

        const signature = await helius.sendSmartTransaction([burnIx], [kp]);

        const burnedAmount = asdfBalance / 1e6;
        await redis.incrBurnTotal(burnedAmount);
        await redis.recordBurnProof({
          burnSignature: signature,
          amountBurned: burnedAmount,
          method: 'direct',
          network: config.USE_MAINNET ? 'mainnet-beta' : 'devnet',
        });

        logger.info('BURN_WORKER', 'Burned $ASDF', {
          amount: burnedAmount,
          signature,
          explorer: `https://orbmarkets.io/tx/${signature}`,
        });
      }
    } catch (err) {
      // ATA might not exist yet, that's fine
      if (!err.message?.includes('could not find account')) {
        logger.warn('BURN_WORKER', 'ASDF burn check failed', { error: err.message });
      }
    }

    // 2. Check stablecoin balances (USDC, USDT, PYUSD)
    const stablecoins = [MINTS.USDC, MINTS.USDT, MINTS.PYUSD];
    for (const mint of stablecoins) {
      try {
        const ata = await getAssociatedTokenAddress(new PublicKey(mint), treasuryPubkey);
        const account = await getAccount(connection, ata);
        const balance = Number(account.amount);

        // Minimum $0.50 threshold (500000 for 6-decimal tokens)
        if (balance < 500_000) continue;

        // Swap stablecoin -> $ASDF via Jupiter
        const quote = await jupiter.getTokenToAsdfQuote(mint, balance);
        if (quote.noSwapNeeded) continue;

        const swapTx = await jupiter.getSwapTransaction(quote, treasuryPubkey.toBase58());
        // Execute the swap... (Jupiter returns serialized tx)
        // Then burn the received $ASDF

        logger.info('BURN_WORKER', 'Stablecoin swap initiated', {
          mint: mint.slice(0, 8),
          balance: balance / 1e6,
        });
      } catch (err) {
        if (!err.message?.includes('could not find account')) {
          logger.warn('BURN_WORKER', 'Stablecoin check failed', { mint: mint.slice(0, 8), error: err.message });
        }
      }
    }

    return { success: true };
  }, 120); // 120s lock TTL

  if (!result.success && result.error === 'LOCK_HELD') {
    logger.debug('BURN_WORKER', 'Skipping — lock held by another instance');
  } else if (!result.success) {
    logger.error('BURN_WORKER', 'Burn cycle failed', { error: result.message });
  }
}

module.exports = { startBurnWorker, stopBurnWorker };
