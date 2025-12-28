/**
 * $ASDF Holder Tier System - Supply-Based Discount
 *
 * Discount is based on % of circulating supply, not absolute tokens.
 * As $ASDF burns (deflationary), everyone's discount naturally increases.
 *
 * Formula: discount = min(95%, max(0, (log₁₀(share) + 5) / 3))
 * Where: share = holding / circulating_supply
 *
 * This creates a virtuous flywheel:
 * Hold → Burns happen → Your share grows → Better discount → More hold
 */
const { PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');
const config = require('../utils/config');
const { getConnection } = require('../utils/rpc');
const { logger } = require('../utils/logger');

// $ASDF has 6 decimals
const ASDF_DECIMALS = 6;
const ASDF_UNIT = Math.pow(10, ASDF_DECIMALS);

// Original total supply: 1 billion $ASDF
const ORIGINAL_SUPPLY = 1_000_000_000;

// Cache for circulating supply (refreshed every 5 minutes)
let circulatingSupplyCache = {
  value: ORIGINAL_SUPPLY * 0.93, // Default: assume 7% burned
  timestamp: 0,
};
const SUPPLY_CACHE_TTL = 300000; // 5 minutes

// Cache for balance lookups (5 minute TTL)
const balanceCache = new Map();
const BALANCE_CACHE_TTL = 300000;

/**
 * Get circulating supply of $ASDF (total - burned)
 * @returns {Promise<number>} - Circulating supply in whole tokens
 */
async function getCirculatingSupply() {
  // Return cached value if fresh
  if (Date.now() - circulatingSupplyCache.timestamp < SUPPLY_CACHE_TTL) {
    return circulatingSupplyCache.value;
  }

  try {
    const connection = getConnection();
    const asdfMint = new PublicKey(config.ASDF_MINT);

    // Get token supply from chain
    const supplyInfo = await connection.getTokenSupply(asdfMint);
    const circulating = parseInt(supplyInfo.value.amount) / ASDF_UNIT;

    // Cache the result
    circulatingSupplyCache = {
      value: circulating,
      timestamp: Date.now(),
    };

    logger.debug('[HOLDER-TIERS] Circulating supply updated', {
      circulating: circulating.toLocaleString(),
      burned: ((1 - circulating / ORIGINAL_SUPPLY) * 100).toFixed(2) + '%',
    });

    return circulating;
  } catch (error) {
    logger.warn('[HOLDER-TIERS] Failed to fetch supply, using cached', {
      error: error.message,
    });
    return circulatingSupplyCache.value;
  }
}

/**
 * Get $ASDF balance for a wallet
 * @param {string} walletAddress - User's wallet public key
 * @returns {Promise<number>} - $ASDF balance in whole tokens
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

    return 0;
  }
}

/**
 * Calculate discount based on share of circulating supply
 *
 * Formula: discount = min(95%, max(0, (log₁₀(share) + 5) / 3))
 *
 * This gives:
 * - 0.001% of supply (10⁻⁵) → 0% discount
 * - 0.01% of supply (10⁻⁴) → 33% discount
 * - 0.1% of supply (10⁻³) → 67% discount
 * - 1% of supply (10⁻²) → 95% discount (capped)
 *
 * @param {number} share - Holding as fraction of circulating supply
 * @returns {number} - Discount between 0 and 0.95
 */
function calculateDiscountFromShare(share) {
  if (share <= 0) return 0;

  // log₁₀(share) + 5, divided by 3 orders of magnitude range
  const logShare = Math.log10(share);
  const discount = (logShare + 5) / 3;

  return Math.min(0.95, Math.max(0, discount));
}

/**
 * Get holder tier info based on share of supply
 * @param {string} walletAddress - User's wallet public key
 * @returns {Promise<Object>} - Tier info with discount
 */
async function getHolderTier(walletAddress) {
  const [balance, circulating] = await Promise.all([
    getAsdfBalance(walletAddress),
    getCirculatingSupply(),
  ]);

  const share = balance / circulating;
  const sharePercent = share * 100;
  const discount = calculateDiscountFromShare(share);

  // Determine tier name based on share
  const tier = getTierName(sharePercent);

  return {
    tier: tier.name,
    emoji: tier.emoji,
    balance,
    circulating,
    share,
    sharePercent,
    discount,
    discountPercent: Math.round(discount * 100),
  };
}

/**
 * Get tier name based on share percentage
 * @param {number} sharePercent - Share as percentage (0.001 to 100)
 * @returns {Object} - Tier name and emoji
 */
function getTierName(sharePercent) {
  if (sharePercent >= 1) return { name: 'WHALE', emoji: '🐋' };
  if (sharePercent >= 0.1) return { name: 'OG', emoji: '👑' };
  if (sharePercent >= 0.01) return { name: 'BELIEVER', emoji: '💎' };
  if (sharePercent >= 0.001) return { name: 'HOLDER', emoji: '🙌' };
  return { name: 'NORMIE', emoji: '👤' };
}

/**
 * Calculate minimum fee to ensure treasury breaks even
 * Treasury receives 20% of fee, must cover transaction costs.
 *
 * @param {number} txCost - Transaction cost in lamports
 * @returns {number} - Minimum fee for break-even
 */
function calculateBreakEvenFee(txCost) {
  const TREASURY_RATIO = 0.20;
  return Math.ceil(txCost / TREASURY_RATIO);
}

/**
 * Apply discount to fee with break-even floor
 *
 * @param {number} baseFee - Original fee in lamports
 * @param {number} discount - Discount (0-0.95)
 * @param {number} txCost - Transaction cost for break-even
 * @returns {number} - Final fee (never below break-even)
 */
function applyDiscount(baseFee, discount, txCost = 5000) {
  const breakEvenFee = calculateBreakEvenFee(txCost);
  const discountedFee = Math.ceil(baseFee * (1 - discount));
  return Math.max(discountedFee, breakEvenFee);
}

/**
 * Get next tier info for upgrade motivation
 * @param {string} currentTierName - Current tier name
 * @param {number} currentSharePercent - Current share percentage
 * @param {number} circulating - Circulating supply
 * @returns {Object|null} - Next tier info or null if WHALE
 */
function getNextTierInfo(currentTierName, currentSharePercent, circulating) {
  const tiers = getAllTiers();
  const currentIndex = tiers.findIndex((t) => t.name === currentTierName);

  // WHALE has no next tier
  if (currentIndex <= 0) return null;

  const nextTier = tiers[currentIndex - 1];
  const neededSharePercent = nextTier.minSharePercent - currentSharePercent;
  const neededTokens = Math.ceil((neededSharePercent / 100) * circulating);

  return {
    name: nextTier.name,
    emoji: nextTier.emoji,
    minSharePercent: nextTier.minSharePercent,
    discountPercent: nextTier.discountPercent,
    needed: neededTokens,
  };
}

/**
 * Calculate fee with holder discount based on supply share
 *
 * @param {string} walletAddress - User's wallet public key
 * @param {number} baseFee - Original fee in lamports
 * @param {number} txCost - Transaction cost for break-even floor
 * @returns {Promise<Object>} - Complete fee info
 */
async function calculateDiscountedFee(walletAddress, baseFee, txCost = 5000) {
  const tierInfo = await getHolderTier(walletAddress);
  const breakEvenFee = calculateBreakEvenFee(txCost);
  const discountedFee = applyDiscount(baseFee, tierInfo.discount, txCost);
  const savings = baseFee - discountedFee;
  const actualDiscountPercent = baseFee > 0 ? Math.round((1 - discountedFee / baseFee) * 100) : 0;

  // Get next tier info for upgrade motivation
  const nextTier = getNextTierInfo(tierInfo.tier, tierInfo.sharePercent, tierInfo.circulating);

  return {
    // Fee info
    originalFee: baseFee,
    discountedFee,
    breakEvenFee,
    savings,

    // Discount info (savingsPercent for backwards compat with quote.js)
    discountPercent: Math.max(0, actualDiscountPercent),
    savingsPercent: Math.max(0, actualDiscountPercent),
    maxDiscountPercent: tierInfo.discountPercent,
    isAtBreakEven: discountedFee === breakEvenFee,

    // Tier info
    tier: tierInfo.tier,
    tierEmoji: tierInfo.emoji,
    nextTier,

    // Holding info
    balance: tierInfo.balance,
    circulating: tierInfo.circulating,
    sharePercent: tierInfo.sharePercent,
  };
}

/**
 * Get tier structure for display
 * Shows what % of supply gives what discount
 */
function getAllTiers() {
  return [
    { name: 'WHALE', emoji: '🐋', minSharePercent: 1, discountPercent: 95 },
    { name: 'OG', emoji: '👑', minSharePercent: 0.1, discountPercent: 67 },
    { name: 'BELIEVER', emoji: '💎', minSharePercent: 0.01, discountPercent: 33 },
    { name: 'HOLDER', emoji: '🙌', minSharePercent: 0.001, discountPercent: 0 },
    { name: 'NORMIE', emoji: '👤', minSharePercent: 0, discountPercent: 0 },
  ];
}

/**
 * Clear caches (for testing)
 */
function clearCache() {
  balanceCache.clear();
  circulatingSupplyCache = { value: ORIGINAL_SUPPLY * 0.93, timestamp: 0 };
}

/**
 * Set circulating supply manually (for testing)
 */
function setCirculatingSupply(supply) {
  circulatingSupplyCache = { value: supply, timestamp: Date.now() };
}

module.exports = {
  getAsdfBalance,
  getCirculatingSupply,
  getHolderTier,
  getTierName,
  calculateDiscountFromShare,
  calculateBreakEvenFee,
  applyDiscount,
  calculateDiscountedFee,
  getAllTiers,
  clearCache,
  setCirculatingSupply,
  ASDF_DECIMALS,
  ORIGINAL_SUPPLY,
};
