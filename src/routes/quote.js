const express = require('express');
const { v4: uuidv4 } = require('uuid');
const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const jupiter = require('../services/jupiter');
const oracle = require('../services/oracle');
const { getFeePayerPublicKey } = require('../services/signer');
const { quoteLimiter, walletQuoteLimiter } = require('../middleware/security');
const { validate } = require('../middleware/validation');
const { quotesTotal, quoteDuration, activeQuotes } = require('../utils/metrics');

const router = express.Router();

// Apply rate limiting (IP-based first, then wallet-based)
router.use(quoteLimiter);

/**
 * POST /quote
 * Get a fee quote for a gasless transaction
 */
router.post('/', validate('quote'), walletQuoteLimiter, async (req, res) => {
  const { paymentToken, userPubkey, estimatedComputeUnits = 200000 } = req.body;
  const startTime = process.hrtime.bigint();

  try {
    // Calculate base fee in lamports
    const priorityFee = Math.ceil(estimatedComputeUnits * 0.000001 * 1e9);
    const baseFee = config.BASE_FEE_LAMPORTS + priorityFee;

    // Get K-score for payment token
    const kScore = await oracle.getKScore(paymentToken);

    // Apply K-score multiplier and profit margin
    const adjustedFee = Math.ceil(baseFee * config.FEE_MULTIPLIER * kScore.feeMultiplier);

    // Get fee amount in payment token
    const feeInToken = await jupiter.getFeeInToken(paymentToken, adjustedFee);

    // Generate quote ID
    const quoteId = uuidv4();
    const expiresAt = Date.now() + config.QUOTE_TTL_SECONDS * 1000;
    const ttl = config.QUOTE_TTL_SECONDS;

    // Store quote
    await redis.setQuote(quoteId, {
      paymentToken,
      userPubkey,
      feeAmountLamports: adjustedFee,
      feeAmountToken: feeInToken.inputAmount,
      kScore: kScore.score,
      kTier: kScore.tier,
      estimatedComputeUnits,
      expiresAt,
      createdAt: Date.now(),
    });

    logger.debug('QUOTE', 'Quote generated', {
      requestId: req.requestId,
      quoteId,
      paymentToken,
      userPubkey,
      feeAmountSol: adjustedFee,
      kTier: kScore.tier,
    });

    // Record success metrics
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    quotesTotal.inc({ status: 'success' });
    quoteDuration.observe({ status: 'success' }, duration);
    activeQuotes.inc();

    // Format fee for display
    const decimals = feeInToken.decimals || 6;
    const feeFormatted = `${(feeInToken.inputAmount / Math.pow(10, decimals)).toFixed(decimals > 2 ? 4 : 2)} ${feeInToken.symbol || 'tokens'}`;

    res.json({
      quoteId,
      feePayer: getFeePayerPublicKey().toBase58(),
      feeAmount: feeInToken.inputAmount.toString(),
      feeFormatted,
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
      expiresAt,
      ttl,
    });
  } catch (error) {
    // Record error metrics
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    quotesTotal.inc({ status: 'error' });
    quoteDuration.observe({ status: 'error' }, duration);

    logger.error('QUOTE', 'Failed to generate quote', {
      requestId: req.requestId,
      paymentToken,
      error: error.message,
    });

    // Check if it's a circuit breaker error
    const isCircuitOpen = error.code === 'CIRCUIT_OPEN';

    res.status(isCircuitOpen ? 503 : 500).json({
      error: isCircuitOpen ? 'Service temporarily unavailable' : 'Failed to generate quote',
      code: isCircuitOpen ? 'SERVICE_UNAVAILABLE' : 'QUOTE_FAILED',
      requestId: req.requestId,
    });
  }
});

module.exports = router;
