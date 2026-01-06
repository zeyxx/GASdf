# GASdf - Issues & Improvements

## Critical Issues

### 1. Transaction Size Limit (1521 > 1232 bytes)
**Status:** Unresolved
**Impact:** Swaps fail for complex routes

**Root Cause:**
- Solana MTU limit: 1232 bytes
- Jupiter swap transactions use many accounts (10-40+)
- GASdf adds fee payment instruction (+3 accounts, +41 bytes)
- Combined transaction exceeds limit

**Current Mitigation:**
- `maxAccounts=25` in Jupiter quote request
- Pre-flight size check before wallet signing

**Potential Solutions:**
1. **Reduce route complexity** (`maxAccounts=15`, `onlyDirectRoutes=true`)
   - Pros: Simple fix
   - Cons: Worse prices, some pairs won't work

2. **Use Address Lookup Tables (ALTs)**
   - Pros: Compresses 32-byte addresses to 1-byte indices
   - Cons: Requires pre-created ALT, VersionedTransaction only

3. **Separate fee transaction**
   - Pros: No size limit on swap
   - Cons: 2 signatures, race conditions, UX complexity

4. **Fee-in-swap model**
   - Jupiter swap includes extra output to treasury
   - Cons: Changes economic model, needs Jupiter support

**Recommended:** Start with reduced complexity (15 accounts), add ALT support for Phase 2

---

### 2. HolDex Anti-Sybil Token Gate (403 Error)
**Status:** Partially resolved
**Impact:** HolDex API returns 403 "Hold 10,000+ $ASDFASDFA"

**Root Cause:**
- HolDex `burnCredits.js` requires holding tokens to use API
- Anti-sybil protection against abuse
- GASdf needs access without holding tokens

**Current Status:**
- [x] GASdf: `HOLDEX_API_KEY` configured (secure 256-bit key)
- [ ] HolDex: Whitelist implementation needed

**HolDex Changes Required:**
```javascript
// In src/services/burnCredits.js
const WHITELISTED_API_KEYS = new Set(
  (process.env.WHITELISTED_API_KEYS || '').split(',').filter(Boolean)
);

function isWhitelistedApiKey(apiKey) {
  return apiKey && WHITELISTED_API_KEYS.has(apiKey);
}

// In checkApiEligibility():
if (isWhitelistedApiKey(apiKey)) {
  return { eligible: true, whitelisted: true };
}
```

**HolDex Env Var:**
```
WHITELISTED_API_KEYS=1079b78fd0b1a88323bddaa81447ddb92cddb01b3359e95111be72d4fc349377
```

---

---

## Roadmap

### Phase 1 (Current)
- [x] Single fee payer (centralized but works)
- [ ] Handle complex routes gracefully (error + alternatives)

### Phase 2 (Soon)
- [ ] Multi fee-payer network (like Jito relayers)
- [ ] Address Lookup Table support for complex routes
- [ ] VersionedTransaction reconstruction with combined ALT

### Phase 3 (Ideas)
- [ ] User self-relay option (advanced users bring own SOL)
- [ ] Decentralized fee payer DAO

---

## Monitoring Issues

### 3. CSP Violation (Source Map)
**Status:** Low priority
**Impact:** Console warning only

```
Refused to load source map for @solana/web3.js (CSP directive)
```

**Cause:** jsdelivr CDN tries to load .map file blocked by CSP
**Fix:** Add source map URL to CSP or ignore (cosmetic issue)

---

## Completed Fixes

- [x] HolDex 401 → Proxy via `/v1/tokens/holdex`
- [x] HolDex CORS → Added `CORS_ORIGINS` env var
- [x] CPI drain false positive → Increased balance threshold to 200k lamports
- [x] Jupiter API key → Configured for v6 API
- [x] HOLDEX_API_KEY → Secure 256-bit key set

---

## Architecture Notes

### Gasless Swap Flow
```
1. User selects tokens + amount
2. Frontend fetches Jupiter quote (via /v1/rpc/jupiter/quote)
3. Frontend fetches GASdf quote (POST /v1/quote)
4. Frontend builds transaction:
   - Jupiter swap instructions
   - + Fee payment instruction (prepended)
   - Fee payer = GASdf wallet
5. User signs (only their part)
6. Submit to GASdf (POST /v1/submit)
7. GASdf validates + co-signs + broadcasts
```

### Transaction Size Breakdown
```
Base overhead:         ~100 bytes (signatures, header, blockhash)
Per signature:          64 bytes × 2 = 128 bytes
Per account (legacy):   32 bytes × N
Per instruction:       ~50-200 bytes depending on data

Example failing tx:
- Jupiter swap:        15 accounts × 32 = 480 bytes
- Swap instructions:   ~600 bytes
- Fee instruction:     3 accounts + 41 bytes = 137 bytes
- Overhead:            ~200 bytes
- TOTAL:               ~1417 bytes > 1232 limit
```

### With Address Lookup Table
```
Per account (ALT):     1 byte × N (instead of 32)
15 accounts:           15 bytes (instead of 480)
Savings:               465 bytes per 15 accounts
```
