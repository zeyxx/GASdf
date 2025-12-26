/**
 * React Example: Gasless Send Button
 *
 * Shows how to integrate GASdf with Solana wallet adapter
 */

import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import {
  GASdfProvider,
  useGaslessTransaction,
  useTokens,
  useQuote,
} from '../src/react';

// Token mints
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Main App with GASdf Provider
 */
export function App() {
  return (
    <GASdfProvider>
      <div className="app">
        <header>
          <h1>Gasless Transactions Demo</h1>
          <WalletMultiButton />
        </header>
        <main>
          <SendForm />
        </main>
      </div>
    </GASdfProvider>
  );
}

/**
 * Token selector component
 */
function TokenSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (mint: string) => void;
}) {
  const { tokens, isLoading } = useTokens();

  if (isLoading) {
    return <select disabled><option>Loading...</option></select>;
  }

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {tokens.map((token) => (
        <option key={token.mint} value={token.mint}>
          {token.symbol}
        </option>
      ))}
    </select>
  );
}

/**
 * Fee display component
 */
function FeeDisplay({ paymentToken }: { paymentToken: string }) {
  const { quote, isLoading, isValid } = useQuote({ paymentToken });

  if (isLoading) {
    return <span className="fee loading">Calculating fee...</span>;
  }

  if (!quote) {
    return <span className="fee">Connect wallet to see fee</span>;
  }

  return (
    <span className={`fee ${isValid ? 'valid' : 'expired'}`}>
      Fee: {quote.feeFormatted}
      {!isValid && ' (refreshing...)'}
    </span>
  );
}

/**
 * Main send form with gasless transaction
 */
function SendForm() {
  const { publicKey, connected } = useWallet();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentToken, setPaymentToken] = useState(USDC_MINT);

  const { execute, status, isLoading, result, error } = useGaslessTransaction({
    paymentToken,
    onSuccess: (result) => {
      console.log('Transaction successful!', result.signature);
    },
    onError: (error) => {
      console.error('Transaction failed:', error);
    },
  });

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!publicKey || !recipient || !amount) return;

    // Build your transaction (any instructions you want)
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: new PublicKey(recipient),
        lamports: parseFloat(amount) * 1e9, // SOL to lamports
      }),
    );

    // Execute gaslessly - user pays fee in selected token
    await execute(tx);
  };

  // Status messages
  const statusMessages: Record<string, string> = {
    idle: '',
    'getting-quote': 'Getting fee quote...',
    'awaiting-signature': 'Please sign in your wallet...',
    submitting: 'Submitting transaction...',
    confirming: 'Confirming...',
    success: 'Transaction successful!',
    error: 'Transaction failed',
  };

  return (
    <form onSubmit={handleSend} className="send-form">
      <h2>Send SOL (Gasless)</h2>
      <p>Pay transaction fees in any token. No SOL needed!</p>

      {!connected ? (
        <p className="connect-prompt">Connect your wallet to continue</p>
      ) : (
        <>
          <div className="form-group">
            <label>Recipient</label>
            <input
              type="text"
              placeholder="Solana address..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="form-group">
            <label>Amount (SOL)</label>
            <input
              type="number"
              placeholder="0.01"
              step="0.001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="form-group">
            <label>Pay fee with</label>
            <TokenSelect value={paymentToken} onChange={setPaymentToken} />
            <FeeDisplay paymentToken={paymentToken} />
          </div>

          <button type="submit" disabled={isLoading || !recipient || !amount}>
            {isLoading ? statusMessages[status] : 'Send'}
          </button>

          {result && (
            <div className="success">
              <p>✓ Sent!</p>
              <a href={result.explorerUrl} target="_blank" rel="noreferrer">
                View on Explorer
              </a>
            </div>
          )}

          {error && (
            <div className="error">
              <p>✗ {error.message}</p>
            </div>
          )}
        </>
      )}
    </form>
  );
}

export default App;
