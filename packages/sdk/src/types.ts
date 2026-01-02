import type { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

/**
 * GASdf client configuration
 */
export interface GASdfConfig {
  /** GASdf API endpoint (default: https://asdfasdfa.tech) */
  endpoint?: string;
  /** Optional API key for higher rate limits */
  apiKey?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

/**
 * Token info for fee payment
 */
export interface PaymentToken {
  mint: string;
  symbol: string;
  name?: string;
  decimals: number;
  logoURI?: string;
}

/**
 * K-score tier affecting fee multiplier
 */
export type KScoreTier = 'TRUSTED' | 'STANDARD' | 'RISKY' | 'UNKNOWN';

/**
 * Token K-score information
 */
export interface TokenScore {
  mint: string;
  score: number;
  tier: KScoreTier;
  feeMultiplier: number;
}

/**
 * Dual-burn flywheel info (for ecosystem tokens)
 */
export interface DualBurnInfo {
  burnedPercent: number;
  ecosystemBurnPct: number;
  asdfBurnPct: number;
  treasuryPct: number;
  explanation: string;
}

/**
 * Payment token info with K-score (as returned in quote)
 */
export interface QuotePaymentToken {
  mint: string;
  symbol: string;
  decimals: number;
  /** How token was accepted: 'trusted', 'holdex_verified', etc. */
  accepted: string;
  /** K-score tier */
  tier: KScoreTier;
  /** K-score value */
  kScore: number;
  /** K-score rank */
  kRank?: string;
  /** Credit rating */
  creditRating?: string;
  /** Dual-burn info (if ecosystem token) */
  dualBurn?: DualBurnInfo;
}

/**
 * Treasury info for fee payment
 */
export interface TreasuryInfo {
  /** Treasury wallet address */
  address: string;
  /** Token account for non-SOL payments (null for SOL) */
  ata: string | null;
}

/**
 * Holder tier discount info
 */
export interface HolderTierInfo {
  /** Tier name: BRONZE, SILVER, GOLD, DIAMOND */
  tier: string;
  /** Tier emoji */
  emoji: string;
  /** Applied discount percentage */
  discountPercent: number;
  /** Maximum possible discount */
  maxDiscountPercent: number;
  /** Actual savings in lamports */
  savings: number;
  /** User's $ASDF balance */
  asdfBalance: number;
  /** Next tier to unlock (null if max) */
  nextTier: string | null;
  /** Break-even fee threshold */
  breakEvenFee: number;
  /** Whether fee is at break-even minimum */
  isAtBreakEven: boolean;
}

/**
 * Quote request parameters
 */
export interface QuoteRequest {
  /** User's wallet public key */
  userPubkey: string | PublicKey;
  /** Token mint to pay fees with */
  paymentToken: string | PublicKey;
  /** Optional: estimated compute units for more accurate quote */
  estimatedComputeUnits?: number;
}

/**
 * Quote response from GASdf API
 */
export interface Quote {
  /** Unique quote ID (use for submit) */
  quoteId: string;
  /** GASdf fee payer public key (set as tx.feePayer) */
  feePayer: string;
  /** Treasury info for fee payment */
  treasury: TreasuryInfo;
  /** Fee amount in payment token (smallest unit as string) */
  feeAmount: string;
  /** Fee amount formatted with decimals (e.g., "0.01 USDC") */
  feeFormatted: string;
  /** Payment token info with K-score */
  paymentToken: QuotePaymentToken;
  /** Holder tier discount info */
  holderTier: HolderTierInfo;
  /** Quote expiry timestamp (unix ms) */
  expiresAt: number;
  /** Time-to-live in seconds */
  ttl: number;
}

/**
 * Transaction submission request
 */
export interface SubmitRequest {
  /** Base64 encoded signed transaction */
  transaction: string;
  /** Quote ID from getQuote */
  quoteId: string;
  /** User public key (must match quote) */
  userPubkey: string | PublicKey;
}

/**
 * Transaction submission result
 */
export interface SubmitResult {
  /** Transaction signature */
  signature: string;
  /** Solana explorer URL */
  explorerUrl: string;
}

/**
 * GASdf API health status
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  timestamp: string;
  network: string;
  checks: {
    redis: { status: string };
    rpc: { status: string; slot?: number };
    feePayer: { status: string; pubkey?: string };
  };
}

/**
 * Burn statistics
 */
export interface BurnStats {
  totalBurned: number;
  totalTransactions: number;
  burnedFormatted: string;
}

/**
 * Supported transaction types
 */
export type SupportedTransaction = Transaction | VersionedTransaction;
