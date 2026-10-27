// GASdf gasless relay types — pure vocabulary (zero I/O).
// Ported from contracts/subscription-reference/src/gasless/types.rs

export const GASDF_GASLESS_SESSION_SCHEMA = 'cynic.gasdf.gasless.session.v1';
export const GASDF_GASLESS_QUOTE_SCHEMA = 'cynic.gasdf.gasless.quote.v1';

export enum GasSessionStatus {
  Open = 'open',
  Quoted = 'quoted',
  Pending = 'pending',
  Settled = 'settled',
  Expired = 'expired',
  Rejected = 'rejected',
}

export interface GasSession {
  schema: string;
  sessionId: string;
  buyerPubkey: string;
  status: GasSessionStatus;
  createdAt: number;
  expiresAt: number;
  quoteId: string | null;
  signature: string | null;
  settledAt: number | null;
}

export interface GasQuote {
  schema: string;
  quoteId: string;
  sessionId: string;
  feeLamports: number;
  gasSponsored: boolean;
  expiresAt: number;
}

export interface FeePayer {
  pubkey: string;
  balanceLamports: number;
  lowBalanceThresholdLamports: number;
}

export enum FeePayerHealth {
  Healthy = 'healthy',
  LowBalance = 'low_balance',
  Depleted = 'depleted',
}

export type GasQuoteDecision =
  | { kind: 'accept'; feeLamports: number; gasSponsored: boolean }
  | { kind: 'reject'; reason: string };

export type SubmitDecision =
  | { kind: 'accept'; feeLamports: number }
  | { kind: 'pending_confirmation' }
  | { kind: 'reject'; reason: string };
