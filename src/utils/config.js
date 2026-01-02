const path = require('path');

// Load .env from project root
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// =============================================================================
// Golden Ratio (φ) - Used for Pure Golden fee split
// =============================================================================
const PHI = 1.618033988749; // Golden Ratio
const PHI_CUBED = PHI * PHI * PHI; // φ³ = 4.236...
const GOLDEN_TREASURY_RATIO = 1 / PHI_CUBED; // 1/φ³ ≈ 23.6%
const GOLDEN_BURN_RATIO = 1 - GOLDEN_TREASURY_RATIO; // ≈ 76.4%

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

  // Treasury address for fee collection (defaults to primary fee payer)
  // Can be set separately for better accounting
  TREASURY_ADDRESS: process.env.TREASURY_ADDRESS || null, // Will be set from fee payer if not specified

  // ==========================================================================
  // ELEGANT PRICING MODEL - All values derived from first principles
  // ==========================================================================
  //
  // Constraint: Treasury (20%) must cover network costs
  // Therefore: Fee × 0.20 ≥ Network Cost
  //           Fee ≥ Network Cost × 5 (break-even)
  //
  // Formula:
  //   NETWORK_FEE = 5000 lamports (Solana base fee)
  //   BREAK_EVEN = NETWORK_FEE × 5 = 25000 (derived from 80/20 split)
  //   BASE_FEE = BREAK_EVEN × MARKUP = 50000 (2x margin above break-even)
  //
  // Result:
  //   NORMIE (0% discount): 50000 lamports ≈ $0.01
  //   WHALE (95% discount): 25000 lamports ≈ $0.005 (floored at break-even)
  //
  // ==========================================================================

  // Treasury model (Pure Golden split: 76.4% burn / 23.6% treasury)
  // Based on Golden Ratio: Treasury = 1/φ³, Burn = 1 - 1/φ³
  BURN_RATIO: parseFloat(process.env.BURN_RATIO) || GOLDEN_BURN_RATIO,
  TREASURY_RATIO: parseFloat(process.env.TREASURY_RATIO) || GOLDEN_TREASURY_RATIO,

  // Network cost (Solana base fee) - the fundamental input
  NETWORK_FEE_LAMPORTS: parseInt(process.env.NETWORK_FEE_LAMPORTS) || 5000,

  // Business margin above break-even (2x = 100% margin)
  FEE_MARKUP: parseFloat(process.env.FEE_MARKUP) || 2.0,

  // Derived: BASE_FEE = NETWORK_FEE × (1/TREASURY_RATIO) × MARKUP
  // = 5000 × (1/0.236) × 2 ≈ 5000 × 4.24 × 2 ≈ 42400 lamports
  BASE_FEE_LAMPORTS: parseInt(process.env.BASE_FEE_LAMPORTS) || 50000,

  // Legacy multiplier (kept at 1.0, margin is in BASE_FEE now)
  FEE_MULTIPLIER: parseFloat(process.env.FEE_MULTIPLIER) || 1.0,

  QUOTE_TTL_SECONDS: parseInt(process.env.QUOTE_TTL_SECONDS) || 60,

  // Burn settings
  BURN_THRESHOLD_LAMPORTS: parseInt(process.env.BURN_THRESHOLD_LAMPORTS) || 100000000,

  // Oracle (optional - graceful fallback if not configured)
  ORACLE_URL: process.env.ORACLE_URL,
  ORACLE_API_KEY: process.env.ORACLE_API_KEY,

  // Jupiter API (required for production after Jan 31, 2026)
  // Get API key from https://portal.jup.ag
  JUPITER_API_KEY: process.env.JUPITER_API_KEY,

  // HolDex - Community verification service ($ASDF ecosystem)
  HOLDEX_URL: process.env.HOLDEX_URL,

  // Minimum K-score for token acceptance (0-100)
  // K-score = (accumulators + maintained) / total_holders
  // Measures holder conviction - reject tokens where holders are fleeing
  MIN_KSCORE: parseInt(process.env.MIN_KSCORE) || 50,

  // Phase 3: Monitoring
  PROMETHEUS_ENABLED: process.env.PROMETHEUS_ENABLED === 'true',
  ALERTING_WEBHOOK: process.env.ALERTING_WEBHOOK,

  // Security: Per-wallet rate limiting (in addition to IP-based)
  WALLET_QUOTE_LIMIT: parseInt(process.env.WALLET_QUOTE_LIMIT) || 20, // quotes/min per wallet
  WALLET_SUBMIT_LIMIT: parseInt(process.env.WALLET_SUBMIT_LIMIT) || 10, // submits/min per wallet
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

  // Require explicit CORS origins in production
  if (IS_PROD && config.ALLOWED_ORIGINS.length === 0) {
    errors.push('ALLOWED_ORIGINS required in production - set allowed domains (comma-separated)');
  } else if (IS_STAGING && config.ALLOWED_ORIGINS.length === 0) {
    warnings.push('ALLOWED_ORIGINS not configured - CORS will block all cross-origin requests');
  }

  // Warn if using public RPC in production
  if (IS_PROD && !config.HELIUS_API_KEY && !process.env.RPC_URL) {
    warnings.push('Using public RPC in production - consider using Helius or private RPC');
  }

  // Jupiter API key required in production (lite-api deprecated Jan 31, 2026)
  if (!config.JUPITER_API_KEY) {
    if (IS_PROD) {
      errors.push('JUPITER_API_KEY required - lite-api deprecated Jan 31, 2026 (get key at portal.jup.ag)');
    } else {
      warnings.push('JUPITER_API_KEY not set - lite-api deprecated, get key at portal.jup.ag');
    }
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
