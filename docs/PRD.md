# GASdf Product Requirements Document (Evolving)

> **Status**: Living document. Updated as the product evolves.
> **Last updated**: 2026-11-06
> **Owner**: zeyxx

---

## 1. What GASdf IS

GASdf is a **gasless transaction execution layer** on Solana. It enables users to pay transaction fees in SPL tokens (USDC, USDT, SOL, $ASDF) instead of native SOL.

**Core value proposition**: 0 SOL needed. 1 on-chain signature. Non-custodial. Atomic execution (swap + burn in 1 tx).

**Business model**: B2B2C. GASdf sells execution to integrators (B2B), who serve end users (B2C). Integrators verify what GASdf does on-chain (SPL burn, Jupiter slippage). End users never connect to GASdf directly.

## 2. What GASdf IS NOT

- NOT a trading agent (does not make buy/sell decisions)
- NOT a token scanner (does not discover or score tokens)
- NOT an oracle (does not provide price data)
- NOT a wallet (does not hold user funds)
- NOT a subscription billing engine (execution layer only; subscription logic is a separate bounded context)

## 3. Architecture

### 3.1 Hexagonal (Ports & Adapters)

```
Domain (pure logic, zero I/O)
  ├── gasless/ (quote, submit, burn decision)
  ├── subscription/ (plan, session, renewal)
  └── atomic/ (tx integrity, rent recovery)

Adapters (side effects behind ports)
  ├── jupiter/ (DEX routing)
  ├── kora/ (fee-payer signer)
  ├── storage/ (SQLite session store)
  └── builder/ (atomic tx construction)

Facilitator (x402 payment protocol)
  ├── /verify, /settle, /supported

Gateway (HTTP entry point)
  └── /relay/send, /relay/send-upto, /health
```

### 3.2 On-chain vs Off-chain

| Function | Layer | Justification |
|---|---|---|
| Tx assembly | Off-chain (server) | Standard (Jupiter does the same) |
| Gas payment | Off-chain (Kora relayer) | Standard (Solana Foundation Kora) |
| Price oracle | Off-chain (Jupiter API) | Standard |
| Auth | Off-chain (SIWS) | Standard |
| Token swap | On-chain (Jupiter program) | Slippage protection verified on-chain |
| Token burn | On-chain (SPL burn) | Verifiable by anyone |
| Token transfer | On-chain (SPL transfer) | Standard |
| Fee calculation | Off-chain (server) | V1: trust-based. V2: on-chain verification program |
| Treasury management | Off-chain (wallet) | V1: trust-based. V2: Squads multisig |
| Subscription state | Off-chain (SQLite) | V1: trust-based. V2: on-chain PDA |

### 3.3 Trust Model (B2B2C)

- **End users**: never connect to GASdf. Wallet stays on integrator's side. User signs 1 tx.
- **Integrators**: verify on-chain what GASdf claims (SPL burn, Jupiter slippage). Trust server for tx assembly and fee calculation.
- **Scaling trust**: Squads multisig for treasury (V2), fee verification program (V2), subscription PDA (V2).

## 4. Relationship with Other Projects

### 4.1 TrenchScanner (sollama58)

- **Role**: Intelligence layer (memecoin scanning, scoring, curated alerts)
- **Integration**: GASdf provides execution for TrenchScanner's users (gasless tx)
- **Communication**: Webhook (TrenchScanner → trading agent), Stats API (TrenchScanner → trading agent), GASdf SDK (trading agent → GASdf)
- **Status**: Stats API built (bearer token needed), webhook sender unconfirmed

### 4.2 Trading Agent (separate project, to be built)

- **Role**: Decision layer (receives TrenchScanner signals, decides when/how to trade, calls GASdf for execution)
- **Status**: Not started. Bases being laid.
- **Relationship**: Consumes TrenchScanner intelligence, uses GASdf execution, calibrates against TrenchScanner stats

### 4.3 CYNIC (agent framework)

- **Role**: Orchestration framework (long-term)
- **Status**: Heavy refactoring, not in critical path
- **Relationship**: GASdf will be dogfooded by CYNIC agents when stable

## 5. V1 vs V2

### V1 (Current — MVP)

- Server-assembled transactions
- Kora relayer (gas payment)
- Atomic bundling (swap + burn, 1 tx)
- Append-only ledger (JSONL)
- Threshold-aware batch burn ($5 minimum)
- SDK TypeScript (gasdf-sdk@2.0.1)
- x402 facilitator (verify/settle/supported)
- Subscription API (plans, sessions, quote, settle)

### V2 (Scaling — on-chain program)

- Squads multisig for treasury
- On-chain fee verification program
- Subscription PDA (recurring billing on-chain)
- CultScreener adapter (dynamic token basket)
- Dynamic slippage guard

## 6. Webhook Contract (Proposed)

**Direction**: TrenchScanner → Trading Agent (not GASdf)

**Format**: POST with full alert card JSON

```json
{
  "token": "mint_address",
  "alertSnapshot": { "mcap", "timestamp", "score" },
  "latest": { "mcap", "timestamp" },
  "peak": { "mcap", "timestamp" },
  "curated": { "model", "verdicts", "confidence" }
}
```

**Auth**: HMAC signature (shared secret)
**Retry**: 3× on non-2xx
**Same for**: filter matches (if cheap)

## 7. Token Basket (V1)

Restricted to high-liquidity assets:
- SOL (native)
- USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)
- USDT (`Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`)
- $ASDF (`9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump`)

## 8. Economic Model

- Flat fee: 50000 lamports base, 2.0x markup, 5000 lamports network fee
- 100% direct burn (no treasury split, no golden ratio)
- Burn threshold: $5.00 (5_000_000 base units for 6-decimal)
- Burn cycle: 60s
- Quote TTL: 60s
- Ingress: gasdf.talaria.build

## 9. Open Questions

1. Does V1 need on-chain program for B2B trust, or is server-assembled sufficient?
2. What is the exact webhook format? (GCR to validate)
3. Should the trading agent reuse GCR's heuristics or build its own?
4. How to formalize the subscription recurring billing (token delegation)?
5. What is the SLA/uptime requirement for B2B integrators?

---

*This document evolves. Update as decisions are made.*
