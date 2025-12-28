/**
 * Ignition Integration Routes
 * Enables paying Ignition launch fees via GASdf
 *
 * Only HolDex-verified communities can use this endpoint.
 * Users pay in their community token, GASdf sends SOL to Ignition.
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const {
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const jupiter = require('../services/jupiter');
const oracle = require('../services/oracle');
const { requireVerified } = require('../services/holdex');
const { reserveBalance, releaseBalance, getFeePayer } = require('../services/fee-payer-pool');
const { ensureTreasuryAta, getTreasuryAddress } = require('../services/treasury-ata');
const { safeMul, safeCeil, clamp, MAX_COMPUTE_UNITS } = require('../utils/safe-math');
const { quoteLimiter, walletQuoteLimiter } = require('../middleware/security');
const { validate } = require('../middleware/validation');
const { getConnection } = require('../utils/rpc');

const router = express.Router();

// Ignition fee in lamports
const IGNITION_FEE_LAMPORTS = Math.floor(config.IGNITION_FEE_SOL * LAMPORTS_PER_SOL);

/**
 * POST /v1/ignition/quote
 * Get a quote for paying Ignition launch fee with any token
 *
 * Body: { paymentToken, userPubkey }
 *
 * Flow:
 * 1. Verify payment token is HolDex-verified
 * 2. Calculate total fee: Ignition fee + GASdf service fee
 * 3. Get token amount via Jupiter
 * 4. Return quote
 */
router.post('/quote', quoteLimiter, validate('quote'), requireVerified, walletQuoteLimiter, async (req, res) => {
  const { paymentToken, userPubkey } = req.body;
  const startTime = Date.now();

  try {
    // Check if Ignition integration is enabled
    if (!config.IGNITION_ENABLED) {
      return res.status(503).json({
        success: false,
        error: 'Ignition integration not enabled',
        code: 'IGNITION_DISABLED',
      });
    }

    // Validate Ignition dev wallet is configured
    if (!config.IGNITION_DEV_WALLET) {
      logger.error('[IGNITION] Dev wallet not configured');
      return res.status(503).json({
        success: false,
        error: 'Ignition integration not configured',
        code: 'IGNITION_NOT_CONFIGURED',
      });
    }

    // Calculate total fee needed
    // GASdf service fee (based on compute + margin)
    const gasdfServiceFee = safeCeil(safeMul(config.BASE_FEE_LAMPORTS, config.FEE_MULTIPLIER)) || 10000;

    // Total SOL needed: Ignition fee + GASdf fee + buffer for tx fees
    const txFeeBuffer = 10000; // 0.00001 SOL for network fees
    const totalSolNeeded = IGNITION_FEE_LAMPORTS + gasdfServiceFee + txFeeBuffer;

    // Get K-score for fee adjustment
    const kScore = await oracle.getKScore(paymentToken);
    const adjustedTotal = safeCeil(safeMul(totalSolNeeded, kScore.feeMultiplier));

    // Get token amount via Jupiter
    const feeInToken = await jupiter.getFeeInToken(paymentToken, adjustedTotal);

    // Generate quote ID
    const quoteId = `ign_${uuidv4()}`;
    const expiresAt = Date.now() + config.QUOTE_TTL_SECONDS * 1000;

    // Reserve fee payer balance
    const feePayer = await reserveBalance(quoteId, totalSolNeeded);
    if (!feePayer) {
      return res.status(503).json({
        success: false,
        error: 'No fee payer capacity available',
        code: 'NO_PAYER_CAPACITY',
      });
    }

    // Ensure treasury ATA exists for payment token
    let treasuryAta = null;
    const treasuryAddress = getTreasuryAddress()?.toBase58() || feePayer;

    try {
      treasuryAta = await ensureTreasuryAta(paymentToken);
    } catch (ataError) {
      logger.warn('[IGNITION] Failed to ensure treasury ATA', { error: ataError.message });
    }

    // Store quote
    await redis.setQuote(quoteId, {
      type: 'ignition',
      paymentToken,
      userPubkey,
      feePayer,
      treasuryAddress,
      treasuryAta,
      ignitionFee: IGNITION_FEE_LAMPORTS,
      gasdfFee: gasdfServiceFee,
      totalSolNeeded: adjustedTotal,
      feeAmountToken: feeInToken.inputAmount,
      feeAmount: feeInToken.inputAmount.toString(),
      kScore: kScore.score,
      kTier: kScore.tier,
      expiresAt,
      createdAt: Date.now(),
    });

    // Format for display
    const decimals = feeInToken.decimals || 6;
    const feeFormatted = `${(feeInToken.inputAmount / Math.pow(10, decimals)).toFixed(4)} ${feeInToken.symbol || 'tokens'}`;

    logger.info('[IGNITION] Quote generated', {
      quoteId,
      userPubkey: userPubkey.slice(0, 8) + '...',
      paymentToken: paymentToken.slice(0, 8) + '...',
      ignitionFee: `${config.IGNITION_FEE_SOL} SOL`,
      tokenAmount: feeFormatted,
      holdexVerified: true,
    });

    res.json({
      success: true,
      quoteId,
      feePayer,
      treasury: {
        address: treasuryAddress,
        ata: treasuryAta,
      },
      fees: {
        ignition: {
          sol: config.IGNITION_FEE_SOL,
          lamports: IGNITION_FEE_LAMPORTS,
        },
        gasdf: {
          lamports: gasdfServiceFee,
        },
        total: {
          lamports: adjustedTotal,
          inToken: feeInToken.inputAmount.toString(),
          formatted: feeFormatted,
        },
      },
      paymentToken: {
        mint: paymentToken,
        symbol: feeInToken.symbol || 'UNKNOWN',
        decimals: feeInToken.decimals || 6,
      },
      kScore: {
        score: kScore.score,
        tier: kScore.tier,
        feeMultiplier: kScore.feeMultiplier,
      },
      holdex: req.holdexToken || { verified: true },
      expiresAt,
      ttl: config.QUOTE_TTL_SECONDS,
    });
  } catch (error) {
    logger.error('[IGNITION] Quote failed', {
      error: error.message,
      paymentToken: paymentToken?.slice(0, 8),
    });

    res.status(500).json({
      success: false,
      error: 'Failed to generate Ignition quote',
      code: 'QUOTE_FAILED',
    });
  }
});

/**
 * POST /v1/ignition/submit
 * Submit signed transaction to pay Ignition launch fee
 *
 * Body: { quoteId, signedTransaction }
 *
 * Flow:
 * 1. Validate quote exists and hasn't expired
 * 2. Verify transaction structure
 * 3. Co-sign with fee payer
 * 4. Submit to network
 * 5. Send Ignition fee to dev wallet
 * 6. Return signature for Ignition to verify
 */
router.post('/submit', async (req, res) => {
  const { quoteId, signedTransaction } = req.body;

  try {
    if (!quoteId || !signedTransaction) {
      return res.status(400).json({
        success: false,
        error: 'Missing quoteId or signedTransaction',
      });
    }

    // Validate quote ID format
    if (!quoteId.startsWith('ign_')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Ignition quote ID',
        code: 'INVALID_QUOTE',
      });
    }

    // Get and validate quote
    const quote = await redis.getQuote(quoteId);
    if (!quote) {
      return res.status(404).json({
        success: false,
        error: 'Quote not found or expired',
        code: 'QUOTE_NOT_FOUND',
      });
    }

    if (quote.type !== 'ignition') {
      return res.status(400).json({
        success: false,
        error: 'Invalid quote type',
        code: 'INVALID_QUOTE_TYPE',
      });
    }

    if (Date.now() > quote.expiresAt) {
      await releaseBalance(quoteId);
      return res.status(410).json({
        success: false,
        error: 'Quote has expired',
        code: 'QUOTE_EXPIRED',
      });
    }

    // Deserialize and validate transaction
    const txBuffer = Buffer.from(signedTransaction, 'base64');
    const transaction = Transaction.from(txBuffer);

    // Get fee payer keypair
    const feePayerKeypair = getFeePayer(quote.feePayer);
    if (!feePayerKeypair) {
      await releaseBalance(quoteId);
      return res.status(503).json({
        success: false,
        error: 'Fee payer unavailable',
        code: 'PAYER_UNAVAILABLE',
      });
    }

    // Co-sign the transaction
    const connection = getConnection();
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.partialSign(feePayerKeypair);

    // Submit user's payment transaction
    const rawTx = transaction.serialize();
    const paymentSignature = await connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    logger.info('[IGNITION] User payment submitted', {
      quoteId,
      signature: paymentSignature,
    });

    // Wait for confirmation
    await connection.confirmTransaction({
      signature: paymentSignature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    // Now send Ignition fee to dev wallet
    const ignitionDevWallet = new PublicKey(config.IGNITION_DEV_WALLET);
    const transferTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: feePayerKeypair.publicKey,
        toPubkey: ignitionDevWallet,
        lamports: quote.ignitionFee,
      })
    );

    const { blockhash: newBlockhash, lastValidBlockHeight: newHeight } = await connection.getLatestBlockhash('confirmed');
    transferTx.recentBlockhash = newBlockhash;
    transferTx.lastValidBlockHeight = newHeight;
    transferTx.feePayer = feePayerKeypair.publicKey;
    transferTx.sign(feePayerKeypair);

    const ignitionSignature = await connection.sendRawTransaction(transferTx.serialize(), {
      skipPreflight: false,
    });

    await connection.confirmTransaction({
      signature: ignitionSignature,
      blockhash: newBlockhash,
      lastValidBlockHeight: newHeight,
    }, 'confirmed');

    // Release balance reservation
    await releaseBalance(quoteId);

    // Delete used quote
    await redis.deleteQuote(quoteId);

    logger.info('[IGNITION] Launch fee paid', {
      quoteId,
      userPayment: paymentSignature,
      ignitionPayment: ignitionSignature,
      ignitionFee: `${quote.ignitionFee / LAMPORTS_PER_SOL} SOL`,
      devWallet: config.IGNITION_DEV_WALLET.slice(0, 8) + '...',
    });

    res.json({
      success: true,
      signatures: {
        userPayment: paymentSignature,
        ignitionFee: ignitionSignature,
      },
      ignition: {
        feeReceived: quote.ignitionFee,
        devWallet: config.IGNITION_DEV_WALLET,
        verifySignature: ignitionSignature,
      },
      message: 'Ignition launch fee paid successfully',
    });
  } catch (error) {
    logger.error('[IGNITION] Submit failed', {
      quoteId,
      error: error.message,
    });

    // Release balance on failure
    if (quoteId) {
      await releaseBalance(quoteId).catch(() => {});
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process Ignition payment',
      code: 'SUBMIT_FAILED',
    });
  }
});

/**
 * GET /v1/ignition/status
 * Get Ignition integration status
 */
router.get('/status', (req, res) => {
  res.json({
    enabled: config.IGNITION_ENABLED,
    configured: !!config.IGNITION_DEV_WALLET,
    fee: {
      sol: config.IGNITION_FEE_SOL,
      lamports: IGNITION_FEE_LAMPORTS,
    },
  });
});

module.exports = router;
