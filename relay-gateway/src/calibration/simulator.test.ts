import test from 'node:test';
import assert from 'node:assert/strict';
import { runEconomicSimulation, type SimulationParams } from './simulator.js';

test('simulator: low volume scenario (100 tx/day, normal network, no subscribers)', () => {
  const params: SimulationParams = {
    dailyTransactions: 100,
    subscribersCount: 0,
    subscriptionPriceUsd: 10,
    x402FeeUsd: 0.005,
    solPriceUsd: 180,
    avgComputeUnits: 150_000,
    priorityFeeMicroLamportsPerCu: 5_000, // standard priority
    jupiterSwapFeeBps: 30,
    burnThresholdUsd: 5.0,
  };

  const res = runEconomicSimulation(params);

  assert.equal(res.dailyRevenue.totalRevenueUsd, 0.50); // 100 * 0.005
  assert.equal(res.margins.isNetPositive, true);
  // Total cost per tx should be around $0.001 - $0.002, margin positive
  assert.ok(res.dailyCosts.networkCostPerTxUsd < 0.005);
  assert.ok(res.margins.profitMarginPercent > 50);
});

test('simulator: congested network scenario (priority fee surge)', () => {
  const normalParams: SimulationParams = {
    dailyTransactions: 1_000,
    subscribersCount: 0,
    subscriptionPriceUsd: 10,
    x402FeeUsd: 0.005,
    solPriceUsd: 200,
    avgComputeUnits: 200_000,
    priorityFeeMicroLamportsPerCu: 1_000,
    jupiterSwapFeeBps: 30,
    burnThresholdUsd: 5.0,
  };

  const congestedParams: SimulationParams = {
    ...normalParams,
    priorityFeeMicroLamportsPerCu: 150_000, // Congestion surge
  };

  const normalRes = runEconomicSimulation(normalParams);
  const congestedRes = runEconomicSimulation(congestedParams);

  assert.ok(congestedRes.dailyCosts.totalNetworkCostUsd > normalRes.dailyCosts.totalNetworkCostUsd);
  // Under extreme congestion, margin drops significantly
  assert.ok(congestedRes.margins.profitMarginPercent < normalRes.margins.profitMarginPercent);
});

test('simulator: target scale scenario (5,000 tx/day + 20 pro subscribers)', () => {
  const params: SimulationParams = {
    dailyTransactions: 5_000,
    subscribersCount: 20,
    subscriptionPriceUsd: 15, // $15 / month
    x402FeeUsd: 0.005,
    solPriceUsd: 180,
    avgComputeUnits: 120_000,
    priorityFeeMicroLamportsPerCu: 10_000,
    jupiterSwapFeeBps: 30,
    burnThresholdUsd: 5.0,
  };

  const res = runEconomicSimulation(params);

  assert.ok(res.dailyRevenue.totalRevenueUsd > 30); // 25 (x402) + 10 (subs)
  assert.ok(res.margins.grossProfitUsd > 20);
  assert.ok(res.waterfallAllocation.asdfBuybackAndBurnUsd > 10);
  // With ~$15/day for burn, monthly burn is ~$450, yielding ~90 batches of $5
  assert.ok(res.burnMetrics.burnBatchesPerMonth > 50);
});
