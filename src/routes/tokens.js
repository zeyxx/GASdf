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
const holdex = require('../services/holdex');
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
    note: 'HolDex-verified community tokens are also accepted',
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

    // Process SPL tokens in parallel (batch of 10 for rate limiting)
    const tokensToProcess = tokenAccounts.value
      .filter((ta) => {
        const amount = parseInt(ta.account.data.parsed.info.tokenAmount.amount);
        return amount > 0;
      })
      .map((ta) => ({
        mint: ta.account.data.parsed.info.mint,
        amount: parseInt(ta.account.data.parsed.info.tokenAmount.amount),
        decimals: ta.account.data.parsed.info.tokenAmount.decimals,
      }));

    // Process in batches
    const BATCH_SIZE = 10;
    for (let i = 0; i < tokensToProcess.length; i += BATCH_SIZE) {
      const batch = tokensToProcess.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async (token) => {
          try {
            // Check if Diamond token (fast path)
            if (isDiamondToken(token.mint)) {
              const tokenData = await isTokenAccepted(token.mint);
              const feeData = await jupiter.getFeeInToken(token.mint, discountedFee);
              return {
                category: 'diamond',
                data: {
                  mint: token.mint,
                  symbol: feeData.symbol || 'UNKNOWN',
                  name: feeData.name || token.mint.slice(0, 8),
                  decimals: token.decimals,
                  balance: token.amount,
                  balanceFormatted: (token.amount / Math.pow(10, token.decimals)).toFixed(4),
                  logoURI: feeData.logoURI || null,
                  // HolDex data
                  kScore: 100,
                  tier: 'Diamond',
                  tierIcon: '💎',
                  creditRating: tokenData.creditRating || { grade: 'A1', risk: 'minimal' },
                  // Dual-burn (for $ASDF)
                  burnedPercent: tokenData.supply?.burnedPercent || 0,
                  ecosystemBurn: tokenData.ecosystemBurn || null,
                  // Fee estimate
                  feeAmount: feeData.inputAmount,
                  feeFormatted: `${(feeData.inputAmount / Math.pow(10, token.decimals)).toFixed(4)} ${feeData.symbol || ''}`,
                  accepted: true,
                  reason: 'diamond',
                },
              };
            }

            // Get HolDex data for non-Diamond tokens
            const holdexData = await holdex.getToken(token.mint);
            const isAccepted = holdex.ACCEPTED_TIERS.has(holdexData.tier);

            // Get fee estimate (only if accepted)
            let feeData = null;
            if (isAccepted) {
              try {
                feeData = await jupiter.getFeeInToken(token.mint, discountedFee);
              } catch {
                // Token might not have Jupiter liquidity
              }
            }

            // Get token metadata from Jupiter if available
            let symbol = 'UNKNOWN';
            let name = token.mint.slice(0, 8);
            let logoURI = null;

            if (feeData) {
              symbol = feeData.symbol || symbol;
              name = feeData.name || name;
              logoURI = feeData.logoURI || null;
            }

            const tokenInfo = {
              mint: token.mint,
              symbol,
              name,
              decimals: token.decimals,
              balance: token.amount,
              balanceFormatted: (token.amount / Math.pow(10, token.decimals)).toFixed(4),
              logoURI,
              // HolDex data
              kScore: holdexData.kScore,
              tier: holdexData.tier,
              tierIcon: holdexData.kRank?.icon || '🔩',
              creditRating: holdexData.creditRating,
              conviction: holdexData.conviction || null,
              // Dual-burn flywheel
              burnedPercent: holdexData.supply?.burnedPercent || 0,
              ecosystemBurn: holdexData.ecosystemBurn || null,
              // Fee estimate
              feeAmount: feeData?.inputAmount || null,
              feeFormatted: feeData
                ? `${(feeData.inputAmount / Math.pow(10, token.decimals)).toFixed(4)} ${symbol}`
                : null,
              accepted: isAccepted,
              reason: isAccepted ? 'tier_accepted' : 'tier_rejected',
              rejectionReason: !isAccepted
                ? `K-score ${holdexData.kScore} < 50 (${holdexData.tier})`
                : null,
            };

            return {
              category: isAccepted ? 'accepted' : 'notEligible',
              data: tokenInfo,
            };
          } catch (error) {
            logger.warn('TOKENS', 'Failed to process token', {
              mint: token.mint.slice(0, 8),
              error: error.message,
            });
            return null;
          }
        })
      );

      // Categorize results
      for (const result of results) {
        if (!result) continue;
        if (result.category === 'diamond') diamond.push(result.data);
        else if (result.category === 'accepted') accepted.push(result.data);
        else notEligible.push(result.data);
      }
    }

    // =========================================================================
    // 5. Sort categories
    // =========================================================================
    // Diamond: by symbol
    diamond.sort((a, b) => a.symbol.localeCompare(b.symbol));
    // Accepted: by K-score (highest first), then by balance
    accepted.sort((a, b) => b.kScore - a.kScore || b.balance - a.balance);
    // Not eligible: by K-score (highest first - closest to acceptance)
    notEligible.sort((a, b) => b.kScore - a.kScore);

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
          description: 'HolDex K-score ≥ 50 (Bronze+)',
          tokens: accepted,
        },
        notEligible: {
          label: '❌ Not Eligible',
          description: 'K-score < 50 - upgrade needed',
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

// =============================================================================
// HOLDEX TOKENS - List verified tokens from HolDex
// =============================================================================

/**
 * GET /tokens/holdex
 * Get list of HolDex verified tokens (K-score >= 50)
 * Sorted by K-score descending
 */
router.get('/holdex', globalLimiter, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 200);
    const result = await holdex.getAllTokens(limit);

    if (!result.success) {
      return res.status(503).json({
        error: 'HolDex temporarily unavailable',
        code: 'HOLDEX_UNAVAILABLE',
      });
    }

    // Filter and enrich tokens
    const tokens = result.tokens
      .filter((t) => t.kScore >= 50) // Only accepted tiers
      .map((t) => ({
        mint: t.mint,
        symbol: t.symbol,
        name: t.name,
        logoURI: t.logoURI || null,
        kScore: t.kScore,
        tier: t.kRank?.tier || holdex.getKRank(t.kScore).tier,
        tierIcon: t.kRank?.icon || holdex.getKRank(t.kScore).icon,
        creditRating: t.creditRating || holdex.getCreditRating(t.kScore),
        conviction: t.conviction || null,
        burnedPercent: t.supply?.burnedPercent || 0,
        hasCommunityUpdate: t.hasCommunityUpdate || false,
      }))
      .sort((a, b) => b.kScore - a.kScore);

    res.json({
      tokens,
      count: tokens.length,
      source: 'holdex',
    });
  } catch (error) {
    logger.error('TOKENS', 'HolDex tokens fetch failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch HolDex tokens' });
  }
});

module.exports = router;
