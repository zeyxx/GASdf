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

Slippage quote→swap is paid by the user; swap ops calibrated live under
stress-tests and varied market simulations. ATA rents are measured
service costs (devnet then mainnet calibration, data-centrism).
Payer rotation + cold standby payer land in Phase 0. Onchain vault
program ships when the need is proven — the service turns hybrid then.
Mainnet bootstrap via $ASDFASDFA cult crowdfunding + operator real-world
revenue in parallel. $ASDFASDFA: pumpfun origin, ~15% already burned via
creator fees, not mintable.

## 3. Margin waterfall (formulas with tunable params, no hardcoded amounts)

```
usage_24h   = trailing sponsored lamports (sliding 24h window)
HOT_TARGET  = max(HOT_FLOOR, ALPHA × usage_24h)   # recomputed daily
```

Params (operator-tunable, never code): `HOT_FLOOR` (init 0.5 SOL),
`ALPHA` (init 3× daily usage). Everything above `HOT_TARGET` flows on:

1. `hot_reserve` refill to `HOT_TARGET` (execution capacity first).
2. `cold_reserve` USDC (no cap — safety).
3. surplus split by phase (see §7): reserves first, then burn-share and
   cashback-share params.
4. `operator`: only what exceeds 1–3. Last, never first.

## 4. Token cache rule

Hold a received token only if `amount > swap_cost + rents + margin_min`.
Else swap immediately toward hot SOL / cold USDC. Never hold memecoins
or $ASDFASDFA as inventory — convert on receipt, burn on schedule.

## 5. Forbidden until yield gate

Tiers, scores, staking, revenue-sharing, auto-compounding, discounts.
Every margin before the gate funds reserves and burn, never rewards.

## 6. Distribution phases (moat against 24h clones: reserves + retention)

- **Phase 0 — sliding SOL**: fill `HOT_TARGET` from margin only. No
  operator top-up, no cult top-up. Service must carry its own liquidity.
- **Phase 1 — USDC treasury**: above hot target, fill `COLD_TARGET` =
  `RUNWAY_MONTHS` × monthly infra (Jupiter API, Helius RPC, +1 fallback
  provider) + community audit fund for future protocol upgrades.
  Startup norm is 12–18 months runway; defensible minimum here is 6
  months infra + bug-bounty headroom, 12 before any redistribution risk.
  Sweet spot found by measurement, not by vote.
- **Phase 2 — cashback**: once sliding SOL is stable AND cold covers
  `RUNWAY_MONTHS` + bounty headroom, each user recovers `CASHBACK_SHARE`
  of surplus fees, claimable on-site from the economic minimum
  (`CLAIM_MIN`, lowest viable for the service). Payout in any accepted
  token. From here: no more direct memecoin selling — arbitrage and
  mid/long-term holdings instead.
- **$ASDF tilt**: cashback claimed in $ASDFASDFA earns fee-discount bonus
  + perks (not yield: discount on future fees, never rewards on holdings).

Params: `RUNWAY_MONTHS` = 6 (sweet spot — Solana pace, not YC pace),
`CASHBACK_SHARE`, `CLAIM_MIN`, `BURN_SHARE` (remainder to burn).
All operator-tunable, all ledger-visible.

Conditional raise: only after proven self-sufficiency + formal memecoin
ecosystem recognition, via backable.biz. Never to cover operating losses.

## 7. Stage mapping

- `usable` now: relay proven, flat fees, measured costs.
- `viable`: margin covers infra + refills for 30 consecutive days.
- `standard`: external users pay without knowing CYNIC exists.
- `native`: only after yield gate + governance §6b conditions.
