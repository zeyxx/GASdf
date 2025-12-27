# GASdf

**Gasless transactions for Solana.** Pay network fees with any token instead of SOL.

All fees are converted to **$ASDF** and burned.

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/zeyxx/GASdf/releases/tag/v1.2.0)
[![Tests](https://img.shields.io/badge/tests-72%20passing-brightgreen.svg)](#testing)
[![Security](https://img.shields.io/badge/security-12%2F12%20layers-brightgreen.svg)](#security)

## How It Works

```
User                          GASdf                         Solana
  │                             │                              │
  ├── 1. Request quote ────────►│                              │
  │    (payment token)          │                              │
  │                             │                              │
  │◄── 2. Quote + feePayer ─────┤                              │
  │                             │                              │
  ├── 3. Build tx ──────────────┤                              │
  │    (feePayer = GASdf)       │                              │
  │                             │                              │
  ├── 4. Sign + submit ────────►│                              │
  │                             ├── 5. Validate + co-sign ────►│
  │                             │                              │
  │◄── 6. Signature ────────────┤◄─────── Confirmation ────────┤
  │                             │                              │
  │                             ├── 7. Swap → $ASDF → Burn ───►│
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

## SDK

Install the SDK for easy integration:

```bash
npm install @gasdf/sdk
```

```javascript
const { GASdf } = require('@gasdf/sdk');

const gasdf = new GASdf({ baseUrl: 'https://api.gasdf.io' });

// Get a quote
const quote = await gasdf.quote(
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'YourWalletPublicKey'
);

// Build your transaction with quote.feePayer as fee payer
// Sign it and submit
const result = await gasdf.submit(quote.quoteId, signedTxBase64);
console.log(`Transaction: ${result.explorerUrl}`);

// Verify burns
const burns = await gasdf.burnProofs(10);
console.log(`Total burned: ${burns.totalBurned}`);
```

## API Endpoints (v1)

All endpoints are available under `/v1/` prefix. Legacy routes still work but include deprecation headers.

### POST /v1/quote

Get a fee quote for a gasless transaction.

```bash
curl -X POST https://api.gasdf.io/v1/quote \
  -H "Content-Type: application/json" \
  -d '{
    "paymentToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "userPubkey": "YourWalletAddress"
  }'
```

**Response:**
```json
{
  "quoteId": "550e8400-e29b-41d4-a716-446655440000",
  "feeAmount": "1000000",
  "feeAmountFormatted": "1.00 USDC",
  "feePayer": "GASdf...",
  "blockhash": "...",
  "kScore": { "score": 100, "tier": "TRUSTED" },
  "expiresAt": "2025-12-27T20:00:00.000Z"
}
```

### POST /v1/submit

Submit a signed transaction.

```bash
curl -X POST https://api.gasdf.io/v1/submit \
  -H "Content-Type: application/json" \
  -d '{
    "quoteId": "550e8400-e29b-41d4-a716-446655440000",
    "transaction": "base64-encoded-signed-transaction",
    "userPubkey": "YourWalletAddress"
  }'
```

### GET /v1/stats

Burn statistics and treasury info.

### GET /v1/stats/burns

Verifiable burn proofs with Solscan links.

### GET /v1/health

Service health with RPC pool status.

### GET /status

Public status page (Upptime-compatible).

## K-Score Pricing

Tokens are scored for trustworthiness, affecting fee multiplier:

| Tier     | Score | Fee Multiplier | Examples |
|----------|-------|----------------|----------|
| TRUSTED  | 80+   | 1.0x          | USDC, SOL |
| STANDARD | 50-79 | 1.25x         | Major tokens |
| RISKY    | 20-49 | 1.5x          | Low liquidity |
| UNKNOWN  | 0-19  | 2.0x          | New tokens |

## Security

GASdf implements 12 security layers:

| Layer | Protection |
|-------|------------|
| 1 | Security headers (Helmet) |
| 2 | IP rate limiting (100/min) |
| 3 | Wallet rate limiting |
| 4 | Input validation |
| 5 | Anti-replay (SHA256 + durable nonce) |
| 6 | Fee payer health checks |
| 7 | SOL drain prevention (6 instructions blocked) |
| 8 | Token drain prevention (11 instructions blocked) |
| 9 | Circuit breakers |
| 10 | Audit logging (PII hashed) |
| 11 | Anomaly detection (baseline learning) |
| 12 | Key rotation mechanism |

### Cryptographic Signature Verification

All user signatures are cryptographically verified using Ed25519 (not just presence checks).

### Fee Payer Key Rotation

```javascript
// Graceful retirement (no new quotes, honors existing)
startKeyRetirement(pubkey, 'scheduled_rotation');

// Complete after reservations clear
completeKeyRetirement(pubkey);

// Emergency (immediate, cancels all reservations)
emergencyRetireKey(pubkey, 'compromise_suspected');
```

## Treasury Model (80/20)

Sustainable economics for long-term operation:

- **80%** → Swap to $ASDF → **Burn** (the mission)
- **20%** → Treasury for operations (servers, RPC, fee payer refills)

## Environment Variables

See [.env.example](.env.example) for all options. Key variables:

```env
# Required
HELIUS_API_KEY=your_api_key
FEE_PAYER_PRIVATE_KEY=base58_key
REDIS_URL=redis://localhost:6379

# Optional
ASDF_MINT=9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump
BURN_RATIO=0.80
PROMETHEUS_ENABLED=true
```

## Architecture

```
src/
├── index.js              # Express server
├── routes/
│   ├── quote.js          # POST /v1/quote
│   ├── submit.js         # POST /v1/submit
│   ├── tokens.js         # GET /v1/tokens
│   ├── stats.js          # GET /v1/stats, /v1/stats/burns
│   └── health.js         # GET /v1/health
├── services/
│   ├── fee-payer-pool.js # Multi-wallet management + key rotation
│   ├── validator.js      # Transaction validation + signature verification
│   ├── jupiter.js        # Jupiter swap integration
│   ├── burn.js           # $ASDF burn worker
│   ├── oracle.js         # K-score pricing
│   ├── audit.js          # Audit logging (PII anonymized)
│   ├── alerting.js       # Alert service
│   └── anomaly-detector.js # Baseline learning
├── middleware/
│   ├── security.js       # Helmet, rate limiting
│   └── validation.js     # Input validation
└── utils/
    ├── config.js         # Environment config
    ├── redis.js          # Redis + memory fallback
    ├── rpc.js            # Multi-RPC failover
    └── circuit-breaker.js
```

## Testing

```bash
npm test
```

72 tests covering:
- RPC failover
- Burn proof storage
- SDK functionality
- API integration

## Deployment

### Docker

```bash
docker build -t gasdf .
docker run -p 3000:3000 --env-file .env gasdf
```

### Render

1. Connect GitHub repo
2. Set environment variables
3. Deploy

### Requirements

- Node.js 18+
- Redis (production)
- Funded fee payer wallet

## Monitoring

- **Prometheus**: `GET /metrics` (requires `PROMETHEUS_ENABLED=true`)
- **Alerts**: Configure `ALERTING_WEBHOOK` for Slack/Discord/PagerDuty
- **Status**: `GET /status` for external monitoring

## License

MIT
