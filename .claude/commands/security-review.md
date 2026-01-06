# Security Review

Quick security checklist for GASdf.

## Critical Security Points

### 1. Anti-Replay Protection (src/routes/submit.js:110-138)
```javascript
// Atomic SET NX prevents duplicate transaction submissions
const { claimed } = await redis.claimTransactionSlot(txHash);
if (!claimed) → REPLAY_DETECTED
```

### 2. CPI Drain Protection (src/routes/submit.js:307-353)
```javascript
// Simulate with balance check before signing
const simulation = await rpc.simulateWithBalanceCheck(
  signedTx,
  feePayerPubkey,
  200000 // Max expected SOL change in lamports
);
// If SOL drain > threshold → CPI_ATTACK_DETECTED
```

### 3. Token Gating (src/services/token-gate.js)
```javascript
// Only tokens with K-score ≥ 50 accepted
const tokenCheck = await isTokenAccepted(paymentToken);
// Trusted: SOL, USDC, USDT, $asdfasdfa (hardcoded)
// Others: Must pass HolDex verification
```

### 4. Fee Payment Validation (src/services/validator.js)
```javascript
// Validate fee transfer instruction exists
const feeValidation = await validateFeePayment(tx, quote, userPubkey);
// Checks: correct amount, correct destination, correct token
```

### 5. Rate Limiting (src/middleware/security.js)
- IP-based: 600/min global, 120/min per IP
- Wallet-based: 60/min per wallet
- Anomaly detection: flags suspicious patterns

## Security Files to Review

| File | Purpose |
|------|---------|
| `src/middleware/security.js` | Rate limiting, IP blocking |
| `src/services/validator.js` | Transaction validation |
| `src/services/anomaly-detector.js` | Abuse detection |
| `src/services/audit.js` | Security event logging |
| `src/utils/rpc.js:simulateWithBalanceCheck` | CPI protection |

## Audit Checklist

- [ ] No private keys in code (check `.env.example`)
- [ ] Rate limits appropriate for expected traffic
- [ ] Circuit breaker configured (fee-payer-pool.js)
- [ ] Timing-safe comparisons for secrets (index.js:34-44)
- [ ] CORS properly configured for production

## Test Security

```bash
# Run security-focused tests
npm test -- --grep "security|replay|validation"

# Check rate limit status
curl -s https://gasdf-43r8.onrender.com/health | jq .checks.rateLimit
```
