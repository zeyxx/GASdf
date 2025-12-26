'use client';

import { useState, useEffect, useCallback } from 'react';
import { useGASdf } from './context';
import type { PaymentToken, TokenScore } from '../types';

export interface UseTokensReturn {
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
export function useTokens(): UseTokensReturn {
  const { client } = useGASdf();
  const [tokens, setTokens] = useState<PaymentToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await client.getTokens();
      setTokens(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { tokens, isLoading, error, refresh };
}

export interface UseTokenScoreReturn {
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
export function useTokenScore(mint: string | null): UseTokenScoreReturn {
  const { client } = useGASdf();
  const [score, setScore] = useState<TokenScore | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!mint) {
      setScore(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    client
      .getTokenScore(mint)
      .then(setScore)
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => setIsLoading(false));
  }, [client, mint]);

  return { score, isLoading, error };
}
