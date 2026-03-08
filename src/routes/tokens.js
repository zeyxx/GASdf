const express = require('express');
const { PublicKey } = require('@solana/web3.js');
const logger = require('../utils/logger');
const rpc = require('../utils/rpc');
const config = require('../utils/config');
const { scoreLimiter, globalLimiter } = require('../middleware/security');
const { getAllTiers, getHolderTier, calculateDiscountedFee } = require('../services/holder-tiers');
const {
  getAcceptedTokensList,
  isTokenAccepted,
  isDiamondToken,
} = require('../services/token-gate');
const jupiter = require('../services/jupiter');
const helius = require('../services/helius');

const router = express.Router();

/**
 * GET /tokens
 * Get list of supported payment tokens (trusted tokens)
 * HolDex-verified tokens are also accepted but not listed here
 */
router.get('/', (req, res) => {
  res.json({
    tokens: getAcceptedTokensList(),
    note: 'Accepted payment tokens: USDC, USDT, $ASDF',
  });
});

/**
 * GET /tokens/:mint/check
 * Check if a token is accepted for payment
 */
router.get('/:mint/check', scoreLimiter, async (req, res) => {
  try {
    const { mint } = req.params;

    // Validate mint address format (base58, 32-44 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return res.status(400).json({ error: 'Invalid mint address format' });
    }

    const result = await isTokenAccepted(mint);

    res.json({
      mint,
      accepted: result.accepted,
      reason: result.reason,
    });
  } catch (error) {
    logger.error('TOKENS', 'Token check failed', { mint: req.params.mint, error: error.message });
    res.status(500).json({ error: 'Failed to check token' });
  }
});

/**
 * GET /tokens/tiers
 * Get $ASDF holder tier structure
 */
router.get('/tiers', (req, res) => {
  res.json({
    tiers: getAllTiers(),
    description: 'Hold $ASDF to get fee discounts. The more you hold, the lower your fees.',
  });
});

/**
 * GET /tokens/tiers/:wallet
 * Get holder tier for a specific wallet
 */
router.get('/tiers/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;

    // Validate wallet address format
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    const tierInfo = await getHolderTier(wallet);

    res.json({
      wallet,
      tier: tierInfo.tier,
      emoji: tierInfo.emoji,
      asdfBalance: tierInfo.balance,
      sharePercent: tierInfo.sharePercent,
      circulating: tierInfo.circulating,
      discountPercent: tierInfo.discountPercent,
    });
  } catch (error) {
    logger.error('TOKENS', 'Tier lookup failed', {
      wallet: req.params.wallet,
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to get tier info' });
  }
});

// =============================================================================
// WALLET TOKENS - Fetch user's tokens with HolDex enrichment + fee estimates
// =============================================================================

/**
 * GET /tokens/wallet/:pubkey
 * Get all tokens held by a wallet, enriched with HolDex data and fee estimates
 *
 * Returns tokens categorized into:
 * - diamond: Always accepted (SOL, USDC, USDT, etc.)
 * - accepted: K-score >= 50 (Bronze+)
 * - notEligible: K-score < 50 (Copper, Iron, Rust)
 *
 * Each token includes:
 * - Basic info (mint, symbol, balance)
 * - HolDex data (K-score, tier, conviction, burn%)
 * - Fee estimate (how much fee in this token)
 */
router.get('/wallet/:pubkey', globalLimiter, async (req, res) => {
  const startTime = Date.now();

  try {
    const { pubkey } = req.params;

    // Validate wallet address format
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pubkey)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    const walletPubkey = new PublicKey(pubkey);

    // =========================================================================
    // 1. Fetch all token accounts for the wallet via RPC
    // =========================================================================
    const connection = rpc.getConnection();
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });

    logger.debug('TOKENS', 'Fetched token accounts', {
      wallet: pubkey.slice(0, 8),
      count: tokenAccounts.value.length,
    });

    // =========================================================================
    // 2. Get holder tier info for discount calculation
    // =========================================================================
    const holderTier = await getHolderTier(pubkey);

    // =========================================================================
    // 3. Get base fee for estimates
    // =========================================================================
    const priorityFeeData = await helius.calculatePriorityFee(200000, {
      priorityLevel: 'Medium',
    });
    const baseFee = config.BASE_FEE_LAMPORTS + priorityFeeData.priorityFeeLamports;
    const estimatedTxCost = config.NETWORK_FEE_LAMPORTS + priorityFeeData.priorityFeeLamports;
    const tierInfo = await calculateDiscountedFee(pubkey, baseFee, estimatedTxCost);
    const discountedFee = tierInfo.discountedFee;

    // =========================================================================
    // 4. Process each token with balance > 0
    // =========================================================================
    const diamond = [];
    const accepted = [];
    const notEligible = [];

    // Add native SOL balance
    const solBalance = await rpc.getBalance(walletPubkey);
    if (solBalance > 0) {
      const solFee = await jupiter.getFeeInToken(
        'So11111111111111111111111111111111111111112',
        discountedFee
      );
      diamond.push({
        mint: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        balance: solBalance,
        balanceFormatted: (solBalance / 1e9).toFixed(4),
        logoURI:
          'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
        // HolDex data
        kScore: 100,
        tier: 'Diamond',
        tierIcon: '💎',
        creditRating: { grade: 'A1', label: 'Native', risk: 'minimal' },
        // Fee estimate
        feeAmount: solFee.inputAmount,
        feeFormatted: `${(solFee.inputAmount / 1e9).toFixed(6)} SOL`,
        accepted: true,
        reason: 'native',
      });
    }

    // Process SPL tokens — whitelist only, no external calls
    const tokensToProcess = tokenAccounts.value
      .filter((ta) => parseInt(ta.account.data.parsed.info.tokenAmount.amount) > 0)
      .map((ta) => ({
        mint: ta.account.data.parsed.info.mint,
        amount: parseInt(ta.account.data.parsed.info.tokenAmount.amount),
        decimals: ta.account.data.parsed.info.tokenAmount.decimals,
      }));

    await Promise.all(
      tokensToProcess.map(async (token) => {
        try {
          if (isDiamondToken(token.mint)) {
            let feeData = null;
            try {
              feeData = await jupiter.getFeeInToken(token.mint, discountedFee);
            } catch {
              // Token might not have Jupiter liquidity
            }
            diamond.push({
              mint: token.mint,
              symbol: feeData?.symbol || 'UNKNOWN',
              decimals: token.decimals,
              balance: token.amount,
              balanceFormatted: (token.amount / Math.pow(10, token.decimals)).toFixed(4),
              tier: 'Diamond',
              feeAmount: feeData?.inputAmount || null,
              feeFormatted: feeData
                ? `${(feeData.inputAmount / Math.pow(10, token.decimals)).toFixed(4)} ${feeData.symbol || ''}`
                : null,
              accepted: true,
              reason: 'whitelisted',
            });
          } else {
            // Phase 0: all non-whitelist tokens are not eligible
            notEligible.push({
              mint: token.mint,
              decimals: token.decimals,
              balance: token.amount,
              balanceFormatted: (token.amount / Math.pow(10, token.decimals)).toFixed(4),
              accepted: false,
              reason: 'not_whitelisted',
            });
          }
        } catch (error) {
          logger.warn('TOKENS', 'Failed to process token', {
            mint: token.mint.slice(0, 8),
            error: error.message,
          });
        }
      })
    );

    // =========================================================================
    // 5. Sort categories
    // =========================================================================
    diamond.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''));
    notEligible.sort((a, b) => b.balance - a.balance);

    const elapsed = Date.now() - startTime;
    logger.info('TOKENS', 'Wallet tokens fetched', {
      wallet: pubkey.slice(0, 8),
      diamond: diamond.length,
      accepted: accepted.length,
      notEligible: notEligible.length,
      elapsed: `${elapsed}ms`,
    });

    res.json({
      wallet: pubkey,
      // Holder tier info
      holderTier: {
        tier: holderTier.tier,
        emoji: holderTier.emoji,
        discountPercent: tierInfo.savingsPercent,
        asdfBalance: holderTier.balance,
      },
      // Fee info
      baseFeeLatmports: baseFee,
      discountedFeeLamports: discountedFee,
      // Token categories
      categories: {
        diamond: {
          label: '💎 Diamond Tier',
          description: 'Always accepted - deep liquidity tokens',
          tokens: diamond,
        },
        accepted: {
          label: '✅ Accepted',
          description: 'Whitelist accepted tokens',
          tokens: accepted,
        },
        notEligible: {
          label: '❌ Not Eligible',
          description: 'Not in whitelist (USDC, USDT, $ASDF only)',
          tokens: notEligible,
        },
      },
      // Summary
      summary: {
        totalTokens: diamond.length + accepted.length + notEligible.length,
        acceptedCount: diamond.length + accepted.length,
        notEligibleCount: notEligible.length,
      },
      elapsed: `${elapsed}ms`,
    });
  } catch (error) {
    logger.error('TOKENS', 'Wallet tokens fetch failed', {
      wallet: req.params.pubkey?.slice(0, 8),
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to fetch wallet tokens' });
  }
});


module.exports = router;
