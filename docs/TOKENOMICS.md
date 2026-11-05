# GASdf service tokenomics

Flat fee model. No tiers, no rewards, no yield gate, no golden ratio split.
The burn worker burns 100% of received $ASDF directly. All amounts append-only
in the cost ledger.

## 1. Fee model

Hybrid fee per sponsored transaction: base + compute units + priority fee.
No negotiation, no tiers, no scores.

```
fee = BASE_FEE_LAMPORTS
    + CU_PRICE_PER_KCU_LAMPORTS * ceil(min(requestedCU, CU_CAP) / 1000)
    + priorityFeeLamports
```

- `BASE_FEE_LAMPORTS`: 50000
- `CU_PRICE_PER_KCU_LAMPORTS`: 100 (per 1000 CU)
- `CU_CAP`: 1400000 CU (transactions above the cap are refused)
- Priority fee: Helius estimate (fallback 1000 µCU per CU)
- Quote TTL: 60s (`QUOTE_TTL_SECONDS`)

Slippage quote→swap is paid by the user. ATA rents are measured service costs.

## 2. Burn

The burn worker runs every 60s (distributed lock, 120s TTL). It:

1. Checks $ASDF balance in the treasury ATA. If > 0, burns 100% directly.
2. Checks stablecoin balances (USDC, USDT, PYUSD). If >= $5.00, swaps to
   $ASDF via Jupiter, then burns.
3. Minimum burn threshold: $5.00 (5_000_000 base units for 6-decimal tokens).

No split. No treasury reserve from burns. All received $ASDF is burned.

Burn proof recorded per cycle: signature, amount, method, network.

## 3. Accepted tokens

Whitelist model (Phase 0). Accepted: USDC, USDT, PYUSD, SOL, WSOL, $ASDF.

HolDex-listed tokens can be merged into the whitelist (1h cache TTL).

No K-score, no tiers, no conviction gating. Whitelist only.

## 4. Token

- Mint: `9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump`
- Symbol on-chain: `asdfasdfa` (short name: `$ASDF`)
- Decimals: 6
- Origin: pump.fun (not mintable)
- ~15% already burned via creator fees

## 5. Constants

| Constant | Value | Source |
|----------|-------|--------|
| Quote TTL | 60s | `config.QUOTE_TTL_SECONDS` |
| Burn threshold | $5.00 | `relay-gateway/src/burn/batch-burn.ts` (5_000_000 base units) |
| Burn interval | 60s | `relay-gateway/src/burn/batch-burn.ts` |
| Base fee | 50000 lamports | `config.BASE_FEE_LAMPORTS` |
| CU price | 100 lamports / 1000 CU | `config.CU_PRICE_PER_KCU_LAMPORTS` |
| CU cap | 1400000 CU | `config.CU_CAP` |
| Jito tip min | 0.0002 SOL | `JITO_TIP_LAMPORTS` |
| Max tx size | 1232 bytes | `MAX_TX_SIZE` |

## 6. What is NOT implemented

- Golden ratio split (removed from code and on-chain program)
- Tier system (DIAMOND/PLATINUM/GOLD/etc. — dead code, removed)
- K-score token gating (removed)
- Conviction gating (removed from ROADMAP)
- Yield gate / margin waterfall (never implemented)
- Cashback / revenue sharing (never implemented)
- Staking (never implemented)
- Rewards on holdings (never implemented)

These may be revisited if the need is proven. The service turns hybrid only
when the need is proven.
