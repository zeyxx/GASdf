const path = require('path');

// Load .env from project root
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { GOLDEN_BURN_RATIO, GOLDEN_TREASURY_RATIO } = require('../constants');

// Environment Detection
const ENV = process.env.NODE_ENV || 'development';
const IS_DEV = ENV === 'development' || ENV === 'test';
const IS_PROD = ENV === 'production';
const USE_MAINNET = IS_PROD;

// Network Configuration
const NETWORKS = {
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
  helius_devnet: `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
  helius_mainnet: `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
};

function getRpcUrl() {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  if (process.env.HELIUS_API_KEY) {
    return USE_MAINNET ? NETWORKS.helius_mainnet : NETWORKS.helius_devnet;
  }
  return USE_MAINNET ? NETWORKS.mainnet : NETWORKS.devnet;
}

// Validation Patterns
const MINT_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PRIVATE_KEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

const config = {
  ENV,
  IS_DEV,
  IS_PROD,
  USE_MAINNET,
  PORT: parseInt(process.env.PORT) || 3000,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS?.split(',').filter(Boolean) || [],

  // RPC
  HELIUS_API_KEY: process.env.HELIUS_API_KEY,
  RPC_URL: getRpcUrl(),
  NETWORK: USE_MAINNET ? 'mainnet' : 'devnet',

  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // Fee payer wallet (single keypair — Phase 0)
  FEE_PAYER_PRIVATE_KEY: process.env.FEE_PAYER_PRIVATE_KEY,

  // $ASDF token mint
  ASDF_MINT:
    process.env.ASDF_MINT ||
    (IS_DEV
      ? 'ASdfDevnetFakeMintAddress1111111111111111'
      : '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump'),

  WSOL_MINT: 'So11111111111111111111111111111111111111112',

  // Treasury (defaults to fee payer in Phase 0)
  TREASURY_ADDRESS: process.env.TREASURY_ADDRESS || null,

  // Fee economics (Golden Ratio split)
  BURN_RATIO: parseFloat(process.env.BURN_RATIO) || GOLDEN_BURN_RATIO,
  TREASURY_RATIO: parseFloat(process.env.TREASURY_RATIO) || GOLDEN_TREASURY_RATIO,

  NETWORK_FEE_LAMPORTS: parseInt(process.env.NETWORK_FEE_LAMPORTS) || 5000,
  FEE_MARKUP: parseFloat(process.env.FEE_MARKUP) || 2.0,
  BASE_FEE_LAMPORTS: parseInt(process.env.BASE_FEE_LAMPORTS) || 50000,
  QUOTE_TTL_SECONDS: parseInt(process.env.QUOTE_TTL_SECONDS) || 60,

  // Burn settings
  BURN_THRESHOLD_LAMPORTS: parseInt(process.env.BURN_THRESHOLD_LAMPORTS) || 100000000,

  // Jupiter API
  JUPITER_API_KEY: process.env.JUPITER_API_KEY,

  // Rate limiting (per wallet)
  WALLET_QUOTE_LIMIT: parseInt(process.env.WALLET_QUOTE_LIMIT) || 20,
  WALLET_SUBMIT_LIMIT: parseInt(process.env.WALLET_SUBMIT_LIMIT) || 10,
};

// Configuration Validation
function validateConfig() {
  const errors = [];
  const warnings = [];

  if (IS_PROD && !process.env.REDIS_URL) {
    errors.push('REDIS_URL is required in production');
  }

  if (IS_PROD && !config.FEE_PAYER_PRIVATE_KEY) {
    errors.push('FEE_PAYER_PRIVATE_KEY is required in production');
  }

  if (IS_PROD && !config.ASDF_MINT) {
    errors.push('ASDF_MINT is required in production');
  }

  if (config.FEE_PAYER_PRIVATE_KEY && !PRIVATE_KEY_REGEX.test(config.FEE_PAYER_PRIVATE_KEY)) {
    errors.push('FEE_PAYER_PRIVATE_KEY must be a valid base58 encoded private key (64-88 characters)');
  }

  if (config.ASDF_MINT) {
    if (!MINT_ADDRESS_REGEX.test(config.ASDF_MINT)) {
      errors.push('ASDF_MINT must be a valid Solana address (32-44 base58 characters)');
    }
    const isPlaceholder =
      config.ASDF_MINT.includes('evnet') ||
      config.ASDF_MINT.includes('FakeMint') ||
      config.ASDF_MINT.includes('Devnet');
    if (isPlaceholder && IS_PROD) {
      errors.push('ASDF_MINT contains placeholder - set a real mint address for production');
    } else if (isPlaceholder) {
      warnings.push('Using placeholder ASDF_MINT - burn functionality will not work');
    }
  }

  if (IS_PROD && config.ALLOWED_ORIGINS.length === 0) {
    errors.push('ALLOWED_ORIGINS required in production');
  }

  if (IS_PROD && !config.HELIUS_API_KEY && !process.env.RPC_URL) {
    warnings.push('Using public RPC in production - consider using Helius');
  }

  if (!config.JUPITER_API_KEY) {
    if (IS_PROD) {
      errors.push('JUPITER_API_KEY required (get key at portal.jup.ag)');
    } else {
      warnings.push('JUPITER_API_KEY not set - get key at portal.jup.ag');
    }
  }

  if (warnings.length > 0) {
    console.warn('Configuration warnings:');
    warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
  }

  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach((e) => console.error(`  ✗ ${e}`));
    if (IS_PROD) {
      process.exit(1);
    }
  }
}

validateConfig();

module.exports = config;
