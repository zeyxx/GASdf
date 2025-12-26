/**
 * @gasdf/sdk - Gasless transactions for Solana
 *
 * Add gasless transactions to your Solana app in 5 minutes.
 *
 * @example
 * ```ts
 * import { GASdf } from '@gasdf/sdk';
 *
 * const gasdf = new GASdf();
 * const quote = await gasdf.getQuote({
 *   userPubkey: wallet.publicKey,
 *   paymentToken: 'USDC_MINT',
 * });
 *
 * // Set fee payer and sign
 * tx.feePayer = gasdf.getFeePayerPubkey(quote);
 * const signed = await wallet.signTransaction(tx);
 *
 * // Submit - GASdf pays the SOL fees
 * const { signature } = await gasdf.submit(signed, quote.quoteId);
 * ```
 *
 * @packageDocumentation
 */

export { GASdf } from './client';

export type {
  GASdfConfig,
  Quote,
  QuoteRequest,
  SubmitRequest,
  SubmitResult,
  PaymentToken,
  TokenScore,
  KScoreTier,
  HealthStatus,
  BurnStats,
  SupportedTransaction,
} from './types';

export {
  GASdfError,
  QuoteExpiredError,
  QuoteNotFoundError,
  ValidationError,
  TransactionError,
  RateLimitError,
  NetworkError,
} from './errors';
