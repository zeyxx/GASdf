/**
 * GASdf — Shared Constants
 * All magic numbers live here. Never inline.
 */

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

// Jito tip minimum (0.0002 SOL in lamports)
const JITO_TIP_LAMPORTS = 200_000;

// Solana tx size limit
const MAX_TX_SIZE = 1232;

// Explorer base URL — ALWAYS orbmarkets.io
const EXPLORER_BASE = 'https://orbmarkets.io';

module.exports = {
  MINTS,
  TOKEN_INFO,
  JITO_TIP_LAMPORTS,
  MAX_TX_SIZE,
  EXPLORER_BASE,
};
