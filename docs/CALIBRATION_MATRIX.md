# Calibration matrix — fee sweet spot from live data

> No priced-in mults until measured. Linear pricing now; brackets emerge
> from this grid. Simulation sweeps are free; real txs sample the grid.

## Dimensions (cross-product = the matrix)

| Dim | Values | Notes |
|-----|--------|-------|
| `cu_bracket` | 50k, 200k, 400k, 800k, 1.2M, 1.4M | full spectrum, max first |
| `priority_level` | low / medium / high / congested | Helius estimate at quote time |
| `payment_token` | USDC, wSOL, memecoin (volatile) | Jupiter quote + slippage |
| `tx_size` | < 600B, 600–1000B, > 1000B (near MTU 1232) | size affects landing |
| `account_state` | existing only / one new ATA / new account | rent costs |

## Metrics per cell

`quoted_fee`, `actual_cost` (lamports + CU consumed, not requested),
`margin`, `land_latency_ms`, `landed` (bool), `fail_reason`,
`jupiter_slippage_bps`. One JSONL line per probe.

## Method

1. **Sim sweep (free):** `simulateTransaction` over the full grid, no
   submission. Fills cost/latency estimates per cell.
2. **Real sampling:** submit at grid corners + median cells only
   (~10 txs ≈ 0.0001 SOL). Confirms sim vs reality gap.
3. **Fit:** linear regression margin-per-cell → CU price mults per
   bracket + congestion multiplier. Refit monthly.
4. **Risk matrix:** cells with negative margin or fail rate > 5% →
   price mult, cap, or refuse. Decision by data, never by guess.

## Outputs

- `CU_PRICE_PER_KCU_LAMPORTS` fitted value.
- Bracket mults (init all 1.0) or refusal codes per cell.
- Congestion multiplier rule.
- Monthly refit report in the cost ledger.
