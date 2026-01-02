/**
 * Example: Gasless Send Button
 *
 * A button that sends SOL without the user needing any SOL for fees.
 * Fees are paid in USDC (or any supported token).
 */

import React, { useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
} from '@solana/spl-token';
import { useGaslessTransaction } from 'gasdf-sdk/react';

// Token mints
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

interface SendButtonProps {
  recipient: string;
  amount: number; // in SOL
}

export function SendButton({ recipient, amount }: SendButtonProps) {
  const { connection } = useConnection();
  const [error, setError] = useState<string | null>(null);

  const {
    execute,
    status,
    quote,
    result,
    isLoading,
    reset,
  } = useGaslessTransaction({
    paymentToken: USDC_MINT,
    onSuccess: (result) => {
      console.log('Transaction successful:', result.signature);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleSend = async () => {
    setError(null);

    try {
      // Build the transaction
      const tx = new Transaction();

      // Add your transfer instruction
      tx.add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(recipient), // Will be set by user
          toPubkey: new PublicKey(recipient),
          lamports: amount * LAMPORTS_PER_SOL,
        })
      );

      // Execute gaslessly - user signs, GASdf pays SOL fees
      await execute(tx);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  // Status-based button text
  const getButtonText = () => {
    switch (status) {
      case 'getting-quote':
        return 'Getting fee quote...';
      case 'awaiting-signature':
        return 'Sign in wallet...';
      case 'submitting':
        return 'Submitting...';
      case 'confirming':
        return 'Confirming...';
      case 'success':
        return 'Sent!';
      case 'error':
        return 'Try again';
      default:
        return `Send ${amount} SOL`;
    }
  };

  return (
    <div className="send-button-container">
      <button
        onClick={status === 'success' ? reset : handleSend}
        disabled={isLoading}
        className={`send-button ${status}`}
      >
        {getButtonText()}
      </button>

      {/* Show fee info */}
      {quote && status !== 'success' && (
        <p className="fee-info">
          Fee: {quote.feeFormatted}
          {quote.holderTier.discountPercent > 0 && (
            <span className="discount">
              ({quote.holderTier.discountPercent}% off)
            </span>
          )}
        </p>
      )}

      {/* Show success */}
      {result && (
        <p className="success">
          <a
            href={`https://solscan.io/tx/${result.signature}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on Solscan
          </a>
        </p>
      )}

      {/* Show error */}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
