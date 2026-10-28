# GASdf (Gasless $ASDF Relay)

> **Zero-friction subscription payments for Solana dApps.**  
> Users pay in **USDC, USDT, or SOL** without manual swaps. The relay sponsors network fees (zero SOL required) and atomically converts & burns the fee in **$ASDF** (`9zB5wECiLiFvBc1EGpDXFaRzThvNdThFQvd3APp6pump`).

[![Public Relay](https://img.shields.io/badge/relay-relay.talaria.build-success)](https://relay.talaria.build/health)
[![SDK Tests](https://img.shields.io/badge/sdk%20tests-70%2F70%20passing-brightgreen)](packages/sdk)
[![Relay Tests](https://img.shields.io/badge/relay%20tests-38%2F38%20passing-brightgreen)](relay-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## The Problem

On Solana, recurring subscriptions face two major checkout drop-offs:
1. **Manual Swaps:** Users are forced to find a DEX and manually swap their funds into the protocol token ($ASDF) before subscribing.
2. **Missing Gas:** Wallets holding sufficient tokens (USDC/USDT) often lack the fractional SOL needed to pay transaction fees.

## The Solution

GASdf is an autonomous, sovereign relay gateway:
- **Zero SOL required:** The relay acts as the fee-payer (via hardened Kora signer) so users can transact with an empty SOL balance.
- **Atomic Swap & Burn:** Converts input tokens (USDC, USDT, SOL) into $ASDF via Jupiter and burns the exact fee in the **same atomic transaction**.
- **Drop-in Frontend Integration:** Consumer backends remain untouched. The client SDK handles quoting, transaction building, and sponsored relay submission.

---

## Production Endpoints

- **Public Endpoint:** `https://relay.talaria.build`
- **Health Check:** `https://relay.talaria.build/health`
- **Live Quote API:** `GET /subscription/quote/live?token=USDC&targetAsdf=30000`

---

## Client Integration

### 1. Install SDK

```bash
npm install github:zeyxx/GASdf#sdk
```

*(Or point directly to `packages/sdk` in a monorepo setup).*

### 2. Request a Live Quote & Subscribe

```typescript
import { createGasdfClient } from '@gasdf/sdk';

const client = createGasdfClient({
  baseUrl: 'https://relay.talaria.build',
});

// 1. Fetch live quote
const quote = await client.getLiveQuote({
  token: 'USDC',
  targetAsdf: 30_000,
  appId: 'trenchscanner',
});

console.log(`Input amount: ${quote.inputAmountFormatted} USDC`);
console.log(`Valid for: ${quote.ttlSeconds}s`);

// 2. Prepare transaction & submit via sponsored relay
const session = await client.createSession({
  appId: 'trenchscanner',
  planId: 'pro-monthly',
  buyerPubkey: userWallet.publicKey.toBase58(),
  paymentToken: 'USDC',
});

const prepared = await client.prepareSessionTransaction(session.sessionId);

// Sign with user wallet (authority over input token)
const signedTx = await userWallet.signTransaction(prepared.transaction);

// Relay co-signs fee payer and broadcasts
const result = await client.submitSessionTransaction(session.sessionId, signedTx);
console.log(`Transaction confirmed: https://solscan.io/tx/${result.txSignature}`);
```

For full integration details and examples, see [`docs/CONSUMER_INTEGRATION.md`](docs/CONSUMER_INTEGRATION.md).

---

## Repository Structure

```
├── packages/
│   └── sdk/             # Canonical TypeScript SDK (@gasdf/sdk)
├── relay-gateway/       # Production Relay Gateway (Express + Kora client + Jupiter router)
├── examples/            # Consumer test flows (e.g. consumer-trenchscanner.mjs)
├── contracts/           # Token & program specifications
├── docs/                # Architecture, security audits & integration guides
└── scripts/             # Local LiteSVM (Surfpool) & deployment tools
```

---

## Security & Verification

- **Adversarial Integrity Validation:** Every submitted wire transaction is decompiled and checked prior to relay co-signing. Tampered fee-payers, omitted burns, or modified amounts are rejected immediately.
- **Isolated Signer:** Fee-payer private keys run inside an isolated LXC instance (`cynic-kora`), behind strict program and transfer whitelists.
- **In-Memory Rate Limiting:** Quote routes are protected against API exhaustion (60 req/min/IP).
- **LiteSVM Simulation:** Fully tested locally against Solana mainnet state via [Surfpool](https://github.com/solana-foundation/surfpool).

Run tests locally:

```bash
# Test relay gateway
cd relay-gateway && npm test

# Test SDK
cd packages/sdk && npm test
```

---

## License

MIT © 2026 Titouan Corneloup (zeyxx).
