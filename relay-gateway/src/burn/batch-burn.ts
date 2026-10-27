/**
 * Batch Burn Runner (Phase 1/v2): Threshold-aware swap & burn.
 *
 * Rules:
 * 1. Read balance of treasury ATA or native account.
 * 2. Reject execution if balance is under threshold (avoids burning fees in rent/tx costs).
 * 3. Swap input token to $ASDF via Jupiter if necessary.
 * 4. Burn $ASDF onchain.
 * 5. Append proof to ledger.jsonl.
 */

import { address, type Address } from '@solana/kit';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const ASDF_MINT = address('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');
export const DEFAULT_THRESHOLD_USD = 5.0; // Min $5 accumulated before executing burn

export interface BurnPlan {
  treasury: Address;
  tokenMint: Address;
  tokenBalanceBaseUnits: bigint;
  tokenDecimals: number;
  usdEstimatedValue: number;
  minThresholdUsd: number;
}

export interface BurnResult {
  status: 'skipped_below_threshold' | 'ready_to_burn' | 'burned';
  reason?: string;
  treasury: string;
  tokenMint: string;
  balanceBaseUnits: string;
  usdEstimatedValue: number;
  minThresholdUsd: number;
  burnSignature?: string;
}

export function evaluateBurnThreshold(plan: BurnPlan): BurnResult {
  if (plan.tokenBalanceBaseUnits <= 0n) {
    return {
      status: 'skipped_below_threshold',
      reason: 'Balance is zero',
      treasury: plan.treasury,
      tokenMint: plan.tokenMint,
      balanceBaseUnits: '0',
      usdEstimatedValue: 0,
      minThresholdUsd: plan.minThresholdUsd,
    };
  }

  if (plan.usdEstimatedValue < plan.minThresholdUsd) {
    return {
      status: 'skipped_below_threshold',
      reason: `Accumulated value ($${plan.usdEstimatedValue.toFixed(2)}) is below safety threshold ($${plan.minThresholdUsd.toFixed(2)})`,
      treasury: plan.treasury,
      tokenMint: plan.tokenMint,
      balanceBaseUnits: plan.tokenBalanceBaseUnits.toString(),
      usdEstimatedValue: plan.usdEstimatedValue,
      minThresholdUsd: plan.minThresholdUsd,
    };
  }

  return {
    status: 'ready_to_burn',
    treasury: plan.treasury,
    tokenMint: plan.tokenMint,
    balanceBaseUnits: plan.tokenBalanceBaseUnits.toString(),
    usdEstimatedValue: plan.usdEstimatedValue,
    minThresholdUsd: plan.minThresholdUsd,
  };
}

export function logBurnProof(ledgerPath: string, proof: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(ledgerPath), { recursive: true });
    appendFileSync(
      ledgerPath,
      `${JSON.stringify({ timestamp: new Date().toISOString(), kind: 'batch_burn', ...proof })}\n`,
      'utf8',
    );
  } catch (err) {
    console.error('[BurnRunner] Failed to write burn proof to ledger:', err);
  }
}
