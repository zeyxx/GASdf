// GASdf gasless relay decisions — pure functions (no I/O, no clock reads).
// Ported from contracts/subscription-reference/src/gasless/decision.rs

import { GasSessionStatus, FeePayerHealth, GasQuoteDecision, SubmitDecision, GasSession, FeePayer } from './types.js';

export function decideFeePayerHealth(fp: FeePayer): FeePayerHealth {
  if (fp.balanceLamports === 0) return FeePayerHealth.Depleted;
  if (fp.balanceLamports < fp.lowBalanceThresholdLamports) return FeePayerHealth.LowBalance;
  return FeePayerHealth.Healthy;
}

export function decideGasQuote(
  session: GasSession,
  feePayer: FeePayer,
  feeLamports: number,
  now: number,
  _quoteTtlSeconds: number,
): GasQuoteDecision {
  if (session.status !== GasSessionStatus.Open && session.status !== GasSessionStatus.Quoted) {
    return { kind: 'reject', reason: 'session not quotable' };
  }
  if (now >= session.expiresAt) {
    return { kind: 'reject', reason: 'session expired' };
  }
  if (feeLamports === 0) {
    return { kind: 'reject', reason: 'fee must be positive' };
  }
  const health = decideFeePayerHealth(feePayer);
  if (health === FeePayerHealth.Depleted) {
    return { kind: 'reject', reason: 'fee payer depleted' };
  }
  if (health === FeePayerHealth.LowBalance && feePayer.balanceLamports < feeLamports) {
    return { kind: 'reject', reason: 'fee payer cannot cover quote' };
  }
  const gasSponsored = feePayer.balanceLamports >= feeLamports;
  return { kind: 'accept', feeLamports, gasSponsored };
}

export function decideSubmit(
  session: GasSession,
  quoteFeeLamports: number,
  validated: boolean,
  signaturePresent: boolean,
  now: number,
): SubmitDecision {
  if (session.status !== GasSessionStatus.Quoted && session.status !== GasSessionStatus.Pending) {
    return { kind: 'reject', reason: 'session not submit-ready' };
  }
  if (now >= session.expiresAt) {
    return { kind: 'reject', reason: 'session expired' };
  }
  if (!validated) {
    return { kind: 'reject', reason: 'transaction failed validation' };
  }
  if (!signaturePresent) {
    return { kind: 'pending_confirmation' };
  }
  return { kind: 'accept', feeLamports: quoteFeeLamports };
}