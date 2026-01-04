# POST /quote

Get a fee quote for a gasless transaction.

## Endpoint

```
POST https://asdfasdfa.tech/v1/quote
```

## Request

### Headers

| Header | Value | Required |
|--------|-------|----------|
| `Content-Type` | `application/json` | Yes |
| `x-request-id` | UUID | No |

### Body

```json
{
  "payerPubkey": "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK",
  "paymentMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "estimatedComputeUnits": 200000,
  "priorityFee": 1000
}
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `payerPubkey` | string | Yes | User's wallet public key (base58) |
| `paymentMint` | string | Yes | SPL token mint address for fee payment |
| `estimatedComputeUnits` | number | No | Estimated compute units (default: 200000) |
| `priorityFee` | number | No | Priority fee in microlamports per CU |

## Response

### Success (200)

```json
{
  "quoteId": "qt_a1b2c3d4e5f6",
  "feePayer": "FEEpayerPubkey11111111111111111111111111111",
  "feeCollector": "COLLectorPubkey1111111111111111111111111111",
  "feeAmount": 0.012,
  "feeAmountRaw": "12000",
  "paymentMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "paymentSymbol": "USDC",
  "paymentDecimals": 6,
  "solEquivalent": 0.0001,
  "kScore": "Diamond",
  "feeMultiplier": 1.0,
  "validUntil": 1703548800000
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `quoteId` | string | Unique quote ID (valid for 60s) |
| `feePayer` | string | GASdf fee payer public key |
| `feeCollector` | string | Address to send fee tokens to |
| `feeAmount` | number | Fee in token units (human readable) |
| `feeAmountRaw` | string | Fee in smallest token units |
| `paymentMint` | string | Token mint address |
| `paymentSymbol` | string | Token symbol |
| `paymentDecimals` | number | Token decimal places |
| `solEquivalent` | number | Equivalent SOL value |
| `kScore` | string | Token trust score |
| `feeMultiplier` | number | Applied fee multiplier |
| `validUntil` | number | Quote expiration timestamp (ms) |

### Error Responses

#### 400 Bad Request

```json
{
  "error": "Invalid request",
  "code": "INVALID_TOKEN",
  "message": "Token EPj... is not supported"
}
```

#### 429 Too Many Requests

```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMITED",
  "retryAfter": 60
}
```

#### 503 Service Unavailable

```json
{
  "error": "Service unavailable",
  "code": "SERVICE_UNAVAILABLE"
}
```

## Fee Calculation

The fee is calculated as:

```
baseFee = (computeUnits * PRIORITY_FEE_PER_CU + BASE_LAMPORTS) * (1 + priorityFeeMultiplier)
tokenFee = baseFee * solToTokenRate * kScoreMultiplier
```

### K-Score Tiers (HolDex)

| Tier | K-Score | Multiplier | Status |
|------|---------|------------|--------|
| 💎 Diamond | 90-100 | 1.0x | Hardcoded (SOL, USDC, USDT, $asdfasdfa) |
| 💠 Platinum | 80-89 | 1.0x | Accepted |
| 🥇 Gold | 70-79 | 1.0x | Accepted |
| 🥈 Silver | 60-69 | 1.1x | Accepted |
| 🥉 Bronze | 50-59 | 1.2x | Accepted (minimum for gas) |
| Copper/Iron/Rust | <50 | — | **Rejected** |

## Example

### cURL

```bash
curl -X POST https://asdfasdfa.tech/v1/quote \
  -H "Content-Type: application/json" \
  -d '{
    "payerPubkey": "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK",
    "paymentMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "estimatedComputeUnits": 200000
  }'
```

### JavaScript

```javascript
const response = await fetch('https://asdfasdfa.tech/v1/quote', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    payerPubkey: wallet.publicKey.toString(),
    paymentMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    estimatedComputeUnits: 200000
  })
});

const quote = await response.json();
console.log('Fee:', quote.feeAmount, quote.paymentSymbol);
```

## Notes

- Quotes expire after **60 seconds**
- Each quote can only be used **once**
- The fee payer in the quote must be used as the transaction's `feePayer`
- You must include a token transfer to `feeCollector` for `feeAmountRaw`
