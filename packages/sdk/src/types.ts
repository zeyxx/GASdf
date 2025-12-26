import type { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

/**
 * GASdf client configuration
 */
export interface GASdfConfig {
  /** GASdf API endpoint (default: https://api.gasdf.io) */
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
  name: string;
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
  /** Fee amount in payment token (lamports/smallest unit) */
  feeAmount: string;
  /** Fee amount formatted with decimals */
  feeFormatted: string;
  /** Payment token info */
  paymentToken: PaymentToken;
  /** Token K-score */
  kScore: TokenScore;
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
