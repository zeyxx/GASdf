import * as react_jsx_runtime from 'react/jsx-runtime';
import { ReactNode } from 'react';
import { GASdf, GASdfConfig, SubmitResult, Quote, PaymentToken, TokenScore } from './index.mjs';
export { GASdfError, QuoteExpiredError, ValidationError } from './index.mjs';
import { PublicKey, Transaction } from '@solana/web3.js';

interface GASdfContextValue {
    client: GASdf;
    config: GASdfConfig;
}
interface GASdfProviderProps {
    children: ReactNode;
    /** GASdf API endpoint */
    endpoint?: string;
    /** API key for higher rate limits */
    apiKey?: string;
    /** Request timeout in ms */
    timeout?: number;
}
/**
 * GASdf Provider - Wrap your app to enable gasless transactions
 *
 * @example
 * ```tsx
 * import { GASdfProvider } from '@gasdf/sdk/react';
 *
 * function App() {
 *   return (
 *     <WalletProvider>
 *       <GASdfProvider>
 *         <YourApp />
 *       </GASdfProvider>
 *     </WalletProvider>
 *   );
 * }
 * ```
 */
declare function GASdfProvider({ children, endpoint, apiKey, timeout, }: GASdfProviderProps): react_jsx_runtime.JSX.Element;
/**
 * Get the GASdf client instance
 *
 * @example
 * ```tsx
 * const { client } = useGASdf();
 * const tokens = await client.getTokens();
 * ```
 */
declare function useGASdf(): GASdfContextValue;

type TransactionStatus = 'idle' | 'getting-quote' | 'awaiting-signature' | 'submitting' | 'confirming' | 'success' | 'error';
interface UseGaslessTransactionOptions {
    /** Token mint to pay fees with */
    paymentToken: string | PublicKey;
    /** Callback when transaction succeeds */
    onSuccess?: (result: SubmitResult) => void;
    /** Callback when transaction fails */
    onError?: (error: Error) => void;
}
interface UseGaslessTransactionReturn {
    /** Execute a gasless transaction */
    execute: (transaction: Transaction) => Promise<SubmitResult | null>;
    /** Current transaction status */
    status: TransactionStatus;
    /** Current quote (if any) */
    quote: Quote | null;
    /** Last transaction result */
    result: SubmitResult | null;
    /** Last error (if any) */
    error: Error | null;
    /** Whether a transaction is in progress */
    isLoading: boolean;
    /** Reset state */
    reset: () => void;
}
/**
 * Hook for executing gasless transactions
 *
 * @example
 * ```tsx
 * function SendButton() {
 *   const { execute, status, isLoading } = useGaslessTransaction({
 *     paymentToken: USDC_MINT,
 *     onSuccess: (result) => console.log('Sent!', result.signature),
 *   });
 *
 *   const handleSend = async () => {
 *     const tx = new Transaction().add(
 *       SystemProgram.transfer({ ... })
 *     );
 *     await execute(tx);
 *   };
 *
 *   return (
 *     <button onClick={handleSend} disabled={isLoading}>
 *       {status === 'awaiting-signature' ? 'Sign in wallet...' : 'Send'}
 *     </button>
 *   );
 * }
 * ```
 */
declare function useGaslessTransaction(options: UseGaslessTransactionOptions): UseGaslessTransactionReturn;

interface UseTokensReturn {
    /** List of supported payment tokens */
    tokens: PaymentToken[];
    /** Whether tokens are loading */
    isLoading: boolean;
    /** Error if fetch failed */
    error: Error | null;
    /** Refresh token list */
    refresh: () => Promise<void>;
}
/**
 * Hook to get supported payment tokens
 *
 * @example
 * ```tsx
 * function TokenSelect({ onSelect }) {
 *   const { tokens, isLoading } = useTokens();
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return (
 *     <select onChange={(e) => onSelect(e.target.value)}>
 *       {tokens.map((t) => (
 *         <option key={t.mint} value={t.mint}>
 *           {t.symbol}
 *         </option>
 *       ))}
 *     </select>
 *   );
 * }
 * ```
 */
declare function useTokens(): UseTokensReturn;
interface UseTokenScoreReturn {
    /** Token score info */
    score: TokenScore | null;
    /** Whether score is loading */
    isLoading: boolean;
    /** Error if fetch failed */
    error: Error | null;
}
/**
 * Hook to get K-score for a specific token
 *
 * @example
 * ```tsx
 * function TokenInfo({ mint }) {
 *   const { score, isLoading } = useTokenScore(mint);
 *
 *   if (isLoading) return <Spinner />;
 *   if (!score) return null;
 *
 *   return (
 *     <div>
 *       Tier: {score.tier} ({score.feeMultiplier}x fee)
 *     </div>
 *   );
 * }
 * ```
 */
declare function useTokenScore(mint: string | null): UseTokenScoreReturn;

interface UseQuoteOptions {
    /** Token mint to pay fees with */
    paymentToken: string | PublicKey | null;
    /** Auto-refresh quote before expiry (default: true) */
    autoRefresh?: boolean;
    /** Refresh buffer in seconds (default: 10s before expiry) */
    refreshBuffer?: number;
}
interface UseQuoteReturn {
    /** Current quote */
    quote: Quote | null;
    /** Whether quote is loading */
    isLoading: boolean;
    /** Error if fetch failed */
    error: Error | null;
    /** Whether quote is valid (not expired) */
    isValid: boolean;
    /** Manually refresh quote */
    refresh: () => Promise<Quote | null>;
}
/**
 * Hook to get and auto-refresh fee quotes
 *
 * @example
 * ```tsx
 * function FeeDisplay() {
 *   const { quote, isLoading, isValid } = useQuote({
 *     paymentToken: USDC_MINT,
 *   });
 *
 *   if (isLoading) return <Spinner />;
 *   if (!quote) return null;
 *
 *   return (
 *     <div className={isValid ? '' : 'expired'}>
 *       Fee: {quote.feeFormatted}
 *     </div>
 *   );
 * }
 * ```
 */
declare function useQuote(options: UseQuoteOptions): UseQuoteReturn;

export { GASdfConfig, GASdfProvider, type GASdfProviderProps, PaymentToken, Quote, SubmitResult, TokenScore, type TransactionStatus, type UseGaslessTransactionOptions, type UseGaslessTransactionReturn, type UseQuoteOptions, type UseQuoteReturn, type UseTokenScoreReturn, type UseTokensReturn, useGASdf, useGaslessTransaction, useQuote, useTokenScore, useTokens };
