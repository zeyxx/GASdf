// GASdf subscription types — pure vocabulary (zero I/O).
// Ported from contracts/subscription-reference/src/types.rs

export const GASDF_PAYMENT_TOKENS_SCHEMA = 'cynic.gasdf.payment_tokens.v1';
export const GASDF_PLANS_SCHEMA = 'cynic.gasdf.plans.v1';
export const GASDF_SESSION_SCHEMA = 'cynic.gasdf.subscription_session.v1';
export const GASDF_QUOTE_SCHEMA = 'cynic.gasdf.payment_quote.v1';

export enum PaymentTokenKind {
  Native = 'native',
  Stable = 'stable',
  Memecoin = 'memecoin',
}

export interface PaymentToken {
  mint: string;
  symbol: string;
  decimals: number;
  kind: PaymentTokenKind;
  enabled: boolean;
  minAmount: number;
  slippageBpsDefault: number;
}

export enum SessionStatus {
  Open = 'open',
  Quoted = 'quoted',
  Pending = 'pending',
  Settled = 'settled',
  Expired = 'expired',
  Rejected = 'rejected',
  Refunded = 'refunded',
}

export interface SubscriptionPlan {
  appId: string;
  planId: string;
  name: string;
  priceAsdfBaseUnits: number;
  durationSeconds: number;
  enabled: boolean;
}

export interface SubscriptionSession {
  schema: string;
  sessionId: string;
  appId: string;
  planId: string;
  buyerPubkey: string;
  inputTokenMint: string | null;
  status: SessionStatus;
  createdAt: number;
  expiresAt: number;
  settledAt: number | null;
}

export interface PaymentQuote {
  schema: string;
  quoteId: string;
  sessionId: string;
  inputTokenMint: string;
  inputAmount: number;
  estimatedAsdf: number;
  slippageBps: number;
  feesBaseUnits: number;
  gasSponsored: boolean;
  expiresAt: number;
}

export interface PaymentTokenLimits {
  maxSlippageBps: number;
  quoteTtlSeconds: number;
  minQuoteAmountAsdf: number;
}

export interface PaymentTokenRegistry {
  schema: string;
  tokens: PaymentToken[];
  limits: PaymentTokenLimits;
}

export interface PlanRegistry {
  schema: string;
  plans: SubscriptionPlan[];
}

/**
 * Storage Port for subscription sessions.
 * Allows switching between SQLite, Redis or PostgreSQL without touching domain logic.
 */
export interface SessionStore {
  get(sessionId: string): Promise<SubscriptionSession | null>;
  set(session: SubscriptionSession, ttlSeconds?: number): Promise<void>;
  update(sessionId: string, patch: Partial<SubscriptionSession>): Promise<void>;
  delete(sessionId: string): Promise<void>;
  pruneExpired(nowMs?: number): Promise<number>;
  close?(): Promise<void>;
}

export enum TokenDecision {
  Allowed = 'allowed',
  Disabled = 'disabled',
  Unknown = 'unknown',
  BelowMinimum = 'below_minimum',
}

export type SubscriptionQuoteDecision =
  | { kind: 'accept'; inputAmount: number; estimatedAsdf: number; slippageBps: number; gasSponsored: boolean }
  | { kind: 'reject'; reason: string };

export type SessionTransition =
  | { kind: 'to_quoted' }
  | { kind: 'to_pending' }
  | { kind: 'to_settled'; settledAt: number }
  | { kind: 'to_expired' }
  | { kind: 'to_rejected'; reason: string }
  | { kind: 'to_refunded'; refundedAt: number }
  | { kind: 'no_op'; reason: string };

export type SettlementDecision =
  | { kind: 'settle'; settledAt: number }
  | { kind: 'pending_confirmation' }
  | { kind: 'shortfall'; receivedAsdf: number; requiredAsdf: number }
  | { kind: 'rejected'; reason: string };

export enum SessionEvent {
  QuoteRequested = 'quote_requested',
  PaymentSubmitted = 'payment_submitted',
  PaymentConfirmed = 'payment_confirmed',
  TtlExpired = 'ttl_expired',
  RefundRequested = 'refund_requested',
}
