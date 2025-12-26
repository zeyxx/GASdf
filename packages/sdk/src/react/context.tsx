'use client';

import React, {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { GASdf } from '../client';
import type { GASdfConfig } from '../types';

interface GASdfContextValue {
  client: GASdf;
  config: GASdfConfig;
}

const GASdfContext = createContext<GASdfContextValue | null>(null);

export interface GASdfProviderProps {
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
export function GASdfProvider({
  children,
  endpoint,
  apiKey,
  timeout,
}: GASdfProviderProps) {
  const config: GASdfConfig = useMemo(
    () => ({ endpoint, apiKey, timeout }),
    [endpoint, apiKey, timeout],
  );

  const client = useMemo(() => new GASdf(config), [config]);

  const value = useMemo(() => ({ client, config }), [client, config]);

  return (
    <GASdfContext.Provider value={value}>
      {children}
    </GASdfContext.Provider>
  );
}

/**
 * Get the GASdf client instance
 *
 * @example
 * ```tsx
 * const { client } = useGASdf();
 * const tokens = await client.getTokens();
 * ```
 */
export function useGASdf(): GASdfContextValue {
  const context = useContext(GASdfContext);

  if (!context) {
    throw new Error('useGASdf must be used within a GASdfProvider');
  }

  return context;
}
