/**
 * Example: Token Selector
 *
 * A dropdown to select which token to pay fees with.
 */

import React from 'react';
import { useTokens } from 'gasdf-sdk/react';

interface TokenSelectorProps {
  value: string;
  onChange: (mint: string) => void;
}

export function TokenSelector({ value, onChange }: TokenSelectorProps) {
  const { tokens, isLoading, error } = useTokens();

  if (isLoading) {
    return (
      <select disabled className="token-selector loading">
        <option>Loading tokens...</option>
      </select>
    );
  }

  if (error) {
    return (
      <select disabled className="token-selector error">
        <option>Failed to load tokens</option>
      </select>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="token-selector"
    >
      <option value="">Select payment token</option>
      {tokens.map((token) => (
        <option key={token.mint} value={token.mint}>
          {token.symbol} - {token.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Token selector with icons
 */
export function TokenSelectorWithIcons({ value, onChange }: TokenSelectorProps) {
  const { tokens, isLoading } = useTokens();

  if (isLoading) {
    return <div className="token-grid loading">Loading...</div>;
  }

  return (
    <div className="token-grid">
      {tokens.map((token) => (
        <button
          key={token.mint}
          onClick={() => onChange(token.mint)}
          className={`token-option ${value === token.mint ? 'selected' : ''}`}
        >
          {token.logoURI && (
            <img src={token.logoURI} alt={token.symbol} width={24} height={24} />
          )}
          <span>{token.symbol}</span>
        </button>
      ))}
    </div>
  );
}
