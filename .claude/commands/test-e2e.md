# E2E Test with Test Wallet

Run end-to-end test against production API.

```bash
# Check API health first
curl -s https://gasdf-43r8.onrender.com/health | jq -r '.status // "offline"'
```

## Test Flow

1. Request quote for USDC payment
2. Verify quote response structure
3. Check Redis quote storage (via /health endpoint stats)

## Test Wallet

- Address: `3eW3WbKpWAu6aNAd3boubvfpXLfTbHzYZpVifNgDTRbn`
- Has test $ASDF tokens for tier testing

## Commands

```bash
# Request a quote
curl -s -X POST https://gasdf-43r8.onrender.com/quote \
  -H "Content-Type: application/json" \
  -d '{
    "paymentToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "userPubkey": "3eW3WbKpWAu6aNAd3boubvfpXLfTbHzYZpVifNgDTRbn"
  }' | jq .
```
