/**
 * Types for the GASdf Client SDK.
 */

export type SupportedTokenSymbol = 'USDC' | 'SOL' | 'USDT';

export interface GasdfClientOptions {
  gatewayUrl: string; // e.g. "https://relay.gasdf.org" or "http://10.10.10.127:3000"
  timeoutMs?: number;
}

export interface LiveQuote {
  status: 'valid' | 'price_impact_too_high' | 'route_missing' | 'expired';
  inputMint: string;
  inputSymbol: string;
  inputAmountFormatted: number;
  inputAmountBaseUnits: string;
  targetAsdfFormatted: number;
  targetAsdfBaseUnits: string;
  priceImpactPct: number;
  quotedAt: number;
  validUntil: number;
  ttlSeconds: number;
  reason?: string;
}

export interface SubscriptionSession {
  sessionId: string;
  appId: string;
  planId: string;
  buyerPubkey: string;
  inputTokenMint: string | null;
  status: 'open' | 'quoted' | 'pending' | 'settled' | 'expired';
  createdAt: number;
  expiresAt: number;
}

export interface PreparedAtomicTx {
  sessionId: string;
  planId: string;
  buyerPubkey: string;
  feePayer: string;
  inputToken: string;
  inputAmountFormatted: number;
  burnAsdfFormatted: number;
  base64WireTx: string;
  recentBlockhash: string;
  validUntil: number;
  ttlSeconds: number;
}

export interface SettlementReceipt {
  status: 'settled';
  sessionId: string;
  txSignature: string;
  explorerUrl: string;
}

export interface WalletStandardSigner {
  signTransaction: (input: {
    account: { address: string };
    transaction: Uint8Array;
    chain?: string;
  }) => Promise<[{ signedTransaction: Uint8Array }] | { signedTransaction: Uint8Array }[]>;
}
