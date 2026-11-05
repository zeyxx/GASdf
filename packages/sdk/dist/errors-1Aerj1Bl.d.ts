import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

/** Retry configuration */
interface RetryConfig {
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
interface GASdfConfig {
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
interface PaymentToken {
    mint: string;
    symbol: string;
    name?: string;
    decimals: number;
    logoURI?: string;
}
/**
 * Payment token info with K-score (as returned in quote)
 */
interface QuotePaymentToken {
    mint: string;
    symbol: string;
    decimals: number;
    /** How token was accepted: 'whitelisted', 'holdex_verified', etc. */
    accepted: string;
}
/**
 * Treasury info for fee payment
 */
interface TreasuryInfo {
    /** Treasury wallet address */
    address: string;
    /** Token account for non-SOL payments (null for SOL) */
    ata: string | null;
}
/**
 * Quote request parameters
 */
interface QuoteRequest {
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
interface Quote {
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
interface SubmitRequest {
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
interface SubmitResult {
    /** Transaction signature */
    signature: string;
    /** Solana explorer URL */
    explorerUrl: string;
}
/**
 * GASdf API health status
 */
interface HealthStatus {
    status: 'healthy' | 'degraded' | 'down';
    timestamp: string;
    network: string;
    checks: {
        redis: {
            status: string;
        };
        rpc: {
            status: string;
            slot?: number;
        };
        feePayer: {
            status: string;
            pubkey?: string;
        };
    };
}
/**
 * Burn statistics
 */
interface BurnStats {
    totalBurned: number;
    totalTransactions: number;
    burnedFormatted: string;
}
/**
 * Supported transaction types
 */
type SupportedTransaction = Transaction | VersionedTransaction;

/**
 * GASdf SDK Client
 *
 * Add gasless transactions to your Solana app in minutes.
 *
 * @example
 * ```ts
 * import { GASdf } from '@gasdf/sdk';
 *
 * const gasdf = new GASdf();
 *
 * // 1. Get a quote
 * const quote = await gasdf.getQuote({
 *   userPubkey: wallet.publicKey,
 *   paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
 * });
 *
 * // 2. Build your transaction with GASdf fee payer
 * const tx = new Transaction({
 *   feePayer: new PublicKey(quote.feePayer),
 *   // ... your instructions
 * });
 *
 * // 3. User signs
 * const signed = await wallet.signTransaction(tx);
 *
 * // 4. Submit through GASdf
 * const { signature } = await gasdf.submit(signed, quote.quoteId);
 * ```
 */
declare class GASdf {
    private readonly endpoint;
    private readonly apiKey?;
    private readonly timeout;
    private readonly retryConfig?;
    constructor(config?: GASdfConfig);
    /**
     * Get a fee quote for a gasless transaction
     *
     * @param request - Quote request parameters
     * @returns Quote with fee payer and amount
     */
    getQuote(request: QuoteRequest): Promise<Quote>;
    /**
     * Submit a signed transaction through GASdf
     *
     * The transaction must:
     * - Have feePayer set to the quote's feePayer
     * - Be signed by the user
     * - NOT be signed by the fee payer (GASdf will co-sign)
     *
     * @param transaction - User-signed transaction
     * @param quoteId - Quote ID from getQuote
     * @returns Transaction signature
     */
    submit(transaction: SupportedTransaction, quoteId: string): Promise<SubmitResult>;
    /**
     * Convenience method: get quote and prepare transaction in one call
     *
     * @param transaction - Transaction to wrap (feePayer will be set)
     * @param paymentToken - Token mint to pay fees with
     * @returns Quote and modified transaction
     */
    wrap(transaction: Transaction, paymentToken: string | PublicKey): Promise<{
        quote: Quote;
        transaction: Transaction;
    }>;
    /**
     * Get list of supported payment tokens
     */
    getTokens(): Promise<PaymentToken[]>;
    /**
     * Get API health status
     */
    health(): Promise<HealthStatus>;
    /**
     * Get burn statistics
     */
    stats(): Promise<BurnStats>;
    /**
     * Check if a quote is still valid
     */
    isQuoteValid(quote: Quote): boolean;
    /**
     * Get fee payer public key from a quote
     */
    getFeePayerPubkey(quote: Quote): PublicKey;
    private fetch;
    private toBase58;
    private serializeTransaction;
    private extractUserPubkey;
}

/**
 * Base error class for GASdf SDK
 */
declare class GASdfError extends Error {
    readonly code: string;
    readonly statusCode?: number | undefined;
    constructor(message: string, code: string, statusCode?: number | undefined);
}
/**
 * Quote has expired - request a new one
 */
declare class QuoteExpiredError extends GASdfError {
    constructor(quoteId: string);
}
/**
 * Quote not found - may have been used or never existed
 */
declare class QuoteNotFoundError extends GASdfError {
    constructor(quoteId: string);
}
/**
 * Transaction validation failed
 */
declare class ValidationError extends GASdfError {
    readonly errors: string[];
    constructor(message: string, errors?: string[]);
}
/**
 * Transaction was rejected by the network
 */
declare class TransactionError extends GASdfError {
    readonly signature?: string | undefined;
    constructor(message: string, signature?: string | undefined);
}
/**
 * Rate limit exceeded
 */
declare class RateLimitError extends GASdfError {
    readonly retryAfter?: number | undefined;
    constructor(retryAfter?: number | undefined);
}
/**
 * Network or connection error
 */
declare class NetworkError extends GASdfError {
    constructor(message: string);
}

export { type BurnStats as B, GASdf as G, type HealthStatus as H, NetworkError as N, type PaymentToken as P, type Quote as Q, type RetryConfig as R, type SubmitRequest as S, type TreasuryInfo as T, ValidationError as V, type GASdfConfig as a, type QuoteRequest as b, type SubmitResult as c, type QuotePaymentToken as d, type SupportedTransaction as e, GASdfError as f, QuoteExpiredError as g, QuoteNotFoundError as h, TransactionError as i, RateLimitError as j };
