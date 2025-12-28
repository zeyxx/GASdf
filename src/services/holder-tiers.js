/**
 * $ASDF Holder Tier System
 *
 * Provides fee discounts based on $ASDF holdings.
 * The more $ASDF you hold, the lower your fees.
 *
 * Philosophy:
 * - Everyone contributes (no 100% free tier)
 * - 80/20 burn/treasury ratio maintained at all tiers
 * - Creates buy pressure for $ASDF
 * - Rewards long-term believers
 */
const { PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');
const config = require('../utils/config');
const { getConnection } = require('../utils/rpc');
const { logger } = require('../utils/logger');

// $ASDF has 6 decimals
const ASDF_DECIMALS = 6;
const ASDF_UNIT = Math.pow(10, ASDF_DECIMALS);

/**
 * Tier definitions
 * Each tier has a minimum $ASDF holding and a fee discount percentage
 */
const TIERS = [
  { name: 'WHALE', minHolding: 5_000_000, discount: 0.95, emoji: '🐋' },
  { name: 'OG', minHolding: 1_000_000, discount: 0.85, emoji: '👑' },
  { name: 'DEGEN', minHolding: 500_000, discount: 0.70, emoji: '🎰' },
  { name: 'BELIEVER', minHolding: 100_000, discount: 0.50, emoji: '💎' },
  { name: 'HOLDER', minHolding: 10_000, discount: 0.25, emoji: '🙌' },
  { name: 'NORMIE', minHolding: 0, discount: 0, emoji: '👤' },
];

// Cache for balance lookups (5 minute TTL)
const balanceCache = new Map();
const BALANCE_CACHE_TTL = 300000; // 5 minutes

/**
 * Get $ASDF balance for a wallet
 * @param {string} walletAddress - User's wallet public key
 * @returns {Promise<number>} - $ASDF balance in whole units
 */
async function getAsdfBalance(walletAddress) {
  if (!walletAddress) return 0;

  // Check cache first
  const cached = balanceCache.get(walletAddress);
  if (cached && Date.now() - cached.timestamp < BALANCE_CACHE_TTL) {
    return cached.balance;
  }

  try {
    const connection = getConnection();
    const wallet = new PublicKey(walletAddress);
    const asdfMint = new PublicKey(config.ASDF_MINT);

    // Get the associated token account for $ASDF
    const ata = await getAssociatedTokenAddress(asdfMint, wallet);

    // Get token account balance
    const accountInfo = await connection.getTokenAccountBalance(ata);
    const balance = parseInt(accountInfo.value.amount) / ASDF_UNIT;

    // Cache the result
    balanceCache.set(walletAddress, { balance, timestamp: Date.now() });

    logger.debug('[HOLDER-TIERS] Balance checked', {
      wallet: walletAddress.slice(0, 8) + '...',
      balance: balance.toLocaleString(),
    });

    return balance;
  } catch (error) {
    // Account doesn't exist or error - assume 0 balance
    if (error.message?.includes('could not find account')) {
      balanceCache.set(walletAddress, { balance: 0, timestamp: Date.now() });
      return 0;
    }

    logger.warn('[HOLDER-TIERS] Balance check failed', {
      wallet: walletAddress.slice(0, 8) + '...',
      error: error.message,
    });

    // In dev mode, return 0; in prod, we could fail open or closed
    return 0;
  }
}

/**
 * Get tier for a given $ASDF balance
 * @param {number} balance - $ASDF balance in whole units
 * @returns {Object} - Tier object with name, discount, and emoji
 */
function getTierForBalance(balance) {
  for (const tier of TIERS) {
    if (balance >= tier.minHolding) {
      return tier;
    }
  }
  return TIERS[TIERS.length - 1]; // NORMIE
}

/**
 * Get holder tier and discount for a wallet
 * @param {string} walletAddress - User's wallet public key
 * @returns {Promise<Object>} - Tier info with discount
 */
async function getHolderTier(walletAddress) {
  const balance = await getAsdfBalance(walletAddress);
  const tier = getTierForBalance(balance);

  return {
    tier: tier.name,
    emoji: tier.emoji,
    balance,
    discount: tier.discount,
    discountPercent: Math.round(tier.discount * 100),
    nextTier: getNextTier(balance),
  };
}

/**
 * Get info about the next tier up
 * @param {number} currentBalance - Current $ASDF balance
 * @returns {Object|null} - Next tier info or null if at max
 */
function getNextTier(currentBalance) {
  // Find current tier index
  let currentIndex = TIERS.length - 1;
  for (let i = 0; i < TIERS.length; i++) {
    if (currentBalance >= TIERS[i].minHolding) {
      currentIndex = i;
      break;
    }
  }

  // If already at top tier, no next tier
  if (currentIndex === 0) {
    return null;
  }

  const nextTier = TIERS[currentIndex - 1];
  return {
    name: nextTier.name,
    emoji: nextTier.emoji,
    minHolding: nextTier.minHolding,
    discount: nextTier.discount,
    needed: nextTier.minHolding - currentBalance,
  };
}

/**
 * Calculate minimum fee to ensure treasury breaks even
 *
 * Treasury receives 20% of fee, and must cover transaction costs.
 * Formula: minFee = txCost / treasuryRatio
 *
 * @param {number} txCost - Estimated transaction cost in lamports
 * @returns {number} - Minimum fee to break even
 */
function calculateBreakEvenFee(txCost = 5000) {
  const TREASURY_RATIO = 0.20;
  return Math.ceil(txCost / TREASURY_RATIO);
}

// Default break-even fee (5000 lamports tx cost → 25000 min fee)
const DEFAULT_BREAK_EVEN_FEE = calculateBreakEvenFee(5000);

/**
 * Apply tier discount to a fee amount
 *
 * IMPORTANT: Fee is floored at break-even point to ensure treasury neutrality.
 * Even whales must pay enough to cover transaction costs.
 *
 * @param {number} baseFee - Original fee in lamports
 * @param {number} discount - Discount percentage (0-0.95)
 * @param {number} txCost - Transaction cost in lamports (for break-even calc)
 * @returns {number} - Discounted fee in lamports (never below break-even)
 */
function applyDiscount(baseFee, discount, txCost = 5000) {
  // Calculate break-even floor for this transaction
  const breakEvenFee = calculateBreakEvenFee(txCost);

  if (discount <= 0) return Math.max(baseFee, breakEvenFee);
  if (discount >= 1) discount = 0.95; // Cap at 95%

  const discountedFee = Math.ceil(baseFee * (1 - discount));

  // Floor at break-even to ensure treasury neutrality
  return Math.max(discountedFee, breakEvenFee);
}

/**
 * Calculate fee with holder discount
 * @param {string} walletAddress - User's wallet public key
 * @param {number} baseFee - Original fee in lamports
 * @param {number} txCost - Estimated transaction cost (for break-even floor)
 * @returns {Promise<Object>} - Fee info with tier and discount applied
 */
async function calculateDiscountedFee(walletAddress, baseFee, txCost = 5000) {
  const tierInfo = await getHolderTier(walletAddress);
  const breakEvenFee = calculateBreakEvenFee(txCost);
  const discountedFee = applyDiscount(baseFee, tierInfo.discount, txCost);
  const savings = baseFee - discountedFee;
  const actualDiscount = baseFee > 0 ? Math.round((savings / baseFee) * 100) : 0;

  return {
    originalFee: baseFee,
    discountedFee,
    breakEvenFee,
    savings,
    savingsPercent: actualDiscount, // Actual discount after break-even floor
    maxDiscountPercent: tierInfo.discountPercent, // Tier's max discount
    tier: tierInfo.tier,
    tierEmoji: tierInfo.emoji,
    balance: tierInfo.balance,
    nextTier: tierInfo.nextTier,
    isAtBreakEven: discountedFee === breakEvenFee, // True if floored at break-even
  };
}

/**
 * Clear balance cache (for testing)
 */
function clearCache() {
  balanceCache.clear();
}

/**
 * Get all tier definitions
 */
function getAllTiers() {
  return TIERS.map((t) => ({
    name: t.name,
    emoji: t.emoji,
    minHolding: t.minHolding,
    discountPercent: Math.round(t.discount * 100),
  }));
}

module.exports = {
  getAsdfBalance,
  getHolderTier,
  getTierForBalance,
  applyDiscount,
  calculateDiscountedFee,
  calculateBreakEvenFee,
  clearCache,
  getAllTiers,
  TIERS,
  ASDF_DECIMALS,
  DEFAULT_BREAK_EVEN_FEE,
};
