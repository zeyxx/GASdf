# Burn Threshold Analysis — $ASDF/$ASDFASDFA

Status: draft v0.1, 2026-11-04. Observed facts + operator reasoning. Not a decision yet.

## 1. The two numbers

| Value | Source | Meaning | Status |
|-------|--------|---------|--------|
| `$0.50` | DESIGN.md (March 2026) | Minimum USDC accumulated before a burn lot is worth executing (swap cost + rent + margin_min). Economic floor. | Historical |
| `$5.00` | ROADMAP.md (current) | Anti-dissipation threshold: prevents burning fees in lots too small to cover swap/rent overhead and remain measurable. | Current |

## 2. Why the threshold exists

A burn lot executes:
1. Jupiter swap: USDC (or other input) → $ASDF (cost: swap fee + slippage + CU).
2. BurnChecked: destroy $ASDF (cost: CU + rent if new ATA).
3. Optional rent recovery: close transient ATA, refund rent to fee payer (ADR-002).

If the accumulated USDC is too small, the swap cost consumes the margin and the burn lot is net-negative or zero. The threshold ensures `amount > swap_cost + rents + margin_min` (archive/TOKENOMICS.md §4 — stale).

## 3. Variables that determine the real threshold

| Variable | Source | Typical value |
|----------|--------|---------------|
| `swap_cost` | Jupiter quote (slippage + fee) | varies per token/liquidity |
| `rent` | ATA creation rent (if new account) | ~0.002 SOL |
| `margin_min` | operator floor | tunable |
| `priority_fee` | Helius estimate | ~40k µCU (medium) |
| `cu_consumed` | actual CU of swap+burn | 50k–400k |
| `jupiter_slippage_bps` | measured | per token |

The real threshold is not a constant: it is `swap_cost + rent + margin_min` evaluated per lot. A fixed $5 or $0.50 is a proxy. The calibration matrix (CALIBRATION_MATRIX.md) provides the data to compute it dynamically.

## 4. How the threshold should evolve

- **Phase 0 (current):** fixed $5 threshold. Simple, conservative, avoids dissipation. Good enough while volume is low.
- **Phase 1 (scaling):** dynamic threshold computed from the calibration matrix: `threshold = median(swap_cost + rent + margin_min) × safety_factor`. Refit monthly.
- **Phase 2 (high volume):** per-token thresholds. Memecoins with high slippage get a higher threshold; USDC/USDT get a lower one.

## 5. Open questions

- Is $5 too conservative? If volume is low, lots accumulate slowly and burn frequency drops. Need data.
- Is $0.50 still viable for high-liquidity tokens (USDC)? Possibly, if swap cost is low.
- Should the threshold be per-token or global? Per-token is more accurate but more complex.
- What is the optimal batch frequency? Cron 60s (DESIGN.md) vs hourly (REBUILD_PLAN). Trade-off: frequency vs cost.

## 6. Recommendation

Do not pick a single number. Instead:
1. Keep $5 as the conservative floor for now (no change).
2. Add a calibration sweep to measure actual `swap_cost + rent + margin_min` per token.
3. Derive a dynamic threshold from the median + safety factor.
4. Revisit monthly. Let data decide, not opinion.

## 7. References

- archive/TOKENOMICS.md §2/§3/§4 (stale)
- DESIGN.md §2.3 (Burn Worker, historical $0.50)
- ROADMAP.md Phase 1 (threshold-aware batch burn, $5)
- CALIBRATION_MATRIX.md (dimensions, metrics, method)
- ADR-002 (rent recovery, SVM)
EOF
echo "written"