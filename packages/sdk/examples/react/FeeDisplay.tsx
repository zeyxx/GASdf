/**
 * Example: Fee Display Component
 *
 * Shows the current fee quote with auto-refresh.
 */

import React from 'react';
import { useQuote } from 'gasdf-sdk/react';

interface FeeDisplayProps {
  paymentToken: string;
}

/**
 * Simple fee display
 */
export function FeeDisplay({ paymentToken }: FeeDisplayProps) {
  const { quote, isLoading, isValid, error, refresh } = useQuote({
    paymentToken,
    autoRefresh: true,    // Auto-refresh before expiry
    refreshBuffer: 10,    // Refresh 10s before expiry
  });

  if (isLoading && !quote) {
    return <div className="fee-display loading">Loading fee...</div>;
  }

  if (error) {
    return (
      <div className="fee-display error">
        <span>Failed to get fee</span>
        <button onClick={refresh}>Retry</button>
      </div>
    );
  }

  if (!quote) {
    return null;
  }

  return (
    <div className={`fee-display ${isValid ? 'valid' : 'expired'}`}>
      <span className="fee-amount">{quote.feeFormatted}</span>
      {!isValid && (
        <button onClick={refresh} className="refresh-btn">
          Refresh
        </button>
      )}
    </div>
  );
}

/**
 * Detailed fee display with holder tier info
 */
export function FeeDisplayDetailed({ paymentToken }: FeeDisplayProps) {
  const { quote, isLoading, isValid } = useQuote({
    paymentToken,
    autoRefresh: true,
  });

  if (isLoading && !quote) {
    return <div className="fee-card loading">Calculating fee...</div>;
  }

  if (!quote) {
    return null;
  }

  const { holderTier, paymentToken: token } = quote;

  return (
    <div className={`fee-card ${isValid ? '' : 'expired'}`}>
      {/* Fee amount */}
      <div className="fee-main">
        <span className="label">Transaction Fee</span>
        <span className="value">{quote.feeFormatted}</span>
      </div>

      {/* Token info */}
      <div className="fee-token">
        <span className="label">Paying with</span>
        <span className="value">
          {token.symbol}
          <span className={`tier tier-${token.tier.toLowerCase()}`}>
            {token.tier}
          </span>
        </span>
      </div>

      {/* Holder discount */}
      {holderTier.discountPercent > 0 && (
        <div className="fee-discount">
          <span className="label">
            {holderTier.emoji} {holderTier.tier} Discount
          </span>
          <span className="value savings">
            -{holderTier.discountPercent}%
          </span>
        </div>
      )}

      {/* Next tier hint */}
      {holderTier.nextTier && (
        <div className="fee-hint">
          Hold more $ASDF to unlock {holderTier.nextTier} tier
        </div>
      )}

      {/* Expiry warning */}
      {!isValid && (
        <div className="fee-expired">
          Quote expired - will refresh automatically
        </div>
      )}
    </div>
  );
}
