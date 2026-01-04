export { B as BurnStats, D as DualBurnInfo, G as GASdf, a as GASdfConfig, h as GASdfError, f as HealthStatus, H as HolderTierInfo, K as KScoreTier, N as NetworkError, P as PaymentToken, Q as Quote, i as QuoteExpiredError, j as QuoteNotFoundError, d as QuotePaymentToken, b as QuoteRequest, l as RateLimitError, R as RetryConfig, S as SubmitRequest, c as SubmitResult, g as SupportedTransaction, T as TokenScore, k as TransactionError, e as TreasuryInfo, V as ValidationError } from './errors-CEsZX8T7.mjs';
import '@solana/web3.js';

/**
 * Resilient fetch utility with timeout, retry, and correlation IDs
 * Mirrors the patterns from @solana/keychain-core for unified resilience
 */

/**
 * Generate a correlation ID for request tracing
 */
declare function generateCorrelationId(): string;

export { generateCorrelationId };
