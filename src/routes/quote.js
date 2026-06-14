const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAssociatedTokenAddress } = require('@solana/spl-token');
const { PublicKey } = require('@solana/web3.js');
const config = require('../utils/config');
const logger = require('../utils/logger');
const tokenGate = require('../services/token-gate');
const feePayer = require('../services/fee-payer');
const helius = require('../services/helius');
const jupiter = require('../services/jupiter');
const holderDiscount = require('../services/holder-discount');

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
    const computeUnits = Math.min(Math.max(estimatedComputeUnits, 1), 1_400_000);
    const priorityFeeData = await helius.calculatePriorityFee(computeUnits);
    const priorityFeeLamports = priorityFeeData.priorityFeeLamports;

    // =========================================================================
    // 6. Total fee
    // =========================================================================
    const totalFee = config.BASE_FEE_LAMPORTS + priorityFeeLamports;

    // =========================================================================
    // 7. Holder discount
    // =========================================================================
    const txCost = config.NETWORK_FEE_LAMPORTS + priorityFeeLamports;
    const tierInfo = await holderDiscount.calculateDiscountedFee(userPubkey, totalFee, txCost);
    const discountedFeeLamports = tierInfo.discountedFee;

    // =========================================================================
    // 8. Convert to payment token via Jupiter
    // =========================================================================
    const feeInToken = await jupiter.getFeeInToken(paymentToken, discountedFeeLamports);

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
      feeAmountLamports: discountedFeeLamports,
    });

    // =========================================================================
    // 11. Response
    // =========================================================================
    const decimals = feeInToken.decimals || 6;
    const feeFormatted = `${(feeInToken.inputAmount / Math.pow(10, decimals)).toFixed(decimals > 2 ? 4 : 2)} ${feeInToken.symbol || 'tokens'}`;

    res.json({
      feePayer: feePayer.getPublicKey().toBase58(),
      treasury: {
        address: treasuryPubkey.toBase58(),
        ata: treasuryAta.toBase58(),
      },
      feeAmount: feeInToken.inputAmount.toString(),
      feeFormatted,
      paymentToken: {
        mint: paymentToken,
        symbol: feeInToken.symbol || 'UNKNOWN',
        decimals,
      },
      holderTier: {
        tier: tierInfo.tier,
        discountPercent: tierInfo.discountPercent,
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
