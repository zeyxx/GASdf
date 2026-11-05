import type { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

/** Retry configuration */
export interface RetryConfig {
  /** Maximum retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in ms for exponential backoff (default: 100) */
  baseDelayMs: number;
  /** Maximum delay cap in ms (default: 5000) */
  maxDelayMs: number;
  /** HTTP status codes that trigger retry (default: 500, 502, 503, 504) */
  retryableStatusCodes: number[];
}

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
  /** Retry configuration for failed requests */
  retry?: Partial<RetryConfig>;
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
 * Payment token info (as returned in quote)
 */
export interface QuotePaymentToken {
  mint: string;
  symbol: string;
  decimals: number;
  /** How token was accepted: 'whitelisted', 'holdex_verified', etc. */
  accepted: string;
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
  /** Payment token info */
  paymentToken: QuotePaymentToken;
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
