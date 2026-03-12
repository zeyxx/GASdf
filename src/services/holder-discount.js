/**
 * $ASDF Holder Discount — Supply-Based Tiers
 *
 * Formula: discount = min(95%, max(0, (log₁₀(share) + 5) / 3))
 * Break-even floor: fee_final = max(discounted_fee, tx_cost / treasury_ratio)
 */

const { PublicKey } = require('@solana/web3.js');
const config = require('../utils/config');
const helius = require('./helius');
const logger = require('../utils/logger');
const { TIERS } = require('../constants');

const TREASURY_RATIO = config.TREASURY_RATIO;
const ASDF_DECIMALS = 6;
const ASDF_UNIT = Math.pow(10, ASDF_DECIMALS);
const ORIGINAL_SUPPLY = 1_000_000_000;

// Cache for circulating supply (5 min TTL)
let circulatingSupplyCache = { value: ORIGINAL_SUPPLY * 0.93, timestamp: 0 };
const SUPPLY_CACHE_TTL = 300000;

// Cache for balance lookups (5 min TTL)
const balanceCache = new Map();
const BALANCE_CACHE_TTL = 300000;

async function getCirculatingSupply() {
  if (Date.now() - circulatingSupplyCache.timestamp < SUPPLY_CACHE_TTL) {
    return circulatingSupplyCache.value;
  }

  try {
    const connection = helius.getConnection();
    const asdfMint = new PublicKey(config.ASDF_MINT);
    const supplyInfo = await connection.getTokenSupply(asdfMint);
    const circulating = parseInt(supplyInfo.value.amount) / ASDF_UNIT;

    circulatingSupplyCache = { value: circulating, timestamp: Date.now() };
    return circulating;
  } catch (error) {
    logger.warn('HOLDER_DISCOUNT', 'Failed to fetch supply, using cached', {
      error: error.message,
    });
    return circulatingSupplyCache.value;
  }
}

async function getAsdfBalance(walletAddress) {
  if (!walletAddress) return 0;

  const cached = balanceCache.get(walletAddress);
  if (cached && Date.now() - cached.timestamp < BALANCE_CACHE_TTL) {
    return cached.balance;
  }

  try {
    const connection = helius.getConnection();
    const wallet = new PublicKey(walletAddress);
    const asdfMint = new PublicKey(config.ASDF_MINT);

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet, {
      mint: asdfMint,
    });

    let totalBalance = 0;
    for (const account of tokenAccounts.value) {
      const amount = account.account.data.parsed?.info?.tokenAmount?.amount;
      if (amount) {
        totalBalance += parseInt(amount) / ASDF_UNIT;
      }
    }

    balanceCache.set(walletAddress, { balance: totalBalance, timestamp: Date.now() });
    return totalBalance;
  } catch (error) {
    logger.warn('HOLDER_DISCOUNT', 'Balance check failed', {
      wallet: walletAddress.slice(0, 8),
      error: error.message,
    });
    balanceCache.set(walletAddress, { balance: 0, timestamp: Date.now() });
    return 0;
  }
}

function calculateDiscountFromShare(share) {
  if (share <= 0) return 0;
  const logShare = Math.log10(share);
  const discount = (logShare + 5) / 3;
  return Math.min(0.95, Math.max(0, discount));
}

function getTierName(sharePercent) {
  for (const tier of TIERS) {
    if (sharePercent >= tier.minSharePercent) return tier;
  }
  return TIERS[TIERS.length - 1];
}

async function getHolderTier(walletAddress) {
  const [balance, circulating] = await Promise.all([
    getAsdfBalance(walletAddress),
    getCirculatingSupply(),
  ]);

  const share = balance / circulating;
  const sharePercent = share * 100;
  const discount = calculateDiscountFromShare(share);
  const tier = getTierName(sharePercent);

  return {
    tier: tier.name,
    balance,
    circulating,
    share,
    sharePercent,
    discount,
    discountPercent: Math.round(discount * 100),
  };
}

function calculateBreakEvenFee(txCost) {
  return Math.ceil(txCost / TREASURY_RATIO);
}

function applyDiscount(baseFee, discount, txCost = 5000) {
  const breakEvenFee = calculateBreakEvenFee(txCost);
  const discountedFee = Math.ceil(baseFee * (1 - discount));
  return Math.max(discountedFee, breakEvenFee);
}

async function calculateDiscountedFee(walletAddress, baseFee, txCost = 5000) {
  const tierInfo = await getHolderTier(walletAddress);

  const breakEvenFee = calculateBreakEvenFee(txCost);
  const discountedFee = applyDiscount(baseFee, tierInfo.discount, txCost);
  const savings = baseFee - discountedFee;
  const actualDiscountPercent = baseFee > 0 ? Math.round((1 - discountedFee / baseFee) * 100) : 0;

  return {
    originalFee: baseFee,
    discountedFee,
    breakEvenFee,
    savings,
    discountPercent: Math.max(0, actualDiscountPercent),
    isAtBreakEven: discountedFee === breakEvenFee,
    tier: tierInfo.tier,
    balance: tierInfo.balance,
    circulating: tierInfo.circulating,
    sharePercent: tierInfo.sharePercent,
  };
}

function getAllTiers() {
  return TIERS;
}

function clearCache() {
  balanceCache.clear();
  circulatingSupplyCache = { value: ORIGINAL_SUPPLY * 0.93, timestamp: 0 };
}

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
