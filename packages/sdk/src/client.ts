import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import type {
  GASdfConfig,
  Quote,
  QuoteRequest,
  SubmitResult,
  PaymentToken,
  TokenScore,
  HealthStatus,
  BurnStats,
  SupportedTransaction,
} from './types';
import {
  GASdfError,
  parseApiError,
} from './errors';
import {
  fetchWithTimeout,
  generateCorrelationId,
  type FetchOptions,
  type RetryConfig,
} from './fetch';

const DEFAULT_ENDPOINT = 'https://asdfasdfa.tech';
const DEFAULT_TIMEOUT = 30000;

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
export class GASdf {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly timeout: number;
  private readonly retryConfig?: Partial<RetryConfig>;

  constructor(config: GASdfConfig = {}) {
    this.endpoint = (config.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.retryConfig = config.retry;
  }

  /**
   * Get a fee quote for a gasless transaction
   *
   * @param request - Quote request parameters
   * @returns Quote with fee payer and amount
   */
  async getQuote(request: QuoteRequest): Promise<Quote> {
    const userPubkey = this.toBase58(request.userPubkey);
    const paymentToken = this.toBase58(request.paymentToken);

    const response = await this.fetch('/quote', {
      method: 'POST',
      body: JSON.stringify({
        userPubkey,
        paymentToken,
        estimatedComputeUnits: request.estimatedComputeUnits,
      }),
    });

    return response as Quote;
  }

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
  async submit(
    transaction: SupportedTransaction,
    quoteId: string,
  ): Promise<SubmitResult> {
    const serialized = this.serializeTransaction(transaction);
    const userPubkey = this.extractUserPubkey(transaction);

    const response = await this.fetch('/submit', {
      method: 'POST',
      body: JSON.stringify({
        transaction: serialized,
        quoteId,
        userPubkey,
      }),
    });

    return response as SubmitResult;
  }

  /**
   * Convenience method: get quote and prepare transaction in one call
   *
   * @param transaction - Transaction to wrap (feePayer will be set)
   * @param paymentToken - Token mint to pay fees with
   * @returns Quote and modified transaction
   */
  async wrap(
    transaction: Transaction,
    paymentToken: string | PublicKey,
  ): Promise<{ quote: Quote; transaction: Transaction }> {
    // Get first signer as user pubkey
    const userPubkey = transaction.signatures[0]?.publicKey
      || transaction.feePayer;

    if (!userPubkey) {
      throw new GASdfError(
        'Transaction must have a feePayer or signature',
        'INVALID_TRANSACTION',
      );
    }

    const quote = await this.getQuote({
      userPubkey,
      paymentToken: this.toBase58(paymentToken),
    });

    // Set GASdf as fee payer
    transaction.feePayer = new PublicKey(quote.feePayer);

    return { quote, transaction };
  }

  /**
   * Get list of supported payment tokens
   */
  async getTokens(): Promise<PaymentToken[]> {
    const response = await this.fetch('/tokens');
    return (response as { tokens: PaymentToken[] }).tokens;
  }

  /**
   * Get K-score for a token
   *
   * @param mint - Token mint address
   */
  async getTokenScore(mint: string | PublicKey): Promise<TokenScore> {
    const mintStr = this.toBase58(mint);
    return this.fetch(`/tokens/${mintStr}/score`) as Promise<TokenScore>;
  }

  /**
   * Get API health status
   */
  async health(): Promise<HealthStatus> {
    return this.fetch('/health') as Promise<HealthStatus>;
  }

  /**
   * Get burn statistics
   */
  async stats(): Promise<BurnStats> {
    return this.fetch('/stats') as Promise<BurnStats>;
  }

  /**
   * Check if a quote is still valid
   */
  isQuoteValid(quote: Quote): boolean {
    return Date.now() < quote.expiresAt;
  }

  /**
   * Get fee payer public key from a quote
   */
  getFeePayerPubkey(quote: Quote): PublicKey {
    return new PublicKey(quote.feePayer);
  }

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────

  private async fetch(path: string, init?: RequestInit): Promise<unknown> {
    const url = `${this.endpoint}${path}`;
    const correlationId = generateCorrelationId();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const response = await fetchWithTimeout(url, {
      ...init,
      headers: { ...headers, ...init?.headers },
      timeoutMs: this.timeout,
      retry: this.retryConfig,
      correlationId,
    });

    const data = await response.json().catch(() => ({})) as Record<string, unknown>;

    if (!response.ok) {
      throw parseApiError(response.status, data as { error?: string; errors?: string[]; quoteId?: string });
    }

    return data;
  }

  private toBase58(value: string | PublicKey): string {
    if (typeof value === 'string') {
      return value;
    }
    return value.toBase58();
  }

  private serializeTransaction(transaction: SupportedTransaction): string {
    if (transaction instanceof VersionedTransaction) {
      return Buffer.from(transaction.serialize()).toString('base64');
    }
    return transaction
      .serialize({ requireAllSignatures: false })
      .toString('base64');
  }

  private extractUserPubkey(transaction: SupportedTransaction): string {
    if (transaction instanceof VersionedTransaction) {
      // For versioned tx, find first signer that's not the fee payer
      const keys = transaction.message.staticAccountKeys;
      const numSigners = transaction.message.header.numRequiredSignatures;
      const feePayer = keys[0].toBase58();

      // Find first non-fee-payer signer
      for (let i = 1; i < numSigners && i < keys.length; i++) {
        const sig = transaction.signatures[i];
        // Check if this position has a signature (not all zeros)
        if (sig && sig.length === 64 && !sig.every((b) => b === 0)) {
          return keys[i].toBase58();
        }
      }

      // Fallback: return fee payer if it's the only signer
      return feePayer;
    }

    // For legacy tx, find first signature that isn't fee payer
    const feePayer = transaction.feePayer?.toBase58();
    const signatures = transaction.signatures.filter(
      (sig) => sig.signature !== null && sig.publicKey.toBase58() !== feePayer,
    );

    if (signatures.length > 0) {
      return signatures[0].publicKey.toBase58();
    }

    // Fallback: return fee payer if it's the only signer
    if (transaction.signatures.length > 0 && transaction.signatures[0].signature !== null) {
      return transaction.signatures[0].publicKey.toBase58();
    }

    throw new GASdfError(
      'Transaction must be signed by user',
      'UNSIGNED_TRANSACTION',
    );
  }
}
