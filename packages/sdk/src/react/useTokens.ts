'use client';

import { useState, useEffect, useCallback } from 'react';
import { useGASdf } from './context';
import type { PaymentToken } from '../types';

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

