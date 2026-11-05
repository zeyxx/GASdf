# GASdf Architecture

> **Sovereign Gasless Relay & Atomic Subscription Engine for Solana.**

This document describes the material, observable production architecture of GASdf.

---

## 1. High-Level Topology

```
┌────────────────────────────────────────────────────────┐
│                        CLIENT                          │
│   (TrenchScanner / CultScreener / Frontend dApps)      │
│   Uses: @gasdf/sdk (packages/sdk)                      │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS (TLS via Let's Encrypt)
                            ▼
┌────────────────────────────────────────────────────────┐
│          INGRESS BASTION (LXC 109 - 10.10.10.128)      │
│   Public Domain: gasdf.talaria.build                   │
│   - Caddy (Reverse Proxy + TLS Termination)            │
│   - nftables (Kernel SYN-Flood & Rate Limiting)        │
└───────────────────────────┬────────────────────────────┘
                            │ Reverse Proxy (Internal LAN)
                            ▼
┌────────────────────────────────────────────────────────┐
│          RELAY WORKER & SIGNER (LXC 107 - 10.10.10.127)│
│                                                        │
│   ┌────────────────────────────────────────────────┐   │
│   │ gasdf-relay.service (Port 3000)                │   │
│   │ - Hexagonal Architecture (Domain / Adapters)   │   │
│   │ - SQLite Session Store (WAL mode)              │   │
│   │ - Jupiter DEX Routing & Priority Estimator     │   │
│   │ - Adversarial Wire Tx Inspection (Burn check)  │   │
│   │ - In-Memory Quote Rate Limiter (60 req/min/IP) │   │
│   └───────────────────────┬────────────────────────┘   │
│                           │ Local HTTP                 │
│                           ▼                            │
│   ┌────────────────────────────────────────────────┐   │
│   │ gasdf-kora-mainnet.service (Port 14001)        │   │
│   │ - Isolated Solana Fee-Payer Signer             │   │
│   │ - Strict Whitelist Policy (No transfer,        │   │
│   │   Token/System/Jupiter programs only)          │   │
│   └───────────────────────┬────────────────────────┘   │
└───────────────────────────┼────────────────────────────┘
                            │ Co-signed Transaction Broadcast
                            ▼
┌────────────────────────────────────────────────────────┐
│                   SOLANA MAINNET-BETA                  │
│   - User pays in USDC, USDT, or SOL                    │
│   - Kora covers network gas                            │
│   - Jupiter executes atomic swap                       │
│   - Protocol burns $ASDF fee atomically                │
└────────────────────────────────────────────────────────┘
```

---

## 2. Core Components

### A. Client SDK (`packages/sdk/`)
- Built on modern `@solana/kit` and `@solana/web3.js` v2.
- Handles quote requests, atomic session management, wallet signing orchestration, and relay submission.
- Fully tested (70/70 passing unit/integration tests).

### B. Relay Gateway (`relay-gateway/`)
- Pure hexagonal architecture (`ADR-001`).
- **Core Domain:** Pure functions without I/O (`relay-gateway/src/domain/quote`, `relay-gateway/src/domain/subscription`, `relay-gateway/src/domain/priority`).
- **Adapters:** SQLite for persistence (`sqlite-session-store.ts`), Jupiter client for route quotes (`quote-client.ts`), and Atomic Tx Builder (`atomic-tx-builder.ts`).
- **Security Gates:**
  - `verifyAtomicSubscriptionTxIntegrity`: Decompiles submitted wire transactions to ensure the Kora fee-payer is retained, the buyer authority matches, and the exact SPL BurnChecked amount for $ASDF is present.
  - Session TTL and staleness enforcement.
  - In-memory rate limiting on quote endpoints.

### C. Isolated Kora Signer (`cynic-kora`)
- High-performance, isolated fee-payer daemon running on LXC 107.
- Enforces an immutable security policy (`kora-mainnet.toml`):
  - `allow_transfer = false` (prevents malicious drains of the signer's SOL).
  - Program Whitelist: System Program, SPL Token Program, SPL Associated Token Program, Jupiter v6, Raydium CPMM / CLMM / AMM.

### D. Testing & Simulation Substrate (`scripts/` & Surfpool)
- Development and adversarial testing leverage **Surfpool** (LiteSVM on `192.168.0.25:8899`).
- Mainnet account states (USDC mint, Jupiter pools, $ASDF) are forked on demand with sub-second execution without consuming mainnet SOL.

---

## 3. Storage & Consensus Proofs

- **Database:** SQLite running locally on LXC 107 (`/var/lib/cynic/projects/kora/relay-gateway/data/sessions.db`).
- **Authority SSOT:**
  - Token Mint: `9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump` (symbol on-chain: `asdfasdfa`, short name: `$ASDF`).
  - Token Name (on-chain): `asdfasdf`
  - Mainnet Fee Payer: `Bcuw4Xb9wmjDUpTsADn8ZM9Rigdhehaf5jfbJndH4rcC`.
  - Ingress: `https://gasdf.talaria.build`.

---

## 10. B2B2C Trust Model

GASdf is B2B2C. Integrators (B2B) embed GASdf in their products. End users (B2C) never interact with GASdf directly.

### Trust Layers

| Layer | Who trusts whom | Mechanism |
|---|---|---|
| End user → Integrator | User trusts TrenchScanner's UI | SIWS auth, familiar wallet flow |
| Integrator → GASdf | Integrator trusts GASdf's execution | On-chain verification (SPL burn, Jupiter slippage) |
| GASdf → Solana | GASdf trusts the chain | Standard Solana programs |

### What Integrators Can Verify On-Chain

- SPL burn instruction (burn actually happened)
- Jupiter swap slippage (fee within tolerance)
- Token transfer (correct amount, correct destination)
- Transaction signature (user signed)

### What Integrators Must Trust Off-Chain

- Tx assembly correctness (server builds the tx)
- Fee calculation accuracy (server computes the fee)
- Relayer uptime (Kora signer availability)
- Ledger accuracy (append-only JSONL)

### V2 Trust Improvements

- Squads multisig for treasury (integrator can verify who controls funds)
- On-chain fee verification program (integrator can verify fee <= maxFee)
- Subscription PDA (integrator can verify subscription state on-chain)

## 11. On-Chain vs Off-Chain Decision Matrix

| Function | Layer | SOTA Practice | V2 Program? |
|---|---|---|---|
| Tx assembly | Off-chain | Jupiter does the same | No |
| Gas payment | Off-chain | Kora (Solana Foundation standard) | No |
| Price oracle | Off-chain | Jupiter API + Pyth | No |
| Auth | Off-chain | SIWS | No |
| Token swap | On-chain | Jupiter/Orca program | No (existing) |
| Token burn | On-chain | SPL burn instruction | No (existing) |
| Token transfer | On-chain | SPL transfer | No (existing) |
| Fee calculation | Off-chain (V1) | Slippage on-chain (Jupiter pattern) | Yes (V2) |
| Treasury management | Off-chain (V1) | Squads multisig | Yes (V2) |
| Subscription state | Off-chain (V1) | On-chain PDA | Yes (V2) |
| Subscription renewal | Off-chain (V1) | Keeper/cron on-chain | Yes (V2) |

## 12. Webhook Contract (Proposed)

**Direction**: TrenchScanner → Trading Agent (NOT GASdf)

**Endpoint**: `POST /webhook/alerts`
**Auth**: HMAC-SHA256 (shared secret in `X-GASdf-Signature` header)
**Retry**: 3× on non-2xx with exponential backoff

**Payload**:
```json
{
  "token": "mint_address",
  "alertSnapshot": { "mcap": 0, "timestamp": 0, "score": 0 },
  "latest": { "mcap": 0, "timestamp": 0 },
  "peak": { "mcap": 0, "timestamp": 0 },
  "curated": { "model": "string", "verdicts": [], "confidence": 0 }
}
```

**Response**: 2xx on success, 4xx on invalid payload, 5xx triggers retry.
