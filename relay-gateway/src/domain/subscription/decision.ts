// GASdf subscription pure decision functions — no I/O, no clock reads.
// Ported from contracts/subscription-reference/src/decision.rs
// All timestamps are inputs. Adapters persist the produced decisions.

import {
  SessionStatus,
  PaymentToken,
  PaymentTokenRegistry,
  SubscriptionPlan,
  SubscriptionSession,
  TokenDecision,
  SubscriptionQuoteDecision,
  SessionTransition,
  SettlementDecision,
  SessionEvent,
  PaymentTokenKind,
} from './types.js';

export function isTerminal(status: SessionStatus): boolean {
  return (
    status === SessionStatus.Settled ||
    status === SessionStatus.Expired ||
    status === SessionStatus.Rejected ||
    status === SessionStatus.Refunded
  );
}

export function decideTokenAllowed(
  registry: PaymentTokenRegistry,
  mint: string,
  amount: number,
): TokenDecision {
  const token = registry.tokens.find(t => t.mint === mint);
  if (!token) return TokenDecision.Unknown;
  if (!token.enabled) return TokenDecision.Disabled;
  if (amount < token.minAmount) return TokenDecision.BelowMinimum;
  return TokenDecision.Allowed;
}

export function decideSubscriptionQuote(
  session: SubscriptionSession,
  plan: SubscriptionPlan,
  token: PaymentToken,
  inputAmount: number,
  estimatedAsdf: number,
  slippageBps: number | null,
  now: number,
  gasSponsored: boolean,
): SubscriptionQuoteDecision {
  if (session.status !== SessionStatus.Open && session.status !== SessionStatus.Quoted) {
    return { kind: 'reject', reason: 'session not quotable' };
  }
  if (now >= session.expiresAt) {
    return { kind: 'reject', reason: 'session expired' };
  }
  if (!plan.enabled) {
    return { kind: 'reject', reason: 'plan disabled' };
  }
  if (plan.appId !== session.appId || plan.planId !== session.planId) {
    return { kind: 'reject', reason: 'plan does not match session' };
  }
  if (session.planId === '') {
    return { kind: 'reject', reason: 'session has no plan' };
  }
  if (!token.enabled) {
    return { kind: 'reject', reason: 'token disabled' };
  }
  if (session.inputTokenMint !== null && session.inputTokenMint !== token.mint) {
    return { kind: 'reject', reason: 'session locked to a different input token' };
  }
  if (inputAmount < token.minAmount) {
    return { kind: 'reject', reason: 'input amount below token minimum' };
  }
  const effectiveSlippage = slippageBps ?? token.slippageBpsDefault;
  if (effectiveSlippage > 10_000) {
    return { kind: 'reject', reason: 'slippage exceeds hard ceiling' };
  }
  if (estimatedAsdf < plan.priceAsdfBaseUnits) {
    return { kind: 'reject', reason: 'conversion shortfall against plan price' };
  }
  return {
    kind: 'accept',
    inputAmount,
    estimatedAsdf,
    slippageBps: effectiveSlippage,
    gasSponsored,
  };
}

export function decideSessionTransition(
  session: SubscriptionSession,
  event: SessionEvent,
  now: number,
  confirmedAt?: number,
): SessionTransition {
  if (isTerminal(session.status)) {
    return { kind: 'no_op', reason: 'session already terminal' };
  }
  if (now >= session.expiresAt) {
    if (session.status !== SessionStatus.Settled && session.status !== SessionStatus.Refunded) {
      return { kind: 'to_expired' };
    }
  }
  if (session.status === SessionStatus.Open && event === SessionEvent.QuoteRequested) {
    return { kind: 'to_quoted' };
  }
  if (session.status === SessionStatus.Quoted && event === SessionEvent.PaymentSubmitted) {
    return { kind: 'to_pending' };
  }
  if (session.status === SessionStatus.Pending && event === SessionEvent.PaymentConfirmed) {
    const at = confirmedAt ?? now;
    if (at > now) {
      return { kind: 'no_op', reason: 'confirmation timestamp in the future' };
    }
    return { kind: 'to_settled', settledAt: at };
  }
  if (session.status === SessionStatus.Settled && event === SessionEvent.RefundRequested) {
    return { kind: 'to_refunded', refundedAt: now };
  }
  return { kind: 'no_op', reason: 'illegal transition' };
}

export function decideSettlement(
  session: SubscriptionSession,
  receivedAsdf: number,
  requiredAsdf: number,
  confirmed: boolean,
  now: number,
): SettlementDecision {
  if (session.status !== SessionStatus.Pending) {
    return { kind: 'rejected', reason: 'session not pending' };
  }
  if (now >= session.expiresAt) {
    return { kind: 'rejected', reason: 'session expired' };
  }
  if (!confirmed) {
    return { kind: 'pending_confirmation' };
  }
  if (receivedAsdf < requiredAsdf) {
    return { kind: 'shortfall', receivedAsdf, requiredAsdf };
  }
  return { kind: 'settle', settledAt: now };
}
