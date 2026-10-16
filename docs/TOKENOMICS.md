# GASdf service tokenomics — v0

> Operator-decided. All amounts append-only in the cost ledger; no
> printable money, no rewards, no tiers until the yield gate opens
> (see `MVP_SCOPE.md`).

## 1. Primitives

| Primitive | Unit | Rule |
|-----------|------|------|
| `quote` | token units, TTL 60s | flat price, no negotiation |
| `payment` | token transfer user → treasury ATA | verified offchain, program later |
| `cost` | lamports + CU + offchain compute | 1 ledger line per tx |
| `hot_reserve` | native SOL | execution capacity, refilled first |
| `cold_reserve` | USDC | treasury safety |
| `burn_lot` | $ASDFASDFA bought + burned | weekly manual lot with proof |

## 2. Fee formula

```
priority  = helius estimate (fallback 1000 µCU)
fee_lamports = BASE_FEE_LAMPORTS (50000) + priority_lamports
cost_tx      = 5000 + priority_lamports (+ rent if new account)
margin       = fee_lamports − cost_tx
```

Fee converted to the chosen payment token via Jupiter at quote time.
Live reference 2026-10-16: ~5289 USDC base units (~$0.0053) per relay.

## 3. Margin waterfall (sequential thresholds, not percentages)

1. Refill `hot_reserve` to `HOT_TARGET_SOL` (operator param).
2. Refill `cold_reserve` to `COLD_TARGET_USDC` (operator param).
3. `burn_lot`: 100% of remaining margin buys $ASDFASDFA → burn, weekly,
   one onchain proof per lot.
4. `operator`: only what exceeds 1–3. Last, never first.

## 4. Token cache rule

Hold a received token only if `amount > swap_cost + rents + margin_min`.
Else swap immediately toward hot SOL / cold USDC. Never hold memecoins
or $ASDFASDFA as inventory — convert on receipt, burn on schedule.

## 5. Forbidden until yield gate

Tiers, scores, staking, revenue-sharing, auto-compounding, discounts.
Every margin before the gate funds reserves and burn, never rewards.

## 6. Stage mapping

- `usable` now: relay proven, flat fees, measured costs.
- `viable`: margin covers infra + refills for 30 consecutive days.
- `standard`: external users pay without knowing CYNIC exists.
- `native`: only after yield gate + governance §6b conditions.
