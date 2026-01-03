# GASdf Architecture

> Gasless transactions for Solana. Pay fees with any token. Fees burn $ASDF.

## Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   GASdf     │────▶│   Solana    │
│  (Wallet)   │     │    API      │     │  Mainnet    │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    ▼             ▼
              ┌─────────┐   ┌─────────┐
              │  Redis  │   │ Jupiter │
              │  Cache  │   │   Swap  │
              └─────────┘   └─────────┘
```

## Transaction Flow

### 1. Quote Phase
```
Client                    GASdf                      External
  │                         │                           │
  │──POST /quote───────────▶│                           │
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
  │──POST /submit──────────▶│                           │
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
  │  (every 5 min)            │                         │
  │──check pending fees──────▶│                         │
  │                           │                         │
  │  if fees > threshold:     │                         │
  │──swap to $ASDF via Jupiter│                         │
  │                           │                         │
  │──burn 76.4% of $ASDF─────────────────────────────▶│
  │  (retain 23.6% for treasury)                       │
  │                           │                         │
  │──record burn proof────────│                         │
```

## Directory Structure

```
src/
├── index.js                 # Express app entry point
│
├── routes/
│   ├── quote.js            # POST /quote - Fee quotes
│   ├── submit.js           # POST /submit - Transaction submission
│   ├── tokens.js           # GET /tokens - Accepted tokens
│   ├── stats.js            # GET /stats - Burn statistics
│   ├── health.js           # GET /health - Health checks
│   └── admin.js            # Admin endpoints (auth required)
│
├── services/
│   ├── jupiter.js          # Jupiter swap API integration
│   ├── signer.js           # Fee payer wallet management
│   ├── validator.js        # Transaction validation
│   ├── burn.js             # Background burn worker
│   ├── token-gate.js       # Token acceptance logic
│   ├── holder-tiers.js     # $ASDF holder discount tiers
│   ├── fee-payer-pool.js   # Fee payer balance management
│   ├── treasury-ata.js     # Treasury token accounts
│   ├── jito.js             # Jito bundles (optional)
│   ├── pyth.js             # Pyth oracle for stablecoin prices
│   ├── holdex.js           # HolDex API for token verification
│   ├── alerting.js         # Discord/Slack alerts
│   ├── audit.js            # Audit logging
│   ├── anomaly-detector.js # Rate limit & abuse detection
│   └── tx-queue.js         # Transaction retry queue
│
├── middleware/
│   ├── security.js         # Rate limiting, IP blocking
│   └── validation.js       # Request validation (Zod)
│
└── utils/
    ├── config.js           # Environment configuration
    ├── redis.js            # Redis client & helpers
    ├── rpc.js              # Solana RPC connection pool
    ├── logger.js           # Structured logging
    ├── metrics.js          # Prometheus metrics
    ├── db.js               # PostgreSQL client
    ├── circuit-breaker.js  # Circuit breaker pattern
    ├── safe-math.js        # Overflow-safe math
    ├── revenue-channels.js # Fee flow tracking
    └── fetch-timeout.js    # HTTP with timeout
```

## Key Concepts

### Token Gating
Tokens must be verified before acceptance:
1. **Diamond tier**: SOL, USDC, USDT (always accepted)
2. **HolDex verified**: Tokens with K-score > 70
3. **Rejected**: Unverified tokens

### Holder Tiers
$ASDF holders get fee discounts:
| Tier | Min Balance | Discount |
|------|-------------|----------|
| WHALE | 1M+ $ASDF | 50% |
| OG | 500K $ASDF | 40% |
| BELIEVER | 100K $ASDF | 30% |
| HOLDER | 10K $ASDF | 20% |
| NORMIE | 0 $ASDF | 0% |

### Burn Economics (Golden Ratio)
```
Fee collected
    │
    ├── 76.4% ──▶ Burned (deflationary)
    │
    └── 23.6% ──▶ Treasury (operations)
```

### Circuit Breakers
Automatic protection against cascading failures:
- Redis connection failures
- RPC endpoint failures
- Fee payer balance depletion

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HELIUS_API_KEY` | Yes | Helius RPC API key |
| `REDIS_URL` | Yes | Redis connection URL |
| `FEE_PAYER_PRIVATE_KEY` | Yes | Base58 encoded private key |
| `ASDF_MINT` | Yes | $ASDF token mint address |
| `PROMETHEUS_ENABLED` | No | Enable /metrics endpoint |
| `METRICS_API_KEY` | No | API key for /metrics |
| `HOLDEX_API_URL` | No | HolDex API endpoint |
| `JITO_ENABLED` | No | Enable Jito bundles |

## Testing

```bash
npm test              # Unit tests (1053 tests)
npm run test:e2e      # E2E tests against production
npm run monitor       # Health check (JSON output)
```

## Monitoring

- **Health**: `GET /health` - Full system status
- **Metrics**: `GET /metrics` - Prometheus format (requires API key)
- **Stats**: `GET /stats` - Burn statistics

## Related Repositories

- [HolDex](https://github.com/zeyxx/HolDex) - Token verification oracle
- [ASDev](https://github.com/zeyxx/ASDev) - Backend API
- [$ASDF Token](https://solscan.io/token/9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump)
