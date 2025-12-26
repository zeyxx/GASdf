/**
 * @gasdf/sdk/react - React hooks for gasless transactions
 *
 * @example
 * ```tsx
 * import { GASdfProvider, useGaslessTransaction } from '@gasdf/sdk/react';
 *
 * // Wrap your app
 * <GASdfProvider>
 *   <App />
 * </GASdfProvider>
 *
 * // In your component
 * const { execute, status } = useGaslessTransaction({
 *   paymentToken: USDC_MINT,
 * });
 * ```
 *
 * @packageDocumentation
 */

export { GASdfProvider, useGASdf, type GASdfProviderProps } from './context';
export {
  useGaslessTransaction,
  type UseGaslessTransactionOptions,
  type UseGaslessTransactionReturn,
  type TransactionStatus,
} from './useGaslessTransaction';
export {
  useTokens,
  useTokenScore,
  type UseTokensReturn,
  type UseTokenScoreReturn,
} from './useTokens';
export {
  useQuote,
  type UseQuoteOptions,
  type UseQuoteReturn,
} from './useQuote';

// Re-export core types for convenience
export type {
  Quote,
  PaymentToken,
  TokenScore,
  SubmitResult,
  GASdfConfig,
} from '../types';

// Re-export errors
export {
  GASdfError,
  QuoteExpiredError,
  ValidationError,
} from '../errors';
