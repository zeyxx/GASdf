/**
 * Economic Simulation Engine for GASdf v2.
 * Based on docs/CALIBRATION_MATRIX.md and docs/MVP_SCOPE.md.
 *
 * Models revenue vs network cost, priority fees, and buyback/burn waterfall.
 */

export interface SimulationParams {
  dailyTransactions: number;
  subscribersCount: number;
  subscriptionPriceUsd: number; // e.g. $10.00 / month
  x402FeeUsd: number; // e.g. $0.005 / tx
  solPriceUsd: number; // e.g. $180.00
  avgComputeUnits: number; // e.g. 150_000 CU
  priorityFeeMicroLamportsPerCu: number; // 1_000 to 50_000 depending on congestion
  jupiterSwapFeeBps: number; // ~30 bps (0.3%)
  burnThresholdUsd: number; // min $5.00 before batch burn
}

export interface SimulationResult {
  dailyVolume: {
    txCount: number;
    subscribers: number;
  };
  dailyRevenue: {
    x402RevenueUsd: number;
    subscriptionRevenueUsd: number;
    totalRevenueUsd: number;
  };
  dailyCosts: {
    baseSignatureCostUsd: number; // 5000 lamports / tx
    priorityFeeCostUsd: number;
    totalNetworkCostUsd: number;
    networkCostPerTxUsd: number;
  };
  margins: {
    grossProfitUsd: number;
    profitMarginPercent: number;
    isNetPositive: boolean;
  };
  waterfallAllocation: {
    solReserveRefillUsd: number; // Cover ongoing network operations
    coldReserveUsd: number; // 20% safety margin
    asdfBuybackAndBurnUsd: number; // Deflationary pressure
    operatorProfitUsd: number; // Residual
  };
  burnMetrics: {
    burnBatchesPerMonth: number;
    estimatedMonthlyAsdfBurnUsd: number;
  };
}

export function runEconomicSimulation(params: SimulationParams): SimulationResult {
  const {
    dailyTransactions,
    subscribersCount,
    subscriptionPriceUsd,
    x402FeeUsd,
    solPriceUsd,
    avgComputeUnits,
    priorityFeeMicroLamportsPerCu,
    burnThresholdUsd,
  } = params;

  // 1. Revenue Calculation
  const x402RevenueUsd = dailyTransactions * x402FeeUsd;
  const subscriptionRevenueDaily = (subscribersCount * subscriptionPriceUsd) / 30;
  const totalRevenueUsd = x402RevenueUsd + subscriptionRevenueDaily;

  // 2. Cost Calculation
  // Base signature fee on Solana = 5,000 lamports = 0.000005 SOL
  const baseLamportsPerTx = 5_000;
  // Priority fee = (CU * microLamportsPerCu) / 1,000,000
  const priorityLamportsPerTx = Math.floor(
    (avgComputeUnits * priorityFeeMicroLamportsPerCu) / 1_000_000,
  );
  const totalLamportsPerTx = baseLamportsPerTx + priorityLamportsPerTx;
  const solPerTx = totalLamportsPerTx / 1_000_000_000;
  const networkCostPerTxUsd = solPerTx * solPriceUsd;

  const totalNetworkCostUsd = dailyTransactions * networkCostPerTxUsd;
  const baseSignatureCostUsd = dailyTransactions * (baseLamportsPerTx / 1e9) * solPriceUsd;
  const priorityFeeCostUsd = dailyTransactions * (priorityLamportsPerTx / 1e9) * solPriceUsd;

  // 3. Profit Margins
  const grossProfitUsd = totalRevenueUsd - totalNetworkCostUsd;
  const profitMarginPercent = totalRevenueUsd > 0 ? (grossProfitUsd / totalRevenueUsd) * 100 : 0;
  const isNetPositive = grossProfitUsd > 0;

  // 4. Waterfall distribution (as per MVP_SCOPE.md)
  // Step 1: Network refill (totalNetworkCostUsd) is already deducted
  // Step 2: Cold treasury reserve = 20% of net margin
  // Step 3: ASDF Buyback & Burn = 60% of net margin
  // Step 4: Operator profit = 20% of net margin
  let coldReserveUsd = 0;
  let asdfBuybackAndBurnUsd = 0;
  let operatorProfitUsd = 0;

  if (isNetPositive) {
    coldReserveUsd = grossProfitUsd * 0.2;
    asdfBuybackAndBurnUsd = grossProfitUsd * 0.6;
    operatorProfitUsd = grossProfitUsd * 0.2;
  }

  // 5. Burn Cadence
  const monthlyBurnBudgetUsd = asdfBuybackAndBurnUsd * 30;
  const burnBatchesPerMonth =
    burnThresholdUsd > 0 ? Math.floor(monthlyBurnBudgetUsd / burnThresholdUsd) : 0;

  return {
    dailyVolume: {
      txCount: dailyTransactions,
      subscribers: subscribersCount,
    },
    dailyRevenue: {
      x402RevenueUsd,
      subscriptionRevenueUsd: subscriptionRevenueDaily,
      totalRevenueUsd,
    },
    dailyCosts: {
      baseSignatureCostUsd,
      priorityFeeCostUsd,
      totalNetworkCostUsd,
      networkCostPerTxUsd,
    },
    margins: {
      grossProfitUsd,
      profitMarginPercent,
      isNetPositive,
    },
    waterfallAllocation: {
      solReserveRefillUsd: totalNetworkCostUsd,
      coldReserveUsd,
      asdfBuybackAndBurnUsd,
      operatorProfitUsd,
    },
    burnMetrics: {
      burnBatchesPerMonth,
      estimatedMonthlyAsdfBurnUsd: monthlyBurnBudgetUsd,
    },
  };
}
