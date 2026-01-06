# Debug GASdf Flow

Analyze and debug the quote → submit → burn flow.

## Pre-Check

```bash
# 1. Check API health
curl -s https://gasdf-43r8.onrender.com/health | jq '{status, version, feePayer: .checks.feePayer}'

# 2. Check local server if running
curl -s http://localhost:3000/health 2>/dev/null | jq . || echo "Local server not running"
```

## Flow Analysis

When debugging issues, check these files in order:

### Quote Phase
- `src/routes/quote.js` - Quote endpoint logic
- `src/services/token-gate.js` - Token acceptance (K-score)
- `src/services/fee-payer-pool.js` - Fee payer reservation
- `src/services/holder-tiers.js` - Discount calculation

### Submit Phase
- `src/routes/submit.js` - Submit endpoint logic
- `src/services/validator.js` - Transaction validation
- `src/services/signer.js` - Fee payer signing
- `src/utils/rpc.js` - RPC calls & simulation

### Burn Phase
- `src/services/burn.js` - Burn worker (60s interval)
- `src/services/jupiter.js` - Token swaps
- `src/services/harmony.js` - E-Score & HolDex integration

## Common Issues

### "Quote not found or expired"
- Check Redis connection: `curl -s localhost:3000/health | jq .checks.redis`
- Quote TTL is 60 seconds by default

### "Token not accepted"
- Check HolDex K-score: `curl -s "https://holdex-api.onrender.com/api/token/{MINT}"`
- Minimum K-score: 50 (Bronze tier)

### "No fee payer capacity"
- Check fee payer balance in `/health` response
- Circuit breaker may be open

### "CPI attack detected"
- Simulation detected excessive SOL drain
- Check `rpc.simulateWithBalanceCheck` logs

## Debug Commands

```bash
# Test a quote
curl -s -X POST http://localhost:3000/v1/quote \
  -H "Content-Type: application/json" \
  -d '{"paymentToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "userPubkey": "YOUR_WALLET"}' | jq .

# Check burn stats
curl -s http://localhost:3000/v1/stats | jq .

# View recent logs on Render
# Use the Skill: /monitor
```
