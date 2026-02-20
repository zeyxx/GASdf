# GASdf Agent API Documentation

**Base URL**: `https://asdfasdfa.tech` (or `https://gasdf-api.onrender.com`)

Agents can seamlessly integrate with GASdf to enable gasless transactions for Solana.

---

## 🏥 Health Check

**GET** `/health`

Returns system status, fee payer balance, and component health.

```bash
curl https://asdfasdfa.tech/health
```

**Response**:
```json
{
  "status": "degraded|ok",
  "uptime": 123456,
  "version": "1.8.0",
  "network": "mainnet",
  "checks": {
    "redis": {"status": "ok"},
    "rpc": {"status": "ok"},
    "feePayer": {"status": "warning", "balance": "0.1000"}
  }
}
```

**Agent Use**: Check system readiness before submitting transactions.

---

## 📜 Get Accepted Tokens

**GET** `/v1/tokens`

Returns list of tokens that can be used for fee payment.

```bash
curl https://asdfasdfa.tech/v1/tokens
```

**Response**:
```json
{
  "tokens": [
    {
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "symbol": "USDC",
      "name": "USD Coin",
      "decimals": 6,
      "tier": "Diamond"
    },
    ...
  ],
  "note": "HolDex-verified community tokens also accepted"
}
```

**Agent Use**: Get list of payment tokens before requesting quotes.

---

## 💰 Get Fee Quote

**POST** `/v1/quote`

Request a fee quote for a transaction. User pays fees in any accepted token.

```bash
curl -X POST https://asdfasdfa.tech/v1/quote \
  -H "Content-Type: application/json" \
  -d '{
    "paymentToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "userPubkey": "2s91VW55dNZhp7SGE9cPzyBVpJKMVB5yJpCs6YqZBhHQ",
    "amount": 1000000
  }'
```

**Parameters**:
- `paymentToken` (string, required): Mint address of token to pay fees with
- `userPubkey` (string, required): User's public key
- `amount` (number, optional): Lamports for complex fee estimates

**Response**:
```json
{
  "quoteId": "b322bb90-4f23-4c4d-945b-583e074bedf2",
  "feePayer": "2s91VW55dNZhp7SGE9cPzyBVpJKMVB5yJpCs6YqZBhHQ",
  "feeAmount": "2922",
  "feeFormatted": "0.0029 USDC",
  "paymentToken": {
    "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "symbol": "USDC",
    "decimals": 6,
    "tier": "Diamond"
  },
  "expiresAt": 1771587988703,
  "ttl": 60
}
```

**Agent Use**: Agents get quotes, show users the fee, then proceed to submit.

---

## ✍️ Submit Transaction

**POST** `/v1/submit`

Submit a user's transaction with GASdf fee payer co-signature.

```bash
curl -X POST https://asdfasdfa.tech/v1/submit \
  -H "Content-Type: application/json" \
  -d '{
    "quoteId": "b322bb90-4f23-4c4d-945b-583e074bedf2",
    "signedTransaction": "base64-encoded-transaction",
    "paymentTokenAccount": "user-token-account-address"
  }'
```

**Parameters**:
- `quoteId` (string, required): Quote ID from `/v1/quote`
- `signedTransaction` (string, required): User-signed transaction (base64)
- `paymentTokenAccount` (string, required): User's token account for fee payment

**Response**:
```json
{
  "signature": "5H2...9nK",
  "status": "submitted|confirmed",
  "slot": 401521635,
  "fee": {
    "amount": "2922",
    "token": "USDC"
  }
}
```

**Agent Use**: Core transaction submission with fee handling.

---

## 📊 Burn Statistics

**GET** `/v1/stats`

Get GASdf burn statistics (total burned, fee volume, etc.).

```bash
curl https://asdfasdfa.tech/v1/stats
```

**Response**:
```json
{
  "totalBurned": "123456789",
  "totalBurnedFormatted": "123.45 $ASDF",
  "totalFeeVolume": "987654321",
  "transactionCount": 42,
  "lastBurnTime": 1771587900000,
  "burnRatio": 0.764,
  "treasuryRatio": 0.236
}
```

**Agent Use**: Show users impact (how much $ASDF was burned, ecosystem health).

---

## 🔍 Error Handling

All endpoints return consistent error format:

```json
{
  "error": "error_code",
  "message": "Human-readable error message",
  "statusCode": 400,
  "details": ["validation error 1", "validation error 2"]
}
```

**Common Status Codes**:
- `400`: Validation error (bad params)
- `404`: Quote expired or not found
- `429`: Rate limited
- `500`: Server error

---

## 🤖 Agent Integration Example

**Python**:
```python
import requests
import base64

API = "https://asdfasdfa.tech"

# 1. Get tokens
tokens = requests.get(f"{API}/v1/tokens").json()
usdc_mint = tokens["tokens"][0]["mint"]

# 2. Get quote
quote = requests.post(
    f"{API}/v1/quote",
    json={
        "paymentToken": usdc_mint,
        "userPubkey": "user_address",
        "amount": 1000000
    }
).json()

print(f"Fee: {quote['feeFormatted']}")
print(f"Expires in: {quote['ttl']}s")

# 3. Build & sign transaction (your logic)
# signed_tx = build_and_sign_transaction(...)

# 4. Submit
result = requests.post(
    f"{API}/v1/submit",
    json={
        "quoteId": quote["quoteId"],
        "signedTransaction": base64.b64encode(signed_tx).decode(),
        "paymentTokenAccount": user_token_account
    }
).json()

print(f"Signature: {result['signature']}")
```

**JavaScript**:
```javascript
const API = "https://asdfasdfa.tech";

// 1. Get quote
const quote = await fetch(`${API}/v1/quote`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    paymentToken: "EPjFWdd5...",
    userPubkey: "2s91VW55...",
    amount: 1000000
  })
}).then(r => r.json());

console.log(`Fee: ${quote.feeFormatted}`);

// 2. Build, sign, submit
// ... your transaction logic
```

---

## 🚀 Hackathon Quick Start

1. **Setup**: Agent calls `/v1/tokens` to get accepted tokens
2. **Quote**: Agent gets fee estimate via `/v1/quote`
3. **Build**: Agent builds transaction with user signature
4. **Submit**: Agent submits via `/v1/submit` with fee payer co-sig
5. **Track**: Agent monitors `/v1/stats` for burn impact

---

## 📞 Support

- Health: `/health` endpoint
- Mainnet only (production)
- Rate limits: Standard API limits
- TTL: Quotes expire after 60 seconds
- Fee Payer: Community-funded (0.1 SOL bootstrap)

**Ready for hackathon.pump.fun! 🎉**
