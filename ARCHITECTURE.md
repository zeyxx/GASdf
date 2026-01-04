# GASdf Architecture

> Gasless transactions for Solana. Pay fees with any token. All fees become **$asdfasdfa** and burn forever.

## Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   GASdf     │────▶│   Solana    │
│  (Wallet)   │     │    API      │     │  Mainnet    │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    ┌─────────┐      ┌─────────┐      ┌─────────┐
    │  Redis  │      │ Jupiter │      │ HolDex  │
    │  Cache  │      │   Swap  │      │ K-score │
    └─────────┘      └─────────┘      └─────────┘
```

## Transaction Flow

### 1. Quote Phase
```
Client                    GASdf                      External
  │                         │                           │
  │──POST /v1/quote────────▶│                           │
  │   paymentToken          │──isTokenAccepted()───────▶│ HolDex
  │   userPubkey            │◀─────────────────────────│
  │                         │                           │
  │                         │──getFeeInToken()─────────▶│ Jupiter
  │                         │◀─────────────────────────│
  │                         │                           │
  │                         │──reserveBalance()         │
  │                         │  (fee payer pool)         │
  │                         │                           │
  │◀─────quoteId, feePayer──│                           │
  │      feeAmount, ttl     │                           │
```

### 2. Submit Phase
```
Client                    GASdf                      Solana
  │                         │                           │
  │  (builds tx with        │                           │
  │   feePayer, signs)      │                           │
  │                         │                           │
  │──POST /v1/submit───────▶│                           │
  │   quoteId               │──validateTransaction()    │
  │   signedTx              │  (signer, validator)      │
  │                         │                           │
  │                         │──co-sign with feePayer────│
  │                         │                           │
  │                         │──sendTransaction()───────▶│
  │                         │◀──────signature──────────│
  │                         │                           │
  │◀───────signature────────│                           │
```

### 3. Burn Phase (Background)
```
Burn Worker                Treasury                  Solana
  │                           │                         │
  │  (every 60s)              │                         │
  │──check pending fees──────▶│                         │
  │                           │                         │
  │  if fees > threshold:     │                         │
  │──swap to $asdfasdfa via Jupiter                     │
  │                           │                         │
  │──burn 76.4% of $asdfasdfa──────────────────────────▶│
  │  (retain 23.6% for treasury)                        │
  │                           │                         │
  │──record burn proof────────│                         │
```

## Directory Structure

```
src/
├── index.js                 # Express app entry point
│
├── routes/
│   ├── quote.js             # POST /v1/quote - Fee quotes
│   ├── submit.js            # POST /v1/submit - Transaction submission
│   ├── tokens.js            # GET /v1/tokens - Accepted tokens
│   ├── stats.js             # GET /v1/stats - Burn statistics
│   ├── health.js            # GET /health - Health checks
│   └── admin.js             # Admin endpoints (auth required)
│
├── services/
│   ├── jupiter.js           # Jupiter swap API integration
│   ├── signer.js            # Fee payer wallet management
│   ├── validator.js         # Transaction validation (Ed25519)
│   ├── burn.js              # Background burn worker
│   ├── token-gate.js        # Token acceptance logic (K-score)
│   ├── holder-tiers.js      # $asdfasdfa holder discount tiers
│   ├── fee-payer-pool.js    # Fee payer balance management
│   ├── treasury-ata.js      # Treasury token accounts
│   ├── pyth.js              # Pyth oracle for stablecoin prices
│   ├── holdex.js            # HolDex API for token verification
│   ├── alerting.js          # Discord/Slack alerts
│   ├── audit.js             # Audit logging (PII anonymized)
│   ├── anomaly-detector.js  # Rate limit & abuse detection
│   └── tx-queue.js          # Transaction retry queue
│
├── middleware/
│   ├── security.js          # Rate limiting, IP blocking
│   └── validation.js        # Request validation (Joi)
│
└── utils/
    ├── config.js            # Environment configuration
    ├── redis.js             # Redis client & helpers
    ├── rpc.js               # Solana RPC connection pool
    ├── logger.js            # Structured logging
    ├── metrics.js           # Prometheus metrics
    ├── db.js                # PostgreSQL client
    ├── circuit-breaker.js   # Circuit breaker pattern
    ├── safe-math.js         # Overflow-safe math
    └── fetch-timeout.js     # HTTP with timeout

packages/
└── sdk/                     # gasdf-sdk npm package
    ├── src/
    │   ├── index.ts         # Main SDK class
    │   └── react.tsx        # React hooks
    └── package.json

public/
├── index.html               # Landing page (Three.js + CSS singularity)
└── og-image.svg             # Social sharing image
```

## Key Concepts

### Token Gating (K-Score)
Tokens must be verified by [HolDex](https://holdex-api.onrender.com) before acceptance.
*Source: `src/services/holdex.js:104-113`*

| Tier | K-Score | Fee Multiplier | Status |
|------|---------|----------------|--------|
| 💎 Diamond | 90-100 | 1.0x | Hardcoded (SOL, USDC, USDT, $asdfasdfa) |
| 💠 Platinum | 80-89 | 1.0x | Accepted |
| 🥇 Gold | 70-79 | 1.0x | Accepted |
| 🥈 Silver | 60-69 | 1.1x | Accepted |
| 🥉 Bronze | 50-59 | 1.2x | Accepted (minimum for gas) |
| 🟤 Copper | 40-49 | — | **Rejected** |
| ⚫ Iron | 20-39 | — | **Rejected** |
| 🔩 Rust | 0-19 | — | **Rejected** |

### Holder Tiers (Discounts)
$asdfasdfa holders get fee discounts based on share of total supply.
*Source: `src/services/holder-tiers.js:146-153`*

| Tier | Share of Supply | Discount |
|------|-----------------|----------|
| DIAMOND | ≥ 1% | 95% (cap) |
| PLATINUM | ≥ 0.1% | 67% |
| GOLD | ≥ 0.01% | 33% |
| SILVER | ≥ 0.001% | 0% |
| BRONZE | < 0.001% | 0% |

Formula: `discount = min(95%, (log₁₀(share) + 5) / 3)`

### E-Score (Harmony)
Engagement-based discount with 7 φ-weighted dimensions:
- Hold (φ⁶), Burn (φ⁵), Use (φ⁴), Build (φ³), Node (φ²), Refer (φ¹), Duration (φ⁰)

Formula: `discount = min(95%, 1 - φ^(-E/25))`
*Source: `src/services/harmony.js:66, 126-131`*

**Combined**: `max(holderDiscount, eScoreDiscount)` — cap **95%**

### Burn Economics (Golden Ratio φ)
```
φ = 1.618033988749894...

Treasury ratio:  1/φ³  = 23.6%
Burn ratio:      1 - 1/φ³ = 76.4%
Max eco bonus:   1/φ²  = 38.2%

DUAL BURN CHANNEL:
─────────────────────────────────────────────
Payment Token
     │
     ├── If $asdfasdfa ──▶ 100% BURN (zero treasury cut)
     │
     └── If other token ──▶ Jupiter Swap to $asdfasdfa
                                    │
                                    ├── 76.4% ──▶ BURN
                                    └── 23.6% ──▶ Treasury
```

### Circuit Breakers
Automatic protection against cascading failures:
- Redis connection failures → in-memory fallback
- RPC endpoint failures → multi-RPC failover pool
- Fee payer balance depletion → unhealthy marking + alerts
- Jupiter API failures → burn worker retry

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HELIUS_API_KEY` | Yes | Helius RPC API key |
| `REDIS_URL` | Yes | Redis connection URL |
| `FEE_PAYER_PRIVATE_KEY` | Yes | Base58 encoded private key |
| `ASDF_MINT` | Yes | $asdfasdfa token mint address |
| `DATABASE_URL` | No | PostgreSQL connection URL |
| `PROMETHEUS_ENABLED` | No | Enable /metrics endpoint |
| `METRICS_API_KEY` | No | API key for /metrics |
| `HOLDEX_API_URL` | No | HolDex API endpoint (default: holdex-api.onrender.com) |
| `ALERTING_WEBHOOK` | No | Slack/Discord webhook for alerts |

## Testing

```bash
npm test              # Unit tests (741+ tests)
npm run test:coverage # With coverage report
npm run test:e2e      # E2E tests against production
npm run monitor       # Health check (JSON output)
```

## Monitoring

- **Health**: `GET /health` - Full system status
- **Ready**: `GET /health/ready` - Kubernetes readiness probe
- **Metrics**: `GET /metrics` - Prometheus format (requires API key)
- **Stats**: `GET /v1/stats` - Burn statistics

## API Versioning

All endpoints available under `/v1/` prefix:
- `POST /v1/quote`
- `POST /v1/submit`
- `GET /v1/tokens`
- `GET /v1/stats`
- `GET /v1/stats/burns`

## Related Repositories

- [HolDex](https://github.com/zeyxx/HolDex) - Token K-score verification oracle
- [gasdf-sdk](https://www.npmjs.com/package/gasdf-sdk) - JavaScript/TypeScript SDK
- [$asdfasdfa Token](https://solscan.io/token/9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump)
