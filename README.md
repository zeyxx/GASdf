# GASdf

**Gasless transactions for Solana.** Pay network fees with any token instead of SOL.

All fees become **$asdfasdfa** and burn forever. Pure golden ratio economics (φ).

[![Version](https://img.shields.io/badge/version-1.8.0-blue.svg)](https://github.com/zeyxx/GASdf/releases)
[![Live](https://img.shields.io/badge/status-live-brightgreen)](https://gasdf-43r8.onrender.com)
[![Tests](https://img.shields.io/badge/tests-741%20passing-brightgreen.svg)](#testing)
[![Security](https://img.shields.io/badge/security-12%2F12%20layers-brightgreen.svg)](#security)

## Architecture Overview

```
                              ┌─────────────────────────────────────────┐
                              │              CLIENT                      │
                              │         (User Wallet/dApp)               │
                              └────────────────┬────────────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
                    ▼                          ▼                          ▼
             ┌───────────┐              ┌───────────┐              ┌───────────┐
             │  /quote   │              │  /submit  │              │  /health  │
             └─────┬─────┘              └─────┬─────┘              └───────────┘
                   │                          │
                   └──────────────┬───────────┘
                                  │
┌─────────────────────────────────┼─────────────────────────────────────────────┐
│                        EXPRESS.JS SERVER (Port 3000)                          │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                     12-LAYER SECURITY MIDDLEWARE                        │  │
│  │  Helmet │ Rate Limit │ Validation │ Anti-Replay │ Drain Protection     │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                  │                                            │
│  ┌───────────────────────────────┼───────────────────────────────────────┐   │
│  │                           SERVICES                                     │   │
│  │                                                                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │   signer    │  │  validator  │  │   jupiter   │  │    burn     │  │   │
│  │  │  (fee pay)  │  │ (tx checks) │  │   (swaps)   │  │  (worker)   │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  │                                                                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │   oracle    │  │   holdex    │  │   anomaly   │  │   audit     │  │   │
│  │  │  (K-score)  │  │ (token gate)│  │ (detection) │  │  (logging)  │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
┌───────────────┐         ┌───────────────┐         ┌───────────────┐
│  Solana RPC   │         │    Redis      │         │   External    │
│  (Helius +    │         │  (State +     │         │    APIs       │
│   fallbacks)  │         │   Locking)    │         │               │
│               │         │               │         │ • Jupiter     │
│ • getBalance  │         │ • Quotes      │         │ • HolDex      │
│ • sendTx      │         │ • Locks       │         │ • Pyth        │
│ • simulate    │         │ • Burns       │         │               │
└───────────────┘         └───────────────┘         └───────────────┘
        │                         │                         │
        └─────────────────────────┼─────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │    SOLANA BLOCKCHAIN    │
                    │      (mainnet)          │
                    └─────────────────────────┘
```

## Transaction Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         QUOTE → SUBMIT → BURN FLOW                          │
└─────────────────────────────────────────────────────────────────────────────┘

PHASE 1: QUOTE (60s TTL)
═══════════════════════════════════════════════════════════════════════════════
User                              GASdf                              External
  │                                 │                                    │
  ├─── POST /quote ────────────────►│                                    │
  │    {paymentToken, userPubkey}   │                                    │
  │                                 ├─── Token gate check ──────────────►│ HolDex
  │                                 │    (K-score >= 50?)                 │
  │                                 │◄── {kScore: 85, tier: "Platinum"} ─┤
  │                                 │                                    │
  │                                 ├─── Get swap rate ─────────────────►│ Jupiter
  │                                 │    (token → SOL)                    │
  │                                 │◄── {rate, slippage} ───────────────┤
  │                                 │                                    │
  │                                 ├─── Reserve fee payer (mutex)       │
  │                                 │    └─ Check balance                │
  │                                 │    └─ Round-robin select           │
  │                                 │    └─ Store reservation            │
  │                                 │                                    │
  │◄── Quote Response ──────────────┤                                    │
  │    {quoteId, feePayer,          │                                    │
  │     feeAmount, expiresAt}       │                                    │


PHASE 2: SUBMIT (Validation + Execution)
═══════════════════════════════════════════════════════════════════════════════
User                              GASdf                              Solana
  │                                 │                                    │
  ├─── POST /submit ───────────────►│                                    │
  │    {quoteId, signedTx}          │                                    │
  │                                 │                                    │
  │                                 ├─── Load quote from Redis           │
  │                                 │    └─ Check not expired            │
  │                                 │                                    │
  │                                 ├─── Anti-replay (atomic SETNX)      │
  │                                 │    └─ Hash tx, 90s TTL             │
  │                                 │                                    │
  │                                 ├─── Validate transaction:           │
  │                                 │    ├─ Blockhash fresh? ───────────►│
  │                                 │    ├─ Fee payer matches?           │
  │                                 │    ├─ User signature valid? (Ed25519)
  │                                 │    ├─ Drain protection (17 blocked)│
  │                                 │    └─ Fee payment instruction OK?  │
  │                                 │                                    │
  │                                 ├─── Simulate transaction ──────────►│
  │                                 │    └─ Check for CPI attacks        │
  │                                 │◄── Simulation result ──────────────┤
  │                                 │                                    │
  │                                 ├─── Sign with fee payer key         │
  │                                 │                                    │
  │                                 ├─── Send transaction ──────────────►│
  │                                 │    └─ Retry 3x with backoff        │
  │                                 │◄── Signature ──────────────────────┤
  │                                 │                                    │
  │◄── Submit Response ─────────────┤                                    │
  │    {signature, explorerUrl}     │                                    │


PHASE 3: BURN (Background Worker, every 60s)
═══════════════════════════════════════════════════════════════════════════════
                                  GASdf                              Solana
                                    │                                    │
                                    ├─── Acquire distributed lock        │
                                    │    (prevent concurrent burns)      │
                                    │                                    │
                                    ├─── Sum pending fees                │
                                    │    └─ Skip if < 0.1 SOL            │
                                    │                                    │
                                    ├─── Calculate split (φ-based):      │
                                    │    ├─ 76.4% → Burn (1 - 1/φ³)      │
                                    │    └─ 23.6% → Treasury (1/φ³)      │
                                    │                                    │
                                    ├─── Swap to $ASDF (Jupiter) ───────►│
                                    │                                    │
                                    ├─── Burn $ASDF ────────────────────►│
                                    │                                    │
                                    ├─── Store burn proof                │
                                    │    {signature, amount, timestamp}  │
                                    │                                    │
                                    └─── Release lock                    │
```

## Quick Start

```bash
# Install dependencies
npm install

# Development (uses devnet)
npm run dev

# Production
npm start
```

## Dashboard & Analytics

- **Landing Page**: https://asdfasdfa.tech/
- **Analytics Dashboard**: https://asdfasdfa.tech/analytics.html

## SDK

Install the SDK for easy integration:

```bash
npm install gasdf-sdk
```

```javascript
import { GASdf } from 'gasdf-sdk';

const gasdf = new GASdf({ baseUrl: 'https://asdfasdfa.tech' });

// Get a quote
const quote = await gasdf.quote({
  paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  userPubkey: wallet.publicKey.toBase58()
});

// Build your transaction with quote.feePayer as fee payer
// Sign it and submit
const result = await gasdf.submit(quote.quoteId, signedTxBase64);
console.log(`Transaction: ${result.explorerUrl}`);
```

## API Endpoints (v1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/quote` | Get a fee quote (60s TTL) |
| POST | `/v1/submit` | Submit signed transaction |
| GET | `/v1/tokens` | List accepted payment tokens |
| GET | `/v1/stats` | Burn statistics & treasury |
| GET | `/v1/stats/burns` | Verifiable burn proofs |
| GET | `/v1/health` | Service health + RPC status |
| GET | `/metrics` | Prometheus metrics |

### POST /v1/quote

```bash
curl -X POST https://asdfasdfa.tech/v1/quote \
  -H "Content-Type: application/json" \
  -d '{
    "paymentToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "userPubkey": "YourWalletAddress"
  }'
```

### POST /v1/submit

```bash
curl -X POST https://asdfasdfa.tech/v1/submit \
  -H "Content-Type: application/json" \
  -d '{
    "quoteId": "550e8400-e29b-41d4-a716-446655440000",
    "transaction": "base64-encoded-signed-transaction",
    "userPubkey": "YourWalletAddress"
  }'
```

## External Dependencies

| Service | Purpose | Criticality | Fallback |
|---------|---------|-------------|----------|
| **Helius RPC** | Primary Solana RPC | Critical | Triton, Public RPC |
| **Jupiter API** | Token swaps for burns | Critical | None (burns fail) |
| **HolDex** | Token K-score oracle | High | Diamond tokens only |
| **Redis** | State, locking, cache | High | In-memory (dev only) |
| **Pyth** | SOL price feed | Medium | Coingecko, Jupiter |

## Golden Ratio Economics (φ)

All ratios derive from φ = 1.618033988749...

```
Treasury ratio:  1/φ³  = 23.6%
Burn ratio:      1 - 1/φ³ = 76.4%
Max eco bonus:   1/φ²  = 38.2%

Fee Calculation (First Principles):
├─ Network fee: 5,000 lamports (Solana base)
├─ Break-even:  5,000 ÷ 0.236 = 21,186 lamports
├─ Base fee:    50,000 lamports (2.36x margin)
└─ No magic numbers - everything derived from φ
```

### $ASDF Holder Discounts

| Tier | Share of Supply | Discount | Formula |
|------|-----------------|----------|---------|
| WHALE | ≥ 1% | 95% | `min(95%, (log₁₀(share) + 5) / 3)` |
| OG | ≥ 0.1% | 67% | Logarithmic scaling |
| BELIEVER | ≥ 0.01% | 33% | Virtuous flywheel |
| HOLDER | ≥ 0.001% | 0% | As burns grow, your share grows |
| NORMIE | < 0.001% | 0% | Still welcome! |

## K-Score Token Gating

Tokens are scored by [HolDex](https://asdev-backend.onrender.com/api) for trustworthiness:

| Tier | K-Score | Acceptance |
|------|---------|------------|
| Diamond | 90-100 | Instant (hardcoded: SOL, USDC, USDT, $ASDF) |
| Platinum | 80-89 | Accepted |
| Gold | 70-79 | Accepted |
| Silver | 60-69 | Accepted |
| Bronze | 50-59 | Accepted |
| Copper | < 50 | **Rejected** |

## Security (12 Layers)

| # | Layer | Implementation |
|---|-------|----------------|
| 1 | Headers | Helmet (CSP, X-Frame, HSTS) |
| 2 | IP Rate Limit | 100 req/min (express-rate-limit) |
| 3 | Wallet Rate Limit | 50 quotes/min per wallet |
| 4 | Input Validation | Joi schemas (base58, UUID) |
| 5 | Anti-Replay | Atomic SETNX (tx hash, 90s TTL) |
| 6 | Fee Payer Health | Balance checks, unhealthy marking |
| 7 | SOL Drain Prevention | 6 System Program instructions blocked |
| 8 | Token Drain Prevention | 11 Token Program instructions blocked |
| 9 | Circuit Breakers | Per-RPC endpoint + fee payer capacity |
| 10 | Audit Logging | PII hashed (HMAC-SHA256) |
| 11 | Anomaly Detection | Baseline learning (30min) + 3σ thresholds |
| 12 | Key Rotation | Graceful retirement + emergency modes |

## File Structure

```
src/
├── index.js                 # Express server entry point
├── routes/
│   ├── quote.js             # POST /v1/quote
│   ├── submit.js            # POST /v1/submit
│   ├── tokens.js            # GET /v1/tokens
│   ├── stats.js             # GET /v1/stats, burns, leaderboard
│   └── health.js            # GET /v1/health, /health/ready
├── services/
│   ├── signer.js            # Fee payer wallet management
│   ├── fee-payer-pool.js    # Multi-wallet pool + key rotation
│   ├── validator.js         # Transaction validation (Ed25519)
│   ├── jupiter.js           # Jupiter swap integration
│   ├── burn.js              # $ASDF burn worker (60s interval)
│   ├── oracle.js            # K-score pricing
│   ├── holdex.js            # HolDex API integration
│   ├── holder-tiers.js      # $ASDF holder discount system
│   ├── audit.js             # Audit logging (PII anonymized)
│   ├── alerting.js          # Webhook alerts (Slack/Discord)
│   └── anomaly-detector.js  # Baseline learning + detection
├── middleware/
│   ├── security.js          # Helmet, rate limiting, CSP
│   └── validation.js        # Input validation schemas
└── utils/
    ├── config.js            # Environment configuration
    ├── redis.js             # Redis client + memory fallback
    ├── rpc.js               # Multi-RPC failover pool
    ├── circuit-breaker.js   # Circuit breaker pattern
    └── safe-math.js         # Overflow-safe calculations

public/
├── index.html               # Landing page dashboard
├── analytics.html           # Analytics dashboard (φ-based design)
└── og-image.svg             # Social sharing image

packages/
└── sdk/                     # gasdf-sdk npm package
```

## Environment Variables

```env
# Required
HELIUS_API_KEY=your_helius_key
FEE_PAYER_PRIVATE_KEY=base58_encoded_key
REDIS_URL=redis://localhost:6379

# Token
ASDF_MINT=9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump

# Optional
NODE_ENV=production
PORT=3000
PROMETHEUS_ENABLED=true
ALERTING_WEBHOOK=https://hooks.slack.com/...
```

## Testing

```bash
npm test                    # Run all tests
npm run test:coverage       # With coverage report
```

741 tests covering security, validation, pricing, and integration.

## Deployment

### Render (Recommended)

Uses `render.yaml` for automatic deployment:
1. Connect GitHub repo
2. Set environment variables
3. Deploy

### Docker

```bash
docker build -t gasdf .
docker run -p 3000:3000 --env-file .env gasdf
```

## Monitoring

- **Prometheus**: `GET /metrics` (set `PROMETHEUS_ENABLED=true`)
- **Health checks**: `GET /health`, `/health/ready`, `/health/live`
- **Alerts**: Configure `ALERTING_WEBHOOK` for critical events

## Links

- **Live API**: https://asdfasdfa.tech
- **Analytics**: https://asdfasdfa.tech/analytics.html
- **Burns**: https://alonisthe.dev/burns
- **HolDex**: https://asdev-backend.onrender.com/api
- **$ASDF Ecosystem**: https://alonisthe.dev

## Known Issues

### npm audit: bigint-buffer vulnerability (CVE-2025-3194) - FIXED ✅

The `bigint-buffer` vulnerability has been **patched** using npm overrides.

**Solution**: We override `bigint-buffer` with `@gsknnft/bigint-buffer@1.4.7`, a secure, actively maintained fork that is fuzz-tested and API-compatible.

```json
"overrides": {
  "bigint-buffer": "npm:@gsknnft/bigint-buffer@^1.4.7"
}
```

**Result**: `npm audit` now reports **0 vulnerabilities**.

Reference: [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg)

## License

MIT
