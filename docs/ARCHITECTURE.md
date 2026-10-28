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
│   Public Domain: relay.talaria.build                   │
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
- **Core Domain:** Pure functions without I/O (`src/domain/quote`, `src/domain/subscription`, `src/domain/priority`).
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
  - Token Mint: `9zB5wECiLiFvBc1EGpDXFaRzThvNdThFQvd3APp6pump` ($ASDF).
  - Mainnet Fee Payer: `Bcuw4Xb9wmjDUpTsADn8ZM9Rigdhehaf5jfbJndH4rcC`.
  - Ingress: `https://relay.talaria.build`.
