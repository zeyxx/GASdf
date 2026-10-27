import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SessionStatus,
  SessionEvent,
  TokenDecision,
  PaymentTokenKind,
  type PaymentTokenRegistry,
  type SubscriptionSession,
  type SubscriptionPlan,
  GASDF_SESSION_SCHEMA,
} from './types.js';
import {
  decideTokenAllowed,
  decideSubscriptionQuote,
  decideSessionTransition,
  decideSettlement,
} from './decision.js';

function createRegistry(): PaymentTokenRegistry {
  return {
    schema: 'cynic.gasdf.payment_tokens.v1',
    tokens: [
      {
        mint: 'SOL',
        symbol: 'SOL',
        decimals: 9,
        kind: PaymentTokenKind.Native,
        enabled: true,
        minAmount: 1_000_000,
        slippageBpsDefault: 50,
      },
      {
        mint: 'USDC_MINT',
        symbol: 'USDC',
        decimals: 6,
        kind: PaymentTokenKind.Stable,
        enabled: false,
        minAmount: 10_000,
        slippageBpsDefault: 10,
      },
    ],
    limits: {
      maxSlippageBps: 300,
      quoteTtlSeconds: 300,
      minQuoteAmountAsdf: 100_000,
    },
  };
}

function createOpenSession(): SubscriptionSession {
  return {
    schema: GASDF_SESSION_SCHEMA,
    sessionId: 's1',
    appId: 'cultscreener',
    planId: 'pro-monthly',
    buyerPubkey: 'buyer',
    inputTokenMint: null,
    status: SessionStatus.Open,
    createdAt: 1000,
    expiresAt: 2000,
    settledAt: null,
  };
}

function createPlan(): SubscriptionPlan {
  return {
    appId: 'cultscreener',
    planId: 'pro-monthly',
    name: 'Pro monthly',
    priceAsdfBaseUnits: 100_000_000,
    durationSeconds: 2592000,
    enabled: true,
  };
}

test('subscription: token allowed variants', () => {
  const reg = createRegistry();
  assert.equal(decideTokenAllowed(reg, 'SOL', 2_000_000), TokenDecision.Allowed);
  assert.equal(decideTokenAllowed(reg, 'USDC_MINT', 20_000), TokenDecision.Disabled);
  assert.equal(decideTokenAllowed(reg, 'NOPE', 1), TokenDecision.Unknown);
  assert.equal(decideTokenAllowed(reg, 'SOL', 10), TokenDecision.BelowMinimum);
});

test('subscription: quote accepts valid configuration', () => {
  const session = createOpenSession();
  const plan = createPlan();
  const token = createRegistry().tokens[0];

  const decision = decideSubscriptionQuote(
    session,
    plan,
    token,
    2_000_000,
    100_000_000,
    25,
    1100,
    true,
  );

  assert.equal(decision.kind, 'accept');
  if (decision.kind === 'accept') {
    assert.equal(decision.slippageBps, 25);
    assert.equal(decision.gasSponsored, true);
    assert.equal(decision.estimatedAsdf, 100_000_000);
  }
});

test('subscription: quote rejects disabled plan, disabled token, or shortfall', () => {
  const session = createOpenSession();
  const plan = createPlan();
  plan.enabled = false;
  const token = createRegistry().tokens[0];

  assert.equal(
    decideSubscriptionQuote(session, plan, token, 2_000_000, 100_000_000, null, 1100, false).kind,
    'reject',
  );

  const validPlan = createPlan();
  const disabledToken = { ...token, enabled: false };
  assert.equal(
    decideSubscriptionQuote(session, validPlan, disabledToken, 2_000_000, 100_000_000, null, 1100, false).kind,
    'reject',
  );

  assert.equal(
    decideSubscriptionQuote(session, validPlan, token, 2_000_000, 50_000_000, null, 1100, false).kind,
    'reject',
  );
});

test('subscription: quote rejects locked token mismatch', () => {
  const session = createOpenSession();
  session.inputTokenMint = 'OTHER_TOKEN';
  const plan = createPlan();
  const token = createRegistry().tokens[0];

  assert.equal(
    decideSubscriptionQuote(session, plan, token, 2_000_000, 100_000_000, null, 1100, false).kind,
    'reject',
  );
});

test('subscription: session lifecycle transitions', () => {
  const session = createOpenSession();
  assert.deepEqual(
    decideSessionTransition(session, SessionEvent.QuoteRequested, 1100),
    { kind: 'to_quoted' },
  );

  session.status = SessionStatus.Quoted;
  assert.deepEqual(
    decideSessionTransition(session, SessionEvent.PaymentSubmitted, 1100),
    { kind: 'to_pending' },
  );

  session.status = SessionStatus.Pending;
  assert.deepEqual(
    decideSessionTransition(session, SessionEvent.PaymentConfirmed, 1200, 1200),
    { kind: 'to_settled', settledAt: 1200 },
  );
});

test('subscription: expired session transitions to expired', () => {
  const session = createOpenSession();
  session.expiresAt = 1050;
  assert.deepEqual(
    decideSessionTransition(session, SessionEvent.QuoteRequested, 1100),
    { kind: 'to_expired' },
  );
});

test('subscription: terminal session is no-op', () => {
  const session = createOpenSession();
  session.status = SessionStatus.Settled;
  assert.equal(
    decideSessionTransition(session, SessionEvent.PaymentSubmitted, 1100).kind,
    'no_op',
  );
});

test('subscription: settlement variants (settle, shortfall, pending, rejected)', () => {
  const session = createOpenSession();
  session.status = SessionStatus.Pending;
  session.expiresAt = 2000;

  // Settle successfully
  assert.deepEqual(
    decideSettlement(session, 100_000_000, 100_000_000, true, 1100),
    { kind: 'settle', settledAt: 1100 },
  );

  // Shortfall
  const shortfall = decideSettlement(session, 50_000_000, 100_000_000, true, 1100);
  assert.equal(shortfall.kind, 'shortfall');
  if (shortfall.kind === 'shortfall') {
    assert.equal(shortfall.receivedAsdf, 50_000_000);
    assert.equal(shortfall.requiredAsdf, 100_000_000);
  }

  // Pending confirmation
  assert.deepEqual(
    decideSettlement(session, 100_000_000, 100_000_000, false, 1100),
    { kind: 'pending_confirmation' },
  );

  // Rejected if not in pending status
  const openSess = createOpenSession();
  assert.equal(
    decideSettlement(openSess, 100_000_000, 100_000_000, true, 1100).kind,
    'rejected',
  );
});
