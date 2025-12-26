'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useGASdf } from './context';
import type { Quote } from '../types';

export interface UseQuoteOptions {
  /** Token mint to pay fees with */
  paymentToken: string | PublicKey | null;
  /** Auto-refresh quote before expiry (default: true) */
  autoRefresh?: boolean;
  /** Refresh buffer in seconds (default: 10s before expiry) */
  refreshBuffer?: number;
}

export interface UseQuoteReturn {
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
export function useQuote(options: UseQuoteOptions): UseQuoteReturn {
  const { client } = useGASdf();
  const { publicKey } = useWallet();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isValid, setIsValid] = useState(false);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    paymentToken,
    autoRefresh = true,
    refreshBuffer = 10,
  } = options;

  const refresh = useCallback(async (): Promise<Quote | null> => {
    if (!publicKey || !paymentToken) {
      setQuote(null);
      setIsValid(false);
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const newQuote = await client.getQuote({
        userPubkey: publicKey,
        paymentToken,
      });

      setQuote(newQuote);
      setIsValid(true);

      // Schedule refresh before expiry
      if (autoRefresh && refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      if (autoRefresh) {
        const refreshIn = Math.max(
          (newQuote.ttl - refreshBuffer) * 1000,
          5000, // Min 5s
        );

        refreshTimerRef.current = setTimeout(() => {
          refresh();
        }, refreshIn);
      }

      return newQuote;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setIsValid(false);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [client, publicKey, paymentToken, autoRefresh, refreshBuffer]);

  // Fetch quote when dependencies change
  useEffect(() => {
    if (publicKey && paymentToken) {
      refresh();
    } else {
      setQuote(null);
      setIsValid(false);
    }

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [publicKey, paymentToken]); // Intentionally not including refresh

  // Check validity periodically
  useEffect(() => {
    if (!quote) return;

    const checkValidity = () => {
      setIsValid(client.isQuoteValid(quote));
    };

    const interval = setInterval(checkValidity, 1000);
    return () => clearInterval(interval);
  }, [quote, client]);

  return {
    quote,
    isLoading,
    error,
    isValid,
    refresh,
  };
}
