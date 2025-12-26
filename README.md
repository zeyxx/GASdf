# GASdf

Gasless transactions for Solana. Pay network fees with any token instead of SOL.

All fees are converted to $ASDF and burned.

## Quick Start

```bash
npm install
npm run dev
```

## Environment Variables

```env
PORT=3000
HELIUS_API_KEY=your_helius_api_key
REDIS_URL=redis://localhost:6379
FEE_PAYER_PRIVATE_KEY=base58_encoded_private_key
ASDF_MINT=your_asdf_token_mint
```

## API Endpoints

### POST /quote

Get a fee quote for a gasless transaction.

```json
{
  "paymentMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "estimatedComputeUnits": 200000
}
```

**Response:**

```json
{
  "quoteId": "uuid",
  "feeAmount": "1000000",
  "feeMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "feeAmountSol": 7500,
  "feePayer": "GASdf...",
  "kScore": { "score": 100, "tier": "TRUSTED" },
  "expiresAt": 1234567890
}
```

### POST /submit

Submit a signed transaction for gasless execution.

```json
{
  "quoteId": "uuid-from-quote",
  "transaction": "base64-encoded-transaction",
  "userPubkey": "user-wallet-address"
}
```

**Response:**

```json
{
  "signature": "tx-signature",
  "status": "submitted"
}
```

### GET /tokens

List supported payment tokens.

### GET /stats

Get burn statistics.

### GET /health

Health check endpoint.

## Flow

1. Client requests a quote with payment token
2. GASdf returns fee amount in that token + quote ID
3. Client builds transaction with GASdf as fee payer
4. Client signs transaction and submits with quote ID
5. GASdf validates, co-signs, and broadcasts
6. Fees accumulate → swap to $ASDF → burn

## K-Score Pricing

Tokens are scored for trustworthiness:

| Tier     | Score | Fee Multiplier |
|----------|-------|----------------|
| TRUSTED  | 80+   | 1.0x          |
| STANDARD | 50-79 | 1.25x         |
| RISKY    | 20-49 | 1.5x          |
| UNKNOWN  | 0-19  | 2.0x          |

## Deploy to Render

1. Push to GitHub
2. Connect repo to Render
3. Set environment variables
4. Deploy

## License

MIT
