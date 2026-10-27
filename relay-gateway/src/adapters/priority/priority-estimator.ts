/**
 * Resilient Priority Fee Estimator Adapter.
 * Strategy: Jupiter swap computeBudget -> Helius RPC getPriorityFeeEstimate -> Baseline Fallback.
 */

import {
  decidePriorityFee,
  type PriorityEstimate,
  type PriorityLevel,
} from '../../domain/priority/decision.js';

export interface PriorityEstimatorOptions {
  heliusRpcUrl?: string;
  heliusApiKey?: string;
  defaultCuLimit?: number;
}

export class PriorityEstimatorAdapter {
  private heliusRpcUrl?: string;
  private defaultCuLimit: number;

  constructor(opts: PriorityEstimatorOptions = {}) {
    const key = opts.heliusApiKey ?? process.env['HELIUS_API_KEY'];
    if (opts.heliusRpcUrl) {
      this.heliusRpcUrl = opts.heliusRpcUrl;
    } else if (key) {
      this.heliusRpcUrl = `https://mainnet.helius-rpc.com/?api-key=${key}`;
    }
    this.defaultCuLimit = opts.defaultCuLimit ?? 250_000;
  }

  /**
   * Estimates priority fee for a set of write accounts (e.g. AMMs, Mints, Wallets).
   */
  async estimatePriorityFee(
    accountKeys: string[],
    level: PriorityLevel = 'High',
    jupiterMicroLamports?: bigint | null,
    jupiterCuLimit?: number | null,
  ): Promise<PriorityEstimate> {
    const cuLimit = jupiterCuLimit ?? this.defaultCuLimit;

    // 1. Primary engine: Jupiter provided computeBudget
    if (jupiterMicroLamports !== undefined && jupiterMicroLamports !== null && jupiterMicroLamports > 0n) {
      return decidePriorityFee(jupiterMicroLamports, 'jupiter', cuLimit);
    }

    // 2. Secondary engine: Helius RPC getPriorityFeeEstimate
    if (this.heliusRpcUrl && accountKeys.length > 0) {
      try {
        const heliusFee = await this.fetchHeliusEstimate(accountKeys, level);
        if (heliusFee !== null && heliusFee > 0n) {
          return decidePriorityFee(heliusFee, 'helius', cuLimit);
        }
      } catch {
        // Fall through to baseline on Helius network error or rate limit
      }
    }

    // 3. Fallback engine: deterministic safe baseline
    return decidePriorityFee(null, 'fallback_baseline', cuLimit);
  }

  private async fetchHeliusEstimate(
    accountKeys: string[],
    priorityLevel: PriorityLevel,
  ): Promise<bigint | null> {
    if (!this.heliusRpcUrl) return null;

    const res = await fetch(this.heliusRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getPriorityFeeEstimate',
        params: [
          {
            accountKeys: accountKeys.slice(0, 128),
            options: { priorityLevel },
          },
        ],
      }),
      signal: AbortSignal.timeout(2000), // 2s timeout
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { result?: { priorityFeeEstimate?: unknown } };
    const estimate = data.result?.priorityFeeEstimate;
    if (typeof estimate === 'number' && Number.isFinite(estimate) && estimate >= 0) {
      return BigInt(Math.floor(estimate));
    }
    return null;
  }
}
