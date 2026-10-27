/**
 * Autonomous SOL Refill Worker.
 *
 * Implements the core survival invariant from docs/TOKENOMICS.md & docs/MVP_SCOPE.md:
 * - Reads Kora signer SOL balance.
 * - If balance < HOT_FLOOR (0.5 SOL), service is under SAFU threshold.
 * - Evaluates treasury reserves (USDC/USDT).
 * - Refills signer with SOL to reach HOT_TARGET before allowing $ASDF buyback & burn.
 */

export const HOT_FLOOR_SOL = 0.5; // Min safe reserve
export const HOT_TARGET_SOL = 1.0; // Refill target

export interface RefillStatus {
  signerBalanceSol: number;
  treasuryUsdcBalance: number;
  solPriceUsd: number;
  actionRequired: 'none' | 'refill_needed' | 'critical_underfunded';
  solNeeded: number;
  usdcCostEstimated: number;
  reason: string;
}

export function evaluateRefillNeed(
  signerBalanceSol: number,
  treasuryUsdcBalance: number,
  solPriceUsd: number,
  hotFloor: number = HOT_FLOOR_SOL,
  hotTarget: number = HOT_TARGET_SOL,
): RefillStatus {
  if (signerBalanceSol >= hotFloor) {
    return {
      signerBalanceSol,
      treasuryUsdcBalance,
      solPriceUsd,
      actionRequired: 'none',
      solNeeded: 0,
      usdcCostEstimated: 0,
      reason: `Signer balance (${signerBalanceSol.toFixed(4)} SOL) is SAFU (>= ${hotFloor} SOL).`,
    };
  }

  const solNeeded = Math.max(0, hotTarget - signerBalanceSol);
  const usdcCostEstimated = solNeeded * solPriceUsd;

  if (treasuryUsdcBalance < usdcCostEstimated) {
    return {
      signerBalanceSol,
      treasuryUsdcBalance,
      solPriceUsd,
      actionRequired: 'critical_underfunded',
      solNeeded,
      usdcCostEstimated,
      reason: `Signer is below SAFU (${signerBalanceSol.toFixed(4)} SOL < ${hotFloor} SOL) and treasury ($${treasuryUsdcBalance.toFixed(2)}) cannot cover full refill to ${hotTarget} SOL ($${usdcCostEstimated.toFixed(2)} needed).`,
    };
  }

  return {
    signerBalanceSol,
    treasuryUsdcBalance,
    solPriceUsd,
    actionRequired: 'refill_needed',
    solNeeded,
    usdcCostEstimated,
    reason: `Signer below SAFU (${signerBalanceSol.toFixed(4)} SOL < ${hotFloor} SOL). Treasury has sufficient funds ($${treasuryUsdcBalance.toFixed(2)} >= $${usdcCostEstimated.toFixed(2)}).`,
  };
}
