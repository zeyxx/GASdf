const express = require('express');
const { v4: uuidv4 } = require('uuid');
const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const jupiter = require('../services/jupiter');
const helius = require('../services/helius');
const { reserveBalance, isCircuitOpen, getCircuitState } = require('../services/fee-payer-pool');
const { ensureTreasuryAta, getTreasuryAddress } = require('../services/treasury-ata');
const { clamp, MAX_COMPUTE_UNITS } = require('../utils/safe-math');
const { quoteLimiter, walletQuoteLimiter } = require('../middleware/security');
const { validate } = require('../middleware/validation');
const { quotesTotal, quoteDuration, activeQuotes } = require('../utils/metrics');
const { logQuoteCreated, logQuoteRejected } = require('../services/audit');
const { anomalyDetector } = require('../services/anomaly-detector');
const { calculateDiscountedFee } = require('../services/holder-tiers');
const { isTokenAccepted } = require('../services/token-gate');

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
    // Track activity for anomaly detection
    const clientIp = req.ip || req.headers['x-forwarded-for'];
    anomalyDetector.trackWallet(userPubkey, 'quote', clientIp).catch(() => {});
    anomalyDetector.trackIp(clientIp, 'quote').catch(() => {});

    // =========================================================================
    // SECURITY: Check circuit breaker first
    // =========================================================================
    if (isCircuitOpen()) {
      const circuitState = getCircuitState();
      logger.warn('QUOTE', 'Circuit breaker open, rejecting quote request', {
        requestId: req.requestId,
        userPubkey,
        circuitState,
      });

      logQuoteRejected({
        reason: 'Circuit breaker open',
        code: 'CIRCUIT_BREAKER_OPEN',
        userPubkey,
        ip: clientIp,
      });

      return res.status(503).json({
        error: 'Service temporarily unavailable - fee payer capacity exceeded',
        code: 'CIRCUIT_BREAKER_OPEN',
        retryAfter: Math.ceil((circuitState.closesAt - Date.now()) / 1000),
      });
    }

    // =========================================================================
    // SECURITY: Token gating - only accept verified tokens
    // =========================================================================
    const tokenCheck = await isTokenAccepted(paymentToken);
    if (!tokenCheck.accepted) {
      logger.info('QUOTE', 'Token rejected by gate', {
        requestId: req.requestId,
        paymentToken: paymentToken.slice(0, 8),
        reason: tokenCheck.reason,
        userPubkey,
      });

      logQuoteRejected({
        reason: `Token not accepted: ${tokenCheck.reason}`,
        code: 'TOKEN_NOT_ACCEPTED',
        paymentToken,
        userPubkey,
        ip: clientIp,
      });

      return res.status(400).json({
        error: 'Payment token not accepted. Use SOL, USDC, USDT, or a HolDex-verified token.',
        code: 'TOKEN_NOT_ACCEPTED',
        reason: tokenCheck.reason,
      });
    }

    // ==========================================================================
    // FEE CALCULATION - Dynamic priority fees via Helius SDK
    // ==========================================================================
    //
    // BASE_FEE = NETWORK_FEE × (1/TREASURY_RATIO) × MARKUP
    //          = 5000 × 5 × 2 = 50000 lamports (~$0.01)
    //
    // PRIORITY_FEE = Helius real-time estimate (adapts to network congestion)
    // ==========================================================================

    // Clamp compute units to valid Solana range
    const clampedCU = clamp(estimatedComputeUnits, 1, MAX_COMPUTE_UNITS);

    // Get dynamic priority fee from Helius (adapts to network conditions)
    const priorityFeeData = await helius.calculatePriorityFee(clampedCU, {
      priorityLevel: 'Medium', // Balance between speed and cost
    });
    const priorityFee = priorityFeeData.priorityFeeLamports;

    logger.debug('QUOTE', 'Priority fee calculated', {
      requestId: req.requestId,
      computeUnits: clampedCU,
      microLamportsPerCU: priorityFeeData.microLamportsPerCU,
      priorityFeeLamports: priorityFee,
    });

    // Total base fee (before holder discount)
    const baseAdjustedFee = config.BASE_FEE_LAMPORTS + priorityFee;

    // =========================================================================
    // HOLDER TIER: Apply $ASDF holder discount (floored at break-even)
    // =========================================================================
    // Estimate actual network tx cost (not service fee) for break-even calculation
    // This ensures discounts can apply while treasury still covers network costs
    const estimatedTxCost = config.NETWORK_FEE_LAMPORTS + priorityFee;
    const tierInfo = await calculateDiscountedFee(userPubkey, baseAdjustedFee, estimatedTxCost);
    const adjustedFee = tierInfo.discountedFee;

    // Get fee amount in payment token
    const feeInToken = await jupiter.getFeeInToken(paymentToken, adjustedFee);

    // Generate quote ID
    const quoteId = uuidv4();
    const expiresAt = Date.now() + config.QUOTE_TTL_SECONDS * 1000;
    const ttl = config.QUOTE_TTL_SECONDS;

    // =========================================================================
    // SECURITY: Reserve fee payer balance for this quote (mutex-protected)
    // =========================================================================
    const feePayer = await reserveBalance(quoteId, adjustedFee);
    if (!feePayer) {
      logger.warn('QUOTE', 'No fee payer capacity available', {
        requestId: req.requestId,
        userPubkey,
        feeAmount: adjustedFee,
      });

      logQuoteRejected({
        reason: 'No fee payer capacity',
        code: 'NO_PAYER_CAPACITY',
        userPubkey,
        ip: clientIp,
      });

      return res.status(503).json({
        error: 'Service temporarily unavailable - no fee payer capacity',
        code: 'NO_PAYER_CAPACITY',
        retryAfter: 30,
      });
    }

    // =========================================================================
    // ENSURE: Treasury ATA exists for payment token
    // Creates the ATA if it doesn't exist (GASdf pays creation cost)
    // =========================================================================
    let treasuryAta = null;
    const treasuryAddress = getTreasuryAddress()?.toBase58() || feePayer;

    try {
      treasuryAta = await ensureTreasuryAta(paymentToken);
      if (treasuryAta) {
        logger.debug('QUOTE', 'Treasury ATA ready', {
          requestId: req.requestId,
          mint: paymentToken.slice(0, 8),
          ata: treasuryAta.slice(0, 8),
        });
      }
    } catch (ataError) {
      logger.error('QUOTE', 'Failed to ensure treasury ATA', {
        requestId: req.requestId,
        paymentToken: paymentToken.slice(0, 8),
        error: ataError.message,
      });
      // Continue anyway - user will need to include ATA creation in their transaction
    }

    // Store quote with assigned fee payer and treasury info
    await redis.setQuote(quoteId, {
      paymentToken,
      userPubkey,
      feePayer, // Store the assigned fee payer
      treasuryAddress,
      treasuryAta: treasuryAta || null,
      feeAmount: feeInToken.inputAmount.toString(),
      feeAmountLamports: adjustedFee,
      feeAmountToken: feeInToken.inputAmount,
      tokenAcceptReason: tokenCheck.reason, // 'trusted' or 'holdex_verified'
      estimatedComputeUnits,
      expiresAt,
      createdAt: Date.now(),
    });

    logger.debug('QUOTE', 'Quote generated', {
      requestId: req.requestId,
      quoteId,
      paymentToken,
      userPubkey,
      feePayer: feePayer.slice(0, 8),
      feeAmountSol: adjustedFee,
      tokenAccepted: tokenCheck.reason,
    });

    // Audit log
    logQuoteCreated({
      quoteId,
      userPubkey,
      feePayer,
      paymentToken,
      feeAmountLamports: adjustedFee,
      tokenAccepted: tokenCheck.reason,
      ip: clientIp,
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
      feePayer, // Return the reserved fee payer
      treasury: {
        address: treasuryAddress,
        ata: treasuryAta, // Token account for fee payment (null for native SOL)
      },
      feeAmount: feeInToken.inputAmount.toString(),
      feeFormatted,
      paymentToken: {
        mint: paymentToken,
        symbol: feeInToken.symbol || 'UNKNOWN',
        decimals: feeInToken.decimals || 6,
        accepted: tokenCheck.reason, // 'diamond' or 'tier_accepted'
        tier: tokenCheck.tier,
        kScore: tokenCheck.kScore,
        kRank: tokenCheck.kRank,
        creditRating: tokenCheck.creditRating,
        // Dual-burn flywheel (Pure Golden φ-based economics)
        dualBurn: tokenCheck.ecosystemBurn
          ? {
              burnedPercent: tokenCheck.supply?.burnedPercent || 0,
              ecosystemBurnPct: tokenCheck.ecosystemBurn.ecosystemBurnPct,
              asdfBurnPct: tokenCheck.ecosystemBurn.asdfBurnPct,
              treasuryPct: tokenCheck.ecosystemBurn.treasuryPct,
              explanation: tokenCheck.ecosystemBurn.explanation,
            }
          : null,
      },
      holderTier: {
        tier: tierInfo.tier,
        emoji: tierInfo.tierEmoji,
        discountPercent: tierInfo.savingsPercent,
        maxDiscountPercent: tierInfo.maxDiscountPercent,
        savings: tierInfo.savings,
        asdfBalance: tierInfo.balance,
        nextTier: tierInfo.nextTier,
        breakEvenFee: tierInfo.breakEvenFee,
        isAtBreakEven: tierInfo.isAtBreakEven,
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
