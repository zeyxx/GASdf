/**
 * Example: Complete App Setup with GASdf
 *
 * This shows how to set up your React app with all required providers.
 */

import React from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { GASdfProvider } from 'gasdf-sdk/react';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

// Configure wallets
const wallets = [new PhantomWalletAdapter()];

/**
 * Root App Component
 *
 * Provider order matters:
 * 1. ConnectionProvider - Solana RPC connection
 * 2. WalletProvider - Wallet adapter
 * 3. WalletModalProvider - Wallet selection modal
 * 4. GASdfProvider - Gasless transactions
 */
export function App({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={SOLANA_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <GASdfProvider>
            {children}
          </GASdfProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/**
 * With custom GASdf configuration
 */
export function AppWithConfig({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={SOLANA_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <GASdfProvider
            endpoint="https://asdfasdfa.tech"  // Optional: custom endpoint
            apiKey="your-api-key"               // Optional: for higher rate limits
            timeout={30000}                     // Optional: request timeout
          >
            {children}
          </GASdfProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
