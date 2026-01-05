const express = require('express');
const { PublicKey } = require('@solana/web3.js');
const { getAccount, getAssociatedTokenAddress } = require('@solana/spl-token');
const config = require('../utils/config');
const redis = require('../utils/redis');
const rpc = require('../utils/rpc');
const logger = require('../utils/logger');
const { getTreasuryAddress } = require('../services/treasury-ata');
const { getHolderTier } = require('../services/holder-tiers');

const router = express.Router();

/**
 * Get real on-chain treasury balances
 */
async function getOnChainTreasuryBalances() {
  const treasury = getTreasuryAddress();
  if (!treasury) {
    return { sol: 0, asdf: 0 };
  }

  try {
    const connection = rpc.getConnection();

    // Get SOL balance
    const solBalance = await connection.getBalance(treasury);

    // Get $ASDF balance
    let asdfBalance = 0;
    try {
      const asdfMint = new PublicKey(config.ASDF_MINT);
      const asdfAta = await getAssociatedTokenAddress(asdfMint, treasury);
      const asdfAccount = await getAccount(connection, asdfAta);
      asdfBalance = Number(asdfAccount.amount);
    } catch (e) {
      // No ASDF account or zero balance
    }

    return { sol: solBalance, asdf: asdfBalance };
  } catch (error) {
    logger.error('STATS', 'Failed to get on-chain balances', { error: error.message });
    return { sol: 0, asdf: 0 };
  }
}

/**
 * GET /stats
 * Get public burn and treasury statistics
 */
router.get('/', async (req, res) => {
  try {
    const [stats, treasuryBalance, onChainBalances] = await Promise.all([
      redis.getStats(),
      redis.getTreasuryBalance(),
      getOnChainTreasuryBalances(),
    ]);

    res.json({
      // Burn stats
      totalBurned: stats.burnTotal,
      totalTransactions: stats.txCount,
      burnedFormatted: formatAsdf(stats.burnTotal),

      // Treasury stats (80/20 model)
      treasury: {
        // Redis-tracked balance (internal accounting)
        trackedBalance: treasuryBalance,
        trackedBalanceFormatted: formatSol(treasuryBalance),
        // On-chain balances (source of truth)
        onChain: {
          sol: onChainBalances.sol,
          solFormatted: formatSol(onChainBalances.sol),
          asdf: onChainBalances.asdf,
          asdfFormatted: formatAsdf(onChainBalances.asdf),
        },
        model: '80/20',
        burnRatio: config.BURN_RATIO,
        treasuryRatio: config.TREASURY_RATIO,
      },
    });
  } catch (error) {
    logger.error('STATS', 'Failed to get stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * GET /stats/wallet/:address
 * Get wallet's on-chain stats + burn contribution
 * ON-CHAIN IS TRUTH - fetches real $ASDF balance and calculates tier
 */
router.get('/wallet/:address', async (req, res) => {
  try {
    const { address } = req.params;

    // Basic Solana address validation (32-44 chars, base58)
    if (!address || address.length < 32 || address.length > 44) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Fetch on-chain data + off-chain stats in parallel
    const [tierInfo, walletStats, globalStats, burnerCount] = await Promise.all([
      getHolderTier(address), // ON-CHAIN: real $ASDF balance + tier calculation
      redis.getWalletBurnStats(address),
      redis.getStats(),
      redis.getBurnerCount(),
    ]);

    // Calculate contribution percentage
    const contributionPercent =
      globalStats.burnTotal > 0 ? (walletStats.totalBurned / globalStats.burnTotal) * 100 : 0;

    res.json({
      wallet: address,
      // ON-CHAIN DATA (source of truth)
      onChain: {
        asdfBalance: tierInfo.balance,
        asdfBalanceFormatted: tierInfo.balance.toLocaleString('en-US', {
          maximumFractionDigits: 2,
        }),
        circulatingSupply: tierInfo.circulating,
        sharePercent: tierInfo.sharePercent,
      },
      // HOLDER TIER (calculated from on-chain balance)
      tier: {
        name: tierInfo.tier,
        emoji: tierInfo.emoji,
        discountPercent: tierInfo.discountPercent,
      },
      // BURN CONTRIBUTION (off-chain tracking)
      burns: {
        totalBurned: walletStats.totalBurned,
        burnedFormatted: formatAsdf(walletStats.totalBurned),
        txCount: walletStats.txCount,
        rank: walletStats.rank,
        totalBurners: burnerCount,
        contributionPercent: contributionPercent.toFixed(4),
      },
      // Legacy fields for backwards compat
      asdfBalance: tierInfo.balance,
      discountPercent: tierInfo.discountPercent,
    });
  } catch (error) {
    logger.error('STATS', 'Failed to get wallet stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get wallet stats' });
  }
});

/**
 * GET /stats/leaderboard
 * Get burn leaderboard (top contributors)
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const [leaderboard, globalStats, burnerCount] = await Promise.all([
      redis.getBurnLeaderboard(limit),
      redis.getStats(),
      redis.getBurnerCount(),
    ]);

    res.json({
      leaderboard: leaderboard.map((entry) => ({
        ...entry,
        burnedFormatted: formatAsdf(entry.totalBurned),
        walletShort: `${entry.wallet.slice(0, 4)}...${entry.wallet.slice(-4)}`,
        contributionPercent:
          globalStats.burnTotal > 0
            ? ((entry.totalBurned / globalStats.burnTotal) * 100).toFixed(2)
            : '0.00',
      })),
      totalBurners: burnerCount,
      totalBurned: globalStats.burnTotal,
      totalBurnedFormatted: formatAsdf(globalStats.burnTotal),
    });
  } catch (error) {
    logger.error('STATS', 'Failed to get leaderboard', { error: error.message });
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

/**
 * GET /stats/treasury
 * Get detailed treasury information
 */
router.get('/treasury', async (req, res) => {
  try {
    const [balance, history] = await Promise.all([
      redis.getTreasuryBalance(),
      redis.getTreasuryHistory(20),
    ]);

    res.json({
      balance,
      balanceFormatted: formatSol(balance),
      model: {
        name: '80/20 Treasury Model',
        description: '80% of fees burn $ASDF, 20% fund operations',
        burnRatio: config.BURN_RATIO,
        treasuryRatio: config.TREASURY_RATIO,
      },
      recentEvents: history,
    });
  } catch (error) {
    logger.error('STATS', 'Failed to get treasury stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get treasury stats' });
  }
});

/**
 * GET /stats/burns
 * Get verifiable burn proofs (on-chain transparency)
 */
router.get('/burns', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const { proofs, totalCount } = await redis.getBurnProofs(limit);

    res.json({
      burns: proofs.map((proof) => ({
        ...proof,
        amountFormatted: formatAsdf(proof.amountBurned),
        solFormatted: formatSol(proof.solAmount),
        treasuryFormatted: formatSol(proof.treasuryAmount),
        age: getTimeAgo(proof.timestamp),
      })),
      totalBurns: totalCount,
      verification: {
        message: 'All burns are verifiable on-chain via Solscan',
        howToVerify: 'Click explorerUrl to see the burn transaction on Solana',
      },
    });
  } catch (error) {
    logger.error('STATS', 'Failed to get burn proofs', { error: error.message });
    res.status(500).json({ error: 'Failed to get burn proofs' });
  }
});

/**
 * GET /stats/burns/:signature
 * Verify a specific burn by signature
 */
router.get('/burns/:signature', async (req, res) => {
  try {
    const { signature } = req.params;

    // Validate signature format (base58, 87-88 chars)
    if (!signature || signature.length < 80 || signature.length > 90) {
      return res.status(400).json({ error: 'Invalid signature format' });
    }

    const proof = await redis.getBurnProofBySignature(signature);

    if (!proof) {
      return res.status(404).json({
        error: 'Burn proof not found',
        suggestion: 'This signature may not be a GASdf burn transaction',
      });
    }

    res.json({
      verified: true,
      proof: {
        ...proof,
        amountFormatted: formatAsdf(proof.amountBurned),
        solFormatted: formatSol(proof.solAmount),
        treasuryFormatted: formatSol(proof.treasuryAmount),
        age: getTimeAgo(proof.timestamp),
      },
      verification: {
        message: 'This burn is verified and recorded by GASdf',
        explorerUrl: proof.explorerUrl,
        swapExplorerUrl: `https://solscan.io/tx/${proof.swapSignature}`,
      },
    });
  } catch (error) {
    logger.error('STATS', 'Failed to verify burn', { error: error.message });
    res.status(500).json({ error: 'Failed to verify burn' });
  }
});

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAsdf(amount) {
  // $ASDF has 6 decimals
  const decimals = 6;
  const formatted = (amount / Math.pow(10, decimals)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} $asdfasdfa`;
}

function formatSol(lamports) {
  const sol = lamports / 1e9;
  return `${sol.toLocaleString('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })} SOL`;
}

module.exports = router;
