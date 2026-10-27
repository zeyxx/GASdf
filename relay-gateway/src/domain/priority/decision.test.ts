import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decidePriorityFee,
  DEFAULT_FALLBACK_PRIORITY_MICROLAMPORTS,
  MAX_SAFE_PRIORITY_MICROLAMPORTS,
} from './decision.js';

test('priority domain: uses raw estimate when within bounds', () => {
  const estimate = decidePriorityFee(50_000n, 'helius', 200_000);
  assert.equal(estimate.microLamportsPerCu, 50_000n);
  assert.equal(estimate.source, 'helius');
  assert.equal(estimate.computeUnitLimit, 200_000);
  assert.equal(estimate.isCapped, false);
  // priorityLamports = (200_000 * 50_000) / 1e6 = 10_000 lamports. Total = 10_000 + 5_000 = 15_000
  assert.equal(estimate.estimatedNetworkFeeLamports, 15_000n);
});

test('priority domain: caps exorbitant fees to safety ceiling', () => {
  const exorbitant = 2_000_000n; // 2M uLamports/CU (unsafe spike)
  const estimate = decidePriorityFee(exorbitant, 'helius', 200_000);
  assert.equal(estimate.microLamportsPerCu, MAX_SAFE_PRIORITY_MICROLAMPORTS);
  assert.equal(estimate.isCapped, true);
  // (200_000 * 250_000) / 1e6 = 50_000 lamports. Total = 55_000 lamports.
  assert.equal(estimate.estimatedNetworkFeeLamports, 55_000n);
});

test('priority domain: falls back to baseline when null or zero', () => {
  const estimateNull = decidePriorityFee(null, 'fallback_baseline', 150_000);
  assert.equal(estimateNull.microLamportsPerCu, DEFAULT_FALLBACK_PRIORITY_MICROLAMPORTS);
  assert.equal(estimateNull.source, 'fallback_baseline');

  const estimateZero = decidePriorityFee(0n, 'fallback_baseline', 150_000);
  assert.equal(estimateZero.microLamportsPerCu, DEFAULT_FALLBACK_PRIORITY_MICROLAMPORTS);
});
