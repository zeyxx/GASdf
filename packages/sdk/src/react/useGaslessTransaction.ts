'use client';

import { useState, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { useGASdf } from './context';
import type { Quote, SubmitResult, SupportedTransaction } from '../types';
import { GASdfError } from '../errors';

export type TransactionStatus =
  | 'idle'
  | 'getting-quote'
  | 'awaiting-signature'
  | 'submitting'
  | 'confirming'
  | 'success'
  | 'error';

export interface UseGaslessTransactionOptions {
  /** Token mint to pay fees with */
  paymentToken: string | PublicKey;
  /** Callback when transaction succeeds */
  onSuccess?: (result: SubmitResult) => void;
  /** Callback when transaction fails */
  onError?: (error: Error) => void;
}

export interface UseGaslessTransactionReturn {
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
export function useGaslessTransaction(
  options: UseGaslessTransactionOptions,
): UseGaslessTransactionReturn {
  const { client } = useGASdf();
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();

  const [status, setStatus] = useState<TransactionStatus>('idle');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setQuote(null);
    setResult(null);
    setError(null);
  }, []);

  const execute = useCallback(
    async (transaction: Transaction): Promise<SubmitResult | null> => {
      if (!publicKey) {
        const err = new Error('Wallet not connected');
        setError(err);
        setStatus('error');
        options.onError?.(err);
        return null;
      }

      if (!signTransaction) {
        const err = new Error('Wallet does not support signing');
        setError(err);
        setStatus('error');
        options.onError?.(err);
        return null;
      }

      try {
        // Reset state
        setError(null);
        setResult(null);

        // 1. Get quote
        setStatus('getting-quote');
        const newQuote = await client.getQuote({
          userPubkey: publicKey,
          paymentToken: options.paymentToken,
        });
        setQuote(newQuote);

        // 2. Prepare transaction
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash();

        transaction.feePayer = new PublicKey(newQuote.feePayer);
        transaction.recentBlockhash = blockhash;
        transaction.lastValidBlockHeight = lastValidBlockHeight;

        // 3. Get user signature
        setStatus('awaiting-signature');
        const signed = await signTransaction(transaction);

        // 4. Submit to GASdf
        setStatus('submitting');
        const submitResult = await client.submit(signed, newQuote.quoteId);

        // 5. Wait for confirmation (optional - GASdf already confirms)
        setStatus('confirming');

        setResult(submitResult);
        setStatus('success');
        options.onSuccess?.(submitResult);

        return submitResult;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setStatus('error');
        options.onError?.(error);
        return null;
      }
    },
    [client, connection, publicKey, signTransaction, options],
  );

  return {
    execute,
    status,
    quote,
    result,
    error,
    isLoading: !['idle', 'success', 'error'].includes(status),
    reset,
  };
}
