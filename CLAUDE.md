# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GASdf is a gasless transaction layer for Solana, allowing users to pay network fees with any token instead of SOL. All fees are swapped to **$asdfasdfa** and **76.4% burned forever** (derived from φ³).

**Live:** https://gasdf-43r8.onrender.com

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server with watch mode
npm start            # Start production server
npm test             # Run unit tests
npm run test:e2e     # Run end-to-end tests
npm run lint         # Run ESLint
npm run lint:fix     # Fix linting issues
```

## Tech Stack

### Backend
- **Runtime:** Node.js 20+
- **Framework:** Express.js 4.21
- **Database:** PostgreSQL (Render)
- **Cache:** Redis 4.7
- **RPC:** Helius (primary), Solana mainnet (fallback)

### Solana
- **@solana/web3.js** 1.95 - Core Solana SDK
- **@solana/spl-token** 0.4.8 - SPL Token operations
- **helius-sdk** 2.0.5 - Enhanced RPC + DAS API
- **@pythnetwork/client** 2.22 - Price feeds

### Frontend (Landing Page)
- **Three.js** 0.160 - 3D space visualization
- **Pure CSS** - Singularity effect, animations
- **Vanilla JS** - No framework, minimal bundle

## Architecture

```
src/
├── index.js              # Express server entry point
├── routes/
│   ├── quote.js          # POST /quote - Get fee quotes
│   ├── submit.js         # POST /submit - Submit transactions
│   ├── tokens.js         # GET /tokens - List payment tokens
│   ├── stats.js          # GET /stats - Burn statistics
│   └── health.js         # GET /health - Health check
├── services/
│   ├── signer.js         # Fee payer wallet signing
│   ├── validator.js      # Transaction validation
│   ├── jupiter.js        # Jupiter swap integration
│   ├── burn.js           # $ASDF burn worker
│   ├── oracle.js         # K-score token pricing
│   └── holder-tiers.js   # Holder discount calculation
└── utils/
    ├── config.js         # Environment config
    ├── redis.js          # Redis client + helpers
    └── rpc.js            # Solana RPC client

public/
└── index.html            # Landing page with 3D space

packages/
└── sdk/                  # gasdf-sdk npm package

prototypes/
└── vr-space-v1.html      # VR space prototype

monitoring/
└── metrics-pusher.js     # Prometheus metrics
```

## Key Concepts

### Golden Ratio Economics (φ = 1.618...)
All rates derived from φ - no magic numbers:
- **Burn Rate:** `1 - 1/φ³` = 76.4%
- **Treasury Rate:** `1/φ³` = 23.6%
- **Max Ecosystem Bonus:** `1/φ²` = 38.2%
- **Max Holder Discount:** 95% (capped)

### Quote → Submit Flow
1. Client requests quote with payment token
2. Server returns quote ID + fee amount
3. Client builds tx with GASdf fee payer
4. Client signs and submits with quote ID
5. Server co-signs and broadcasts

### K-score (HolDex Integration)
Token trust score from HolDex affecting fee multiplier:
- **Trusted** (80+): 1.0x multiplier
- **Standard** (60-79): 1.1x multiplier
- **Risky** (40-59): 1.25x multiplier
- **Unknown** (<40): Rejected

### Holder Tiers
Discount formula: `min(95%, max(0, (log₁₀(share) + 5) / 3))`
- **Diamond** (1% supply): -95%
- **Platinum** (0.1%): -67%
- **Gold** (0.01%): -33%
- **Silver** (0.001%): 0%
- **Bronze** (any): 0%

## Environment Variables

```bash
# Required
HELIUS_API_KEY=           # Helius RPC API key
REDIS_URL=                # Redis connection URL
FEE_PAYER_PRIVATE_KEY=    # Base58 fee payer private key
DATABASE_URL=             # PostgreSQL connection string

# Optional
ASDF_MINT=                # $asdfasdfa mint (default: 9zB5...)
JUPITER_API_KEY=          # Jupiter API key
ALLOWED_ORIGINS=          # CORS origins
PORT=3000                 # Server port
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with component status |
| `/v1/quote` | POST | Get fee quote for transaction |
| `/v1/submit` | POST | Submit signed transaction |
| `/v1/tokens` | GET | List accepted payment tokens |
| `/v1/stats` | GET | Burn statistics |

## Related Projects

- **HolDex:** https://holdex.asdfasdfa.tech - Token verification
- **ASDev:** https://asdev-backend.onrender.com - Backend API
- **SDK:** `npm install gasdf-sdk` - Client SDK

## License

MIT
