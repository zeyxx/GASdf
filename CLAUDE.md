# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GASdf is a gasless transaction layer for Solana, allowing users to pay network fees with any token instead of SOL. Fees are swapped to $ASDF and burned.

## Commands

```bash
npm install    # Install dependencies
npm run dev    # Start dev server with watch mode
npm start      # Start production server
```

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
│   └── oracle.js         # K-score token pricing
└── utils/
    ├── config.js         # Environment config
    ├── redis.js          # Redis client + helpers
    └── rpc.js            # Solana RPC client
public/
└── index.html            # Stats dashboard
```

## Key Concepts

- **Quote → Submit flow**: Client gets a quote, builds transaction with our fee payer, signs it, submits with quote ID
- **K-score**: Token trust score affecting fee multiplier (TRUSTED/STANDARD/RISKY/UNKNOWN)
- **Burn worker**: Background process that swaps accumulated fees to $ASDF and burns them

## Environment Variables

- `HELIUS_API_KEY` - Helius RPC API key
- `REDIS_URL` - Redis connection URL
- `FEE_PAYER_PRIVATE_KEY` - Base58 encoded fee payer private key
- `ASDF_MINT` - $ASDF token mint address

## License

MIT
