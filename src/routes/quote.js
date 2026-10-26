const express = require('express');
const { getAssociatedTokenAddress } = require('@solana/spl-token');
const { PublicKey } = require('@solana/web3.js');
const config = require('../utils/config');
const logger = require('../utils/logger');
const tokenGate = require('../services/token-gate');
const feePayer = require('../services/fee-payer');
const helius = require('../services/helius');
const jupiter = require('../services/jupiter');
const { computeFeeBreakdown } = require('../domain/fee/fee-schedule');

const router = express.Router();

// POST /v1/quote
router.post('/', async (req, res) => {
  try {
    const { paymentToken, userPubkey, estimatedComputeUnits = 200000 } = req.body;

    // =========================================================================
    // 1. Validate input
    // =========================================================================
    if (!paymentToken || !userPubkey) {
      return res.status(400).json({
        error: 'Missing required fields: paymentToken, userPubkey',
        code: 'INVALID_INPUT',
      });
    }

    // =========================================================================
    // 2. Token gate check
    // =========================================================================
    const tokenCheck = tokenGate.isTokenAccepted(paymentToken);
    if (!tokenCheck.accepted) {
      return res.status(400).json({
        error: 'Payment token not accepted. Use USDC, USDT, or $ASDF.',
        code: 'TOKEN_NOT_ACCEPTED',
        reason: tokenCheck.reason,
      });
    }

    // =========================================================================
    // 3. Circuit breaker
    // =========================================================================
    if (feePayer.isCircuitOpen()) {
      return res.status(503).json({
        error: 'Service temporarily unavailable — fee payer capacity exceeded',
        code: 'CIRCUIT_BREAKER_OPEN',
      });
    }

    // Rate limiting is now handled globally or via stateless IP limits
    // 5. Priority fee from Helius
    // =========================================================================
    const computeUnits = Math.max(Math.floor(estimatedComputeUnits), 1);
    if (!Number.isFinite(computeUnits)) {
      return res
        .status(400)
        .json({ error: 'estimatedComputeUnits must be a number', code: 'INVALID_INPUT' });
    }
    const priorityFeeData = await helius.calculatePriorityFee(computeUnits);
    const priorityFeeLamports = priorityFeeData.priorityFeeLamports;

    // =========================================================================
    // 6. Hybrid fee: base + compute + priority (CU_CAP refuses abuse)
    // =========================================================================
    const fee = computeFeeBreakdown({
      baseFeeLamports: config.BASE_FEE_LAMPORTS,
      cuPricePerKcuLamports: config.CU_PRICE_PER_KCU_LAMPORTS,
      cuCap: config.CU_CAP,
      requestedCus: computeUnits,
      priorityFeeLamports,
    });
    if (!fee.accepted) {
      return res.status(400).json({
        error: `Compute demand exceeds relay cap (${computeUnits} CU)`,
        code: fee.code,
      });
    }
    const totalFee = fee.total;

    // =========================================================================
    // 7. Flat fee — no holder tiers, no scores (MVP decision)
    // =========================================================================
    const feeLamports = totalFee;

    // =========================================================================
    // 8. Convert to payment token via Jupiter
    // =========================================================================
    const feeInToken = await jupiter.getFeeInToken(paymentToken, feeLamports);

    // =========================================================================
    // 9. Treasury ATA
    // =========================================================================
    const treasuryPubkey = config.TREASURY_ADDRESS
      ? new PublicKey(config.TREASURY_ADDRESS)
      : feePayer.getPublicKey();
    const mintPubkey = new PublicKey(paymentToken);
    const treasuryAta = await getAssociatedTokenAddress(mintPubkey, treasuryPubkey);

    // Quotes are no longer stored off-chain. The client builds the Pinocchio instruction directly.

    logger.info('QUOTE', 'Quote generated', {
      paymentToken: paymentToken.slice(0, 8),
      userPubkey: userPubkey.slice(0, 8),
      feeAmountLamports: feeLamports,
    });

    // =========================================================================
    // 11. Response
    // =========================================================================
    const decimals = feeInToken.decimals || 6;
    const feeFormatted = `${(feeInToken.inputAmount / Math.pow(10, decimals)).toFixed(decimals > 2 ? 4 : 2)} ${feeInToken.symbol || 'tokens'}`;
    const expiresAt = new Date(Date.now() + config.QUOTE_TTL_SECONDS * 1000).toISOString();

    res.json({
      feePayer: feePayer.getPublicKey().toBase58(),
      treasury: {
        address: treasuryPubkey.toBase58(),
        ata: treasuryAta.toBase58(),
      },
      feeAmount: feeInToken.inputAmount.toString(),
      feeFormatted,
      feeBreakdown: {
        base: fee.base,
        cuCharge: fee.cuCharge,
        priority: fee.priority,
        cus: fee.cus,
      },
      paymentToken: {
        mint: paymentToken,
        symbol: feeInToken.symbol || 'UNKNOWN',
        decimals,
      },
      expiresAt,
      ttl: config.QUOTE_TTL_SECONDS,
    });
  } catch (error) {
    logger.error('QUOTE', 'Failed to generate quote', { error: error.message });
    res.status(500).json({
      error: 'Failed to generate quote',
      code: 'QUOTE_FAILED',
    });
  }
});

module.exports = router;
