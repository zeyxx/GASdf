/**
 * Example: Complete Swap Page
 *
 * A full page combining all GASdf components for a gasless swap experience.
 */

import React, { useState, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
} from '@solana/spl-token';
import {
  useGaslessTransaction,
  useQuote,
  useTokens,
  useGASdf,
} from 'gasdf-sdk/react';

// Common token mints
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ASDF_MINT = '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump';

export function SwapPage() {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { client } = useGASdf();

  // Form state
  const [paymentToken, setPaymentToken] = useState(USDC_MINT);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');

  // Get available tokens
  const { tokens } = useTokens();

  // Get live fee quote
  const { quote, isValid } = useQuote({
    paymentToken,
    autoRefresh: true,
  });

  // Gasless transaction hook
  const {
    execute,
    status,
    result,
    error,
    isLoading,
    reset,
  } = useGaslessTransaction({
    paymentToken,
    onSuccess: (result) => {
      // Reset form on success
      setRecipient('');
      setAmount('');
    },
  });

  // Build and execute transaction
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!publicKey || !quote || !recipient || !amount) return;

    try {
      // Parse amount
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error('Invalid amount');
      }

      // Validate recipient
      const recipientPubkey = new PublicKey(recipient);

      // Build transaction with fee payment
      const tx = new Transaction();

      // Get token accounts
      const paymentMint = new PublicKey(paymentToken);
      const userAta = await getAssociatedTokenAddress(paymentMint, publicKey);
      const treasuryAta = new PublicKey(quote.treasury.ata!);

      // Add fee payment instruction
      tx.add(
        createTransferInstruction(
          userAta,
          treasuryAta,
          publicKey,
          BigInt(quote.feeAmount)
        )
      );

      // Add your actual swap/transfer instructions here
      // tx.add(yourSwapInstruction);

      // Execute gaslessly
      await execute(tx);
    } catch (err) {
      console.error('Transaction failed:', err);
    }
  }, [publicKey, quote, recipient, amount, paymentToken, execute]);

  // Not connected
  if (!connected) {
    return (
      <div className="swap-page not-connected">
        <h1>Gasless Swap</h1>
        <p>Connect your wallet to swap without SOL</p>
        <WalletMultiButton />
      </div>
    );
  }

  return (
    <div className="swap-page">
      <header>
        <h1>Gasless Swap</h1>
        <WalletMultiButton />
      </header>

      <form onSubmit={handleSubmit} className="swap-form">
        {/* Token selector */}
        <div className="form-group">
          <label>Pay fees with</label>
          <select
            value={paymentToken}
            onChange={(e) => setPaymentToken(e.target.value)}
            disabled={isLoading}
          >
            {tokens.map((t) => (
              <option key={t.mint} value={t.mint}>
                {t.symbol}
              </option>
            ))}
          </select>
        </div>

        {/* Recipient */}
        <div className="form-group">
          <label>Recipient</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Wallet address"
            disabled={isLoading}
          />
        </div>

        {/* Amount */}
        <div className="form-group">
          <label>Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            step="0.01"
            min="0"
            disabled={isLoading}
          />
        </div>

        {/* Fee display */}
        {quote && (
          <div className="fee-summary">
            <div className="fee-row">
              <span>Network Fee</span>
              <span>{quote.feeFormatted}</span>
            </div>
            {quote.holderTier.discountPercent > 0 && (
              <div className="fee-row discount">
                <span>{quote.holderTier.emoji} {quote.holderTier.tier} Discount</span>
                <span>-{quote.holderTier.discountPercent}%</span>
              </div>
            )}
          </div>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={isLoading || !isValid || !recipient || !amount}
          className={`submit-btn ${status}`}
        >
          {status === 'idle' && 'Swap'}
          {status === 'getting-quote' && 'Getting quote...'}
          {status === 'awaiting-signature' && 'Sign in wallet...'}
          {status === 'submitting' && 'Submitting...'}
          {status === 'confirming' && 'Confirming...'}
          {status === 'success' && 'Success!'}
          {status === 'error' && 'Try again'}
        </button>

        {/* Success message */}
        {result && (
          <div className="success-message">
            <p>Transaction confirmed!</p>
            <a
              href={`https://solscan.io/tx/${result.signature}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Solscan
            </a>
            <button type="button" onClick={reset}>
              New swap
            </button>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="error-message">
            <p>{error.message}</p>
            <button type="button" onClick={reset}>
              Try again
            </button>
          </div>
        )}
      </form>

      {/* Stats footer */}
      <Stats />
    </div>
  );
}

/**
 * Burn stats component
 */
function Stats() {
  const { client } = useGASdf();
  const [stats, setStats] = useState<{ burnedFormatted: string; totalTransactions: number } | null>(null);

  React.useEffect(() => {
    client.stats().then(setStats).catch(console.error);
  }, [client]);

  if (!stats) return null;

  return (
    <footer className="stats">
      <span>Total burned: {stats.burnedFormatted}</span>
      <span>Transactions: {stats.totalTransactions.toLocaleString()}</span>
    </footer>
  );
}
