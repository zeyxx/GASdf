const path = require('path');

// Load .env from project root
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// =============================================================================
// Environment Detection
// =============================================================================
const ENV = process.env.NODE_ENV || 'development';
const IS_DEV = ENV === 'development' || ENV === 'test';
const IS_STAGING = ENV === 'staging';
const IS_PROD = ENV === 'production';

// Development and staging use devnet; production uses mainnet
const USE_MAINNET = IS_PROD;

// =============================================================================
// Network Configuration
// =============================================================================
const NETWORKS = {
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
  helius_devnet: `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
  helius_mainnet: `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
};

function getRpcUrl() {
  // Custom RPC takes priority
  if (process.env.RPC_URL) return process.env.RPC_URL;

  // Helius RPC if key provided
  if (process.env.HELIUS_API_KEY) {
    return USE_MAINNET ? NETWORKS.helius_mainnet : NETWORKS.helius_devnet;
  }

  // Fallback to public RPCs
  return USE_MAINNET ? NETWORKS.mainnet : NETWORKS.devnet;
}

// =============================================================================
// Validation Patterns
// =============================================================================
const MINT_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PRIVATE_KEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

// =============================================================================
// Configuration Object
// =============================================================================
const config = {
  // Environment
  ENV,
  IS_DEV,
  IS_STAGING,
  IS_PROD,
  USE_MAINNET,
  PORT: parseInt(process.env.PORT) || 3000,

  // CORS (production should restrict origins)
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS?.split(',').filter(Boolean) || [],

  // RPC
  HELIUS_API_KEY: process.env.HELIUS_API_KEY,
  RPC_URL: getRpcUrl(),
  NETWORK: USE_MAINNET ? 'mainnet' : 'devnet',

  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // Fee payer wallet(s)
  FEE_PAYER_PRIVATE_KEY: process.env.FEE_PAYER_PRIVATE_KEY,
  // Phase 2: Multi fee payer support
  FEE_PAYER_KEYS: process.env.FEE_PAYER_KEYS?.split(',').filter(Boolean) || [],

  // $ASDF token mint
  ASDF_MINT: process.env.ASDF_MINT || (IS_DEV
    ? 'ASdfDevnetFakeMintAddress1111111111111'
    : '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump'),

  // Wrapped SOL mint (same on all networks)
  WSOL_MINT: 'So11111111111111111111111111111111111111112',

  // Fee settings
  BASE_FEE_LAMPORTS: parseInt(process.env.BASE_FEE_LAMPORTS) || 5000,
  FEE_MULTIPLIER: parseFloat(process.env.FEE_MULTIPLIER) || 1.5,
  QUOTE_TTL_SECONDS: parseInt(process.env.QUOTE_TTL_SECONDS) || 60,

  // Burn settings
  BURN_THRESHOLD_LAMPORTS: parseInt(process.env.BURN_THRESHOLD_LAMPORTS) || 100000000,

  // Oracle (optional - graceful fallback if not configured)
  ORACLE_URL: process.env.ORACLE_URL,
  ORACLE_API_KEY: process.env.ORACLE_API_KEY,

  // Phase 3: Monitoring
  PROMETHEUS_ENABLED: process.env.PROMETHEUS_ENABLED === 'true',
  ALERTING_WEBHOOK: process.env.ALERTING_WEBHOOK,
};

// =============================================================================
// Configuration Validation
// =============================================================================
function validateConfig() {
  const errors = [];
  const warnings = [];

  // -------------------------------------------------------------------------
  // Environment-specific requirements
  // -------------------------------------------------------------------------

  // Staging & Production: Redis required
  if ((IS_STAGING || IS_PROD) && !process.env.REDIS_URL) {
    errors.push('REDIS_URL is required in staging/production (no in-memory fallback)');
  }

  // Staging & Production: Fee payer required
  if ((IS_STAGING || IS_PROD) && !config.FEE_PAYER_PRIVATE_KEY) {
    errors.push('FEE_PAYER_PRIVATE_KEY is required in staging/production');
  }

  // Production: Real ASDF mint required
  if (IS_PROD && !config.ASDF_MINT) {
    errors.push('ASDF_MINT is required in production');
  }

  // -------------------------------------------------------------------------
  // Format validation
  // -------------------------------------------------------------------------

  // Validate fee payer private key format
  if (config.FEE_PAYER_PRIVATE_KEY && !PRIVATE_KEY_REGEX.test(config.FEE_PAYER_PRIVATE_KEY)) {
    errors.push('FEE_PAYER_PRIVATE_KEY must be a valid base58 encoded private key (64-88 characters)');
  }

  // Validate multi fee payer keys format (Phase 2)
  if (config.FEE_PAYER_KEYS.length > 0) {
    config.FEE_PAYER_KEYS.forEach((key, i) => {
      if (!PRIVATE_KEY_REGEX.test(key.trim())) {
        errors.push(`FEE_PAYER_KEYS[${i}] must be a valid base58 encoded private key`);
      }
    });
  }

  // Validate ASDF mint format
  if (config.ASDF_MINT) {
    if (!MINT_ADDRESS_REGEX.test(config.ASDF_MINT)) {
      errors.push('ASDF_MINT must be a valid Solana address (32-44 base58 characters)');
    }

    // Check for placeholder values
    const isPlaceholder = config.ASDF_MINT.includes('evnet') ||
                         config.ASDF_MINT.includes('FakeMint') ||
                         config.ASDF_MINT.includes('Devnet');

    if (isPlaceholder) {
      if (IS_PROD) {
        errors.push('ASDF_MINT contains placeholder - set a real mint address for production');
      } else if (IS_STAGING) {
        warnings.push('Using placeholder ASDF_MINT in staging - burn functionality disabled');
      } else {
        warnings.push('Using placeholder ASDF_MINT - burn functionality will not work');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Security warnings
  // -------------------------------------------------------------------------

  // Warn if no CORS origins configured in production
  if (IS_PROD && config.ALLOWED_ORIGINS.length === 0) {
    warnings.push('ALLOWED_ORIGINS not configured - CORS will allow all origins');
  }

  // Warn if using public RPC in production
  if (IS_PROD && !config.HELIUS_API_KEY && !process.env.RPC_URL) {
    warnings.push('Using public RPC in production - consider using Helius or private RPC');
  }

  // -------------------------------------------------------------------------
  // Output and exit handling
  // -------------------------------------------------------------------------

  if (warnings.length > 0) {
    console.warn('Configuration warnings:');
    warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
  }

  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach((e) => console.error(`  ✗ ${e}`));

    // Only exit in staging/production
    if (IS_STAGING || IS_PROD) {
      process.exit(1);
    }
  }
}

// Run validation on startup
validateConfig();

module.exports = config;
