/**
 * GASdf — Shared Constants
 * All magic numbers live here. Never inline.
 */

// Golden Ratio economics
const PHI = 1.618033988749;
const PHI_CUBED = PHI * PHI * PHI;
const GOLDEN_TREASURY_RATIO = 1 / PHI_CUBED; // ~23.6%
const GOLDEN_BURN_RATIO = 1 - GOLDEN_TREASURY_RATIO; // ~76.4%

// Token mints (mainnet)
const MINTS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  PYUSD: '2b1kV6DkPAnxd5ixfnExCx2PdhTteca1Ck2aG1Znhrog',
  ASDF: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
  WSOL: 'So11111111111111111111111111111111111111112',
};

// Token metadata
const TOKEN_INFO = {
  [MINTS.USDC]: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  [MINTS.USDT]: { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  [MINTS.PYUSD]: { symbol: 'PYUSD', name: 'PayPal USD', decimals: 6 },
  [MINTS.ASDF]: { symbol: 'ASDF', name: '$asdfasdfa', decimals: 6 },
  [MINTS.WSOL]: { symbol: 'SOL', name: 'Wrapped SOL', decimals: 9 },
};

// Holder discount tiers (ordered highest to lowest)
const TIERS = [
  { name: 'DIAMOND', minSharePercent: 1, discountPercent: 95 },
  { name: 'PLATINUM', minSharePercent: 0.1, discountPercent: 67 },
  { name: 'GOLD', minSharePercent: 0.01, discountPercent: 33 },
  { name: 'SILVER', minSharePercent: 0.001, discountPercent: 0 },
  { name: 'BRONZE', minSharePercent: 0, discountPercent: 0 },
];

// Jito tip minimum (0.0002 SOL in lamports)
const JITO_TIP_LAMPORTS = 200_000;

// Solana tx size limit
const MAX_TX_SIZE = 1232;

// Explorer base URL — ALWAYS orbmarkets.io
const EXPLORER_BASE = 'https://orbmarkets.io';

module.exports = {
  PHI,
  PHI_CUBED,
  GOLDEN_TREASURY_RATIO,
  GOLDEN_BURN_RATIO,
  MINTS,
  TOKEN_INFO,
  TIERS,
  JITO_TIP_LAMPORTS,
  MAX_TX_SIZE,
  EXPLORER_BASE,
};
