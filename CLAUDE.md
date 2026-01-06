# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GASdf is a gasless transaction layer for Solana, allowing users to pay network fees with any token instead of SOL.

**Live:** https://asdfasdfa.tech

## Value Proposition (The 3 Pillars)

**NOT "gas efficiency"** - GASdf provides three distinct values:

### 1. Convenience (Primary UX)
- Users don't need SOL for gas - pay with USDC, USDT, or verified tokens
- Seamless dApp integration via SDK
- Token gating via HolDex K-score (only trusted tokens accepted)

### 2. Holder Rewards (Economic Incentive)
- $asdfasdfa holders get **up to 95% fee discounts**
- Logarithmic discount formula prevents whale dominance
- E-Score engagement rewards add additional discounts
- Combined discount: `max(holderDiscount, eScoreDiscount)` — cap 95%

### 3. Sustainable Deflation (Tokenomics)

**Dual Burn Channel:**

```
$ASDF Payment:
  └─→ 100% BURN (purist model, zero treasury cut)

Other Token Payment (K-score ≥50):
  │
  ├─→ Ecosystem Burn: X% burned DIRECTLY
  │     Formula: X = (1/φ²) × (1 - φ^(-burnPct/30))
  │     Max: 38.2% (1/φ²) — rewards tokens that burn their supply
  │
  └─→ Remaining: Swap → $ASDF
        ├─→ 76.4% BURN (1-1/φ³)
        └─→ 23.6% Treasury (1/φ³) — refills fee payer when needed
```

**Ecosystem Burn Bonus (verified formula):**
| Token Burned % | Ecosystem Burn |
|----------------|----------------|
| 0% | 0% |
| 10% | ~7.9% |
| 30% | ~14.6% |
| 50% | ~23% |
| 90%+ | →38.2% |

**Flywheels:**
1. **Holder**: Hold → fees burn → supply shrinks → % grows → better discount
2. **Ecosystem**: Token burns supply → higher bonus → more direct burns → incentive to burn

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
Token trust score from HolDex affecting fee multiplier.
*See `src/services/holdex.js:104-113`*

| Tier | K-Score | Multiplier |
|------|---------|------------|
| 💎 Diamond | 90-100 | 1.0x |
| 💠 Platinum | 80-89 | 1.0x |
| 🥇 Gold | 70-79 | 1.0x |
| 🥈 Silver | 60-69 | 1.1x |
| 🥉 Bronze | 50-59 | 1.2x |
| Copper/Iron/Rust | <50 | **Rejected** |

**Minimum for gas payment: Bronze (K-Score 50+)**

### Holder Tiers
*See `src/services/holder-tiers.js:146-153`*

Discount formula: `min(95%, (log₁₀(share) + 5) / 3)`

| Tier | Share | Discount |
|------|-------|----------|
| DIAMOND | ≥1% | 95% |
| PLATINUM | ≥0.1% | 67% |
| GOLD | ≥0.01% | 33% |
| SILVER | ≥0.001% | 0% |
| BRONZE | <0.001% | 0% |

### E-Score (Harmony)
*See `src/services/harmony.js:66, 126-131`*

7 φ-weighted dimensions: Hold, Burn, Use, Build, Node, Refer, Duration
Formula: `min(95%, 1 - φ^(-E/25))`

**Combined discount**: `max(holderDiscount, eScoreDiscount)` — cap 95%

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
- **HolDex API:** https://holdex-api.onrender.com - Token verification API
- **SDK:** `npm install gasdf-sdk` - Client SDK

## License

MIT
