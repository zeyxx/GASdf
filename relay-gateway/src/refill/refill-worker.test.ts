import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRefillNeed } from './refill-worker.js';

test('refill: no action when signer is SAFU (>= 0.5 SOL)', () => {
  const status = evaluateRefillNeed(0.75, 100.0, 180.0);
  assert.equal(status.actionRequired, 'none');
  assert.equal(status.solNeeded, 0);
  assert.equal(status.usdcCostEstimated, 0);
  assert.match(status.reason, /is SAFU/i);
});

test('refill: triggers refill when below floor and treasury can cover target', () => {
  // Current live state: ~0.004 SOL, treasury has $200
  const status = evaluateRefillNeed(0.004, 200.0, 180.0);
  assert.equal(status.actionRequired, 'refill_needed');
  assert.ok(status.solNeeded > 0.99); // needs ~0.996 SOL to reach 1.0 SOL
  assert.ok(status.usdcCostEstimated > 175); // ~0.996 * 180 = ~179.28
  assert.match(status.reason, /sufficient funds/i);
});

test('refill: flags critical_underfunded when treasury cannot cover refill', () => {
  // Low signer balance and only $5 in treasury
  const status = evaluateRefillNeed(0.05, 5.0, 180.0);
  assert.equal(status.actionRequired, 'critical_underfunded');
  assert.equal(status.solNeeded, 0.95);
  assert.equal(status.usdcCostEstimated, 0.95 * 180.0);
  assert.match(status.reason, /cannot cover full refill/i);
});
