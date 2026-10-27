import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GasSessionStatus,
  FeePayerHealth,
  type GasSession,
  type FeePayer,
  GASDF_GASLESS_SESSION_SCHEMA,
} from './types.js';
import {
  decideFeePayerHealth,
  decideGasQuote,
  decideSubmit,
} from './decision.js';

function createSession(): GasSession {
  return {
    schema: GASDF_GASLESS_SESSION_SCHEMA,
    sessionId: 'g1',
    buyerPubkey: 'buyer',
    status: GasSessionStatus.Open,
    createdAt: 1000,
    expiresAt: 2000,
    quoteId: null,
    signature: null,
    settledAt: null,
  };
}

function createPayer(balanceLamports: number): FeePayer {
  return {
    pubkey: 'payer',
    balanceLamports,
    lowBalanceThresholdLamports: 10_000,
  };
}

test('gasless: fee payer health variants', () => {
  assert.equal(decideFeePayerHealth(createPayer(50_000)), FeePayerHealth.Healthy);
  assert.equal(decideFeePayerHealth(createPayer(5_000)), FeePayerHealth.LowBalance);
  assert.equal(decideFeePayerHealth(createPayer(0)), FeePayerHealth.Depleted);
});

test('gasless: quote accepts when payer can cover', () => {
  const session = createSession();
  const decision = decideGasQuote(session, createPayer(50_000), 4_000, 1100, 300);
  assert.equal(decision.kind, 'accept');
  if (decision.kind === 'accept') {
    assert.equal(decision.feeLamports, 4000);
    assert.equal(decision.gasSponsored, true);
  }
});

test('gasless: quote rejects depleted, zero fee or expired', () => {
  const session = createSession();
  assert.equal(decideGasQuote(session, createPayer(0), 4_000, 1100, 300).kind, 'reject');
  assert.equal(decideGasQuote(session, createPayer(50_000), 0, 1100, 300).kind, 'reject');

  session.expiresAt = 1050;
  assert.equal(decideGasQuote(session, createPayer(50_000), 4_000, 1100, 300).kind, 'reject');
});

test('gasless: submit pending then accept', () => {
  const session = createSession();
  session.status = GasSessionStatus.Quoted;
  session.expiresAt = 2000;

  const pending = decideSubmit(session, 4_000, true, false, 1100);
  assert.equal(pending.kind, 'pending_confirmation');

  const accepted = decideSubmit(session, 4_000, true, true, 1100);
  assert.equal(accepted.kind, 'accept');
  if (accepted.kind === 'accept') {
    assert.equal(accepted.feeLamports, 4_000);
  }
});

test('gasless: submit rejects invalid or expired', () => {
  const session = createSession();
  session.status = GasSessionStatus.Quoted;
  session.expiresAt = 2000;

  assert.equal(decideSubmit(session, 4_000, false, true, 1100).kind, 'reject');

  session.expiresAt = 1050;
  assert.equal(decideSubmit(session, 4_000, true, true, 1100).kind, 'reject');
});
