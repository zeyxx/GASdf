# Check Tokenomics

Verify the Golden Ratio (φ) economics are correctly implemented.

## φ Constants

```javascript
const φ = 1.618033988749894;
const BURN_RATIO = 1 - 1/(φ*φ*φ);     // 76.4% → src/utils/config.js
const TREASURY_RATIO = 1/(φ*φ*φ);      // 23.6% → src/utils/config.js
const MAX_ECO_BONUS = 1/(φ*φ);         // 38.2% → src/services/holdex.js
```

## Verification Points

### 1. Burn Split (src/services/burn.js)
```javascript
// Line ~706: calculateTreasurySplit
const { burnAmount, treasuryAmount } = calculateTreasurySplit(asdfReceived, config.BURN_RATIO);
// burnAmount = 76.4%, treasuryAmount = 23.6%
```

### 2. Holder Discount (src/services/holder-tiers.js)
```javascript
// Line ~146: calculateDiscountFromShare
discount = min(95%, (log₁₀(share) + 5) / 3)
// 1% of supply → 95% discount
// 0.1% → 67%, 0.01% → 33%
```

### 3. E-Score Discount (src/services/harmony.js)
```javascript
// Line ~217: eScoreToDiscount
discount = min(95%, 1 - φ^(-E/25))
// E=25 → 38.2%, E=50 → 61.8%, E=75 → 76.4%
```

### 4. Ecosystem Burn Bonus (src/services/holdex.js)
```javascript
// Line ~104-113: calculateEcosystemBurn
ecosystemBurnPct = (1/φ²) × (1 - φ^(-burnPct/30))
// 0% burned → 0% bonus
// 30% burned → 14.6% bonus
// 90%+ burned → 38.2% bonus (max)
```

## Dual Burn Flow

```
$ASDF Payment:
  └→ 100% BURN (purist model)

Other Token Payment:
  ├→ Ecosystem Burn: X% burned directly (if token burns supply)
  └→ Remaining: Swap → $ASDF
        ├→ 76.4% BURN
        └→ 23.6% Treasury (refills fee payer when needed)
```

## Test Commands

```bash
# Run unit tests for tokenomics
npm test -- --grep "burn|holder|harmony"

# Check live stats
curl -s https://gasdf-43r8.onrender.com/v1/stats | jq '{totalBurned: .burnedFormatted, burnRatio: .treasury.burnRatio}'
```
