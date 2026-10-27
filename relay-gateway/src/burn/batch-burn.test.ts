import test from 'node:test';
import assert from 'node:assert/strict';
import { address } from '@solana/kit';
import { evaluateBurnThreshold, type BurnPlan, ASDF_MINT } from './batch-burn.js';

test('batch-burn: skips when balance is zero', () => {
  const plan: BurnPlan = {
    treasury: address('4KaDNU2ey2LMpUq4RXeW2WWeXkL44rvKSrei7ZLnyqRt'),
    tokenMint: ASDF_MINT,
    tokenBalanceBaseUnits: 0n,
    tokenDecimals: 6,
    usdEstimatedValue: 0,
    minThresholdUsd: 5.0,
  };
  const result = evaluateBurnThreshold(plan);
  assert.equal(result.status, 'skipped_below_threshold');
  assert.match(result.reason!, /zero/i);
});

test('batch-burn: skips when below min threshold (prevents fee dissipation)', () => {
  const plan: BurnPlan = {
    treasury: address('4KaDNU2ey2LMpUq4RXeW2WWeXkL44rvKSrei7ZLnyqRt'),
    tokenMint: ASDF_MINT,
    tokenBalanceBaseUnits: 500_000n, // $0.50
    tokenDecimals: 6,
    usdEstimatedValue: 0.50,
    minThresholdUsd: 5.0,
  };
  const result = evaluateBurnThreshold(plan);
  assert.equal(result.status, 'skipped_below_threshold');
  assert.match(result.reason!, /below safety threshold/i);
});

test('batch-burn: accepts when threshold reached', () => {
  const plan: BurnPlan = {
    treasury: address('4KaDNU2ey2LMpUq4RXeW2WWeXkL44rvKSrei7ZLnyqRt'),
    tokenMint: ASDF_MINT,
    tokenBalanceBaseUnits: 15_000_000n, // $15.00
    tokenDecimals: 6,
    usdEstimatedValue: 15.00,
    minThresholdUsd: 5.0,
  };
  const result = evaluateBurnThreshold(plan);
  assert.equal(result.status, 'ready_to_burn');
  assert.equal(result.usdEstimatedValue, 15.00);
});
