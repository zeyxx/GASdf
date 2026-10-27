/**
 * Pure domain rules for Priority Fee & Network Contention estimation.
 * Zero-I/O Core.
 */

export const DEFAULT_FALLBACK_PRIORITY_MICROLAMPORTS = 10_000n; // 10k uLamports/CU baseline
export const MAX_SAFE_PRIORITY_MICROLAMPORTS = 250_000n; // 250k uLamports/CU safety cap
export const DEFAULT_COMPUTE_UNIT_LIMIT = 250_000; // 250k CU baseline for atomic swap+burn

export type PriorityLevel = 'Medium' | 'High' | 'VeryHigh';

export interface PriorityEstimate {
  microLamportsPerCu: bigint;
  computeUnitLimit: number;
  source: 'jupiter' | 'helius' | 'fallback_baseline';
  estimatedNetworkFeeLamports: bigint;
  isCapped: boolean;
}

export function decidePriorityFee(
  rawEstimateMicroLamports: bigint | null,
  source: 'jupiter' | 'helius' | 'fallback_baseline',
  cuLimit: number = DEFAULT_COMPUTE_UNIT_LIMIT,
  maxCap: bigint = MAX_SAFE_PRIORITY_MICROLAMPORTS,
): PriorityEstimate {
  let fee = rawEstimateMicroLamports ?? DEFAULT_FALLBACK_PRIORITY_MICROLAMPORTS;
  let isCapped = false;

  if (fee <= 0n) {
    fee = DEFAULT_FALLBACK_PRIORITY_MICROLAMPORTS;
  } else if (fee > maxCap) {
    fee = maxCap;
    isCapped = true;
  }

  // Priority fee lamports = (CU * microLamportsPerCu) / 1_000_000
  // Plus standard base signature fee (5,000 lamports)
  const priorityLamports = (BigInt(cuLimit) * fee) / 1_000_000n;
  const totalLamports = 5_000n + priorityLamports;

  return {
    microLamportsPerCu: fee,
    computeUnitLimit: cuLimit,
    source,
    estimatedNetworkFeeLamports: totalLamports,
    isCapped,
  };
}
