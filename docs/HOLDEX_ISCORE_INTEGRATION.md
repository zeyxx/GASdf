# HolDex I-Score Integration Specification

## Overview

This document specifies the **Infrastructure Score (I-Score)** system for HolDex, enabling proper scoring of infrastructure tokens (stablecoins, LSTs, wrapped assets) that don't fit the traditional K-Score conviction model.

**Author:** GASdf Team
**Target:** HolDex API
**Status:** Proposal
**Date:** 2026-01-05

---

## Problem Statement

### Current State

K-Score measures **holder conviction**:
```
K-Score = f(accumulators, maintained, reducers, extractors)
```

This works perfectly for **community tokens** where holder behavior indicates token health.

### The Gap

**Infrastructure tokens** don't have conviction dynamics:

| Token | Type | Current K-Score | Reality |
|-------|------|-----------------|---------|
| USDC | Stablecoin | 0 (Rust) | Most trusted USD on Solana |
| USDT | Stablecoin | 0 (Rust) | $2B+ liquidity |
| mSOL | LST | 0 (Rust) | Marinade, audited, $500M+ TVL |
| jitoSOL | LST | 0 (Rust) | Jito, MEV rewards, battle-tested |

**Result:** GASdf must hardcode these tokens, bypassing HolDex as source of truth.

---

## Solution: Dual-Score System

### Philosophy Alignment ($asdfasdfa)

| Principle | Implementation |
|-----------|----------------|
| Real value, not artificial | Scores based on on-chain metrics |
| Golden Ratio economics | Component weights follow φ |
| HolDex = single source of truth | One system calculates ALL scores |
| Separation of concerns | K-Score (conviction) vs I-Score (infrastructure) |

### Token Classification

```
┌─────────────────────────────────────────────────────────┐
│                    Token Analysis                        │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  Is Native SOL?       │
              └───────────────────────┘
                    │           │
                   YES          NO
                    │           │
                    ▼           ▼
              ┌─────────┐  ┌────────────────────┐
              │ Score:  │  │ Is Stablecoin/LST/ │
              │   100   │  │ Wrapped/High-TVL?  │
              │ (Native)│  └────────────────────┘
              └─────────┘       │           │
                               YES          NO
                                │           │
                                ▼           ▼
                          ┌─────────┐  ┌─────────┐
                          │ I-Score │  │ K-Score │
                          │ (Infra) │  │ (Community)
                          └─────────┘  └─────────┘
                                │           │
                                └─────┬─────┘
                                      ▼
                              ┌─────────────┐
                              │ Unified Tier │
                              │ Diamond→Rust │
                              └─────────────┘
```

---

## I-Score Specification

### Formula

```javascript
const PHI = 1.618033988749;  // Golden Ratio

function calculateIScore(token) {
  // ═══════════════════════════════════════════════════════════
  // COMPONENT 1: LIQUIDITY DEPTH (weight: 1/φ ≈ 61.8%)
  // ═══════════════════════════════════════════════════════════
  // Measures: Total Value Locked across all DEX pools
  // Scale: Logarithmic, $100M+ = maximum score
  // Source: DexScreener, Jupiter, Orca APIs
  //
  const liquidityScore = Math.min(100,
    Math.log10(Math.max(1, token.totalLiquidityUsd / 1000)) * 25
  );
  // Examples:
  //   $1M TVL → log10(1000) * 25 = 75
  //   $10M TVL → log10(10000) * 25 = 100
  //   $100M TVL → capped at 100

  // ═══════════════════════════════════════════════════════════
  // COMPONENT 2: VOLUME HEALTH (weight: 1/φ² ≈ 38.2%)
  // ═══════════════════════════════════════════════════════════
  // Measures: 24h volume / TVL ratio (capital efficiency)
  // Healthy range: 0.1 - 2.0 (10% - 200% daily turnover)
  // Too low = illiquid, Too high = wash trading suspect
  //
  const volumeRatio = token.volume24hUsd / Math.max(1, token.totalLiquidityUsd);
  const volumeScore = calculateVolumeHealth(volumeRatio);

  function calculateVolumeHealth(ratio) {
    if (ratio >= 0.1 && ratio <= 2.0) return 100;  // Healthy
    if (ratio < 0.1) return ratio * 1000;          // Too illiquid
    if (ratio > 2.0) return Math.max(0, 100 - (ratio - 2) * 25);  // Suspicious
    return 0;
  }

  // ═══════════════════════════════════════════════════════════
  // COMPONENT 3: PROTOCOL BACKING (weight: 1/φ³ ≈ 23.6%)
  // ═══════════════════════════════════════════════════════════
  // Measures: Type and quality of backing/issuer
  // Categories based on trust model
  //
  const backingScores = {
    'CENTRALIZED_AUDITED': 100,     // Circle (USDC), Tether (USDT)
    'DECENTRALIZED_VALIDATED': 95,  // Marinade (mSOL), Jito (jitoSOL)
    'BRIDGE_AUDITED': 85,           // Wormhole wrapped assets
    'ALGORITHMIC_PROVEN': 75,       // Battle-tested (2+ years)
    'ALGORITHMIC_NEW': 50,          // < 2 years
    'UNKNOWN': 25,                  // Unverified backing
  };
  const backingScore = backingScores[token.backingType] || 25;

  // ═══════════════════════════════════════════════════════════
  // BONUS: LINDY EFFECT (max: 1/φ³ ≈ 23.6%)
  // ═══════════════════════════════════════════════════════════
  // Measures: Time in market (survival = trust)
  // Scale: Linear up to 1000 days, then capped
  //
  const ageDays = (Date.now() - token.createdAt) / (1000 * 60 * 60 * 24);
  const lindyBonus = Math.min(23.6, (ageDays / 1000) * 23.6);
  // Examples:
  //   100 days → 2.36 bonus
  //   500 days → 11.8 bonus
  //   1000+ days → 23.6 bonus (max)

  // ═══════════════════════════════════════════════════════════
  // BONUS: PEG STABILITY (stablecoins only, max: 1/φ² ≈ 38.2%)
  // ═══════════════════════════════════════════════════════════
  // Measures: Maximum deviation from peg in 30 days
  // Only applies to tokens with pegTarget set
  //
  let pegBonus = 0;
  if (token.pegTarget) {
    const maxDeviation = token.maxPegDeviation30d || 0;  // e.g., 0.01 = 1%
    pegBonus = Math.max(0, 38.2 - (maxDeviation * 382));
    // Examples:
    //   0% deviation → 38.2 bonus
    //   1% deviation → 34.4 bonus
    //   5% deviation → 19.1 bonus
    //   10%+ deviation → 0 bonus
  }

  // ═══════════════════════════════════════════════════════════
  // FINAL CALCULATION: Golden-Weighted Sum
  // ═══════════════════════════════════════════════════════════
  const weights = {
    liquidity: 1 / PHI,           // ≈ 0.618
    volume: 1 / (PHI * PHI),      // ≈ 0.382
    backing: 1 / (PHI * PHI * PHI) // ≈ 0.236
  };
  const totalWeight = weights.liquidity + weights.volume + weights.backing;

  const baseScore = (
    liquidityScore * weights.liquidity +
    volumeScore * weights.volume +
    backingScore * weights.backing
  ) / totalWeight;

  // Apply bonuses (capped at 100)
  return Math.min(100, Math.round(baseScore + lindyBonus + pegBonus));
}
```

### Data Sources

| Component | Primary Source | Fallback |
|-----------|---------------|----------|
| Liquidity | Jupiter Aggregator | DexScreener |
| Volume 24h | DexScreener | Birdeye |
| Backing Type | HolDex Manual Curation | On-chain analysis |
| Age | On-chain (first tx) | Token registry |
| Peg Deviation | Pyth/Switchboard | CoinGecko |

---

## Token Classification Logic

### Automatic Classification

```javascript
function classifyToken(token) {
  const mint = token.mint;

  // ════════════════════════════════════════════════════════
  // RULE 1: Native SOL (hardcoded, score = 100)
  // ════════════════════════════════════════════════════════
  if (mint === 'So11111111111111111111111111111111111111112') {
    return {
      type: 'NATIVE',
      scoreSource: 'native',
      unifiedScore: 100,
      tier: 'Native',
      tierIcon: '⚡',
    };
  }

  // ════════════════════════════════════════════════════════
  // RULE 2: Known Stablecoins → I-Score
  // ════════════════════════════════════════════════════════
  const STABLECOIN_MINTS = new Set([
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    'USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX',  // USDH
    // ... add more
  ]);

  if (STABLECOIN_MINTS.has(mint) || token.pegTarget === 'USD') {
    return {
      type: 'INFRASTRUCTURE',
      subtype: 'STABLECOIN',
      scoreSource: 'i-score',
      unifiedScore: calculateIScore(token),
      // ... tier derived from score
    };
  }

  // ════════════════════════════════════════════════════════
  // RULE 3: Liquid Staking Tokens → I-Score
  // ════════════════════════════════════════════════════════
  const LST_MINTS = new Set([
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
    'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
    'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', // bSOL
    'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v', // jupSOL
    'inf9SwBfFSEWwmcGfn3rGjPxVJbZsEFJ3MKsLSrPJss', // INF
    // ... add more
  ]);

  if (LST_MINTS.has(mint) || token.underlyingAsset === 'SOL') {
    return {
      type: 'INFRASTRUCTURE',
      subtype: 'LST',
      scoreSource: 'i-score',
      unifiedScore: calculateIScore(token),
    };
  }

  // ════════════════════════════════════════════════════════
  // RULE 4: Wrapped/Bridged Assets → I-Score
  // ════════════════════════════════════════════════════════
  if (token.isWrapped || token.bridgeProtocol) {
    return {
      type: 'INFRASTRUCTURE',
      subtype: 'WRAPPED',
      scoreSource: 'i-score',
      unifiedScore: calculateIScore(token),
    };
  }

  // ════════════════════════════════════════════════════════
  // RULE 5: High TVL + Low K-Score = Infrastructure Candidate
  // ════════════════════════════════════════════════════════
  // Catches tokens that look like infrastructure but aren't categorized
  if (token.totalLiquidityUsd > 10_000_000 && token.kScore < 30) {
    return {
      type: 'INFRASTRUCTURE_CANDIDATE',
      subtype: 'AUTO_DETECTED',
      scoreSource: 'i-score',
      unifiedScore: calculateIScore(token),
      flaggedForReview: true,  // HolDex team should verify
    };
  }

  // ════════════════════════════════════════════════════════
  // DEFAULT: Community Token → K-Score
  // ════════════════════════════════════════════════════════
  return {
    type: 'COMMUNITY',
    scoreSource: 'k-score',
    unifiedScore: token.kScore,
    // ... tier derived from K-score
  };
}
```

---

## API Specification

### New Endpoint: Unified Token Score

```
GET /api/token/:mint/score
```

#### Response Schema

```typescript
interface TokenScoreResponse {
  success: boolean;
  token: {
    mint: string;
    symbol: string;
    name: string;

    // Classification
    type: 'NATIVE' | 'INFRASTRUCTURE' | 'COMMUNITY';
    subtype?: 'STABLECOIN' | 'LST' | 'WRAPPED' | 'AUTO_DETECTED';

    // Scores
    kScore: number | null;        // null if infrastructure
    iScore: number | null;        // null if community
    unifiedScore: number;         // THE score to use (0-100)
    scoreSource: 'native' | 'k-score' | 'i-score';

    // Tier (derived from unifiedScore)
    tier: 'Native' | 'Diamond' | 'Platinum' | 'Gold' | 'Silver' | 'Bronze' | 'Copper' | 'Iron' | 'Rust';
    tierIcon: string;             // ⚡💎💠🥇🥈🥉🟤⚫🔩
    tierLevel: number;            // 9-1

    // Score Components (for transparency)
    components?: {
      // K-Score components (if community)
      conviction?: {
        accumulators: number;
        maintained: number;
        reducers: number;
        extractors: number;
        total: number;
      };
      // I-Score components (if infrastructure)
      infrastructure?: {
        liquidityScore: number;
        volumeScore: number;
        backingScore: number;
        lindyBonus: number;
        pegBonus: number;
        backingType: string;
      };
    };

    // Metadata
    totalLiquidityUsd: number;
    volume24hUsd: number;
    marketCapUsd: number;
    holders: number;
    ageDays: number;

    // For GASdf integration
    accepted: boolean;            // unifiedScore >= 50
    acceptanceReason: string;     // 'native' | 'diamond_infra' | 'tier_accepted' | 'tier_rejected'
  };

  // Cache info
  cached: boolean;
  cacheAge: number;              // ms since cached
  dataTimestamp: string;         // ISO timestamp
}
```

#### Example Responses

**Native SOL:**
```json
{
  "success": true,
  "token": {
    "mint": "So11111111111111111111111111111111111111112",
    "symbol": "SOL",
    "type": "NATIVE",
    "kScore": null,
    "iScore": null,
    "unifiedScore": 100,
    "scoreSource": "native",
    "tier": "Native",
    "tierIcon": "⚡",
    "accepted": true,
    "acceptanceReason": "native"
  }
}
```

**USDC (Stablecoin):**
```json
{
  "success": true,
  "token": {
    "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "symbol": "USDC",
    "type": "INFRASTRUCTURE",
    "subtype": "STABLECOIN",
    "kScore": null,
    "iScore": 97,
    "unifiedScore": 97,
    "scoreSource": "i-score",
    "tier": "Diamond",
    "tierIcon": "💎",
    "components": {
      "infrastructure": {
        "liquidityScore": 100,
        "volumeScore": 95,
        "backingScore": 100,
        "lindyBonus": 23.6,
        "pegBonus": 38.0,
        "backingType": "CENTRALIZED_AUDITED"
      }
    },
    "accepted": true,
    "acceptanceReason": "diamond_infra"
  }
}
```

**$asdfasdfa (Community Token):**
```json
{
  "success": true,
  "token": {
    "mint": "9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump",
    "symbol": "asdfasdfa",
    "type": "COMMUNITY",
    "kScore": 73,
    "iScore": null,
    "unifiedScore": 73,
    "scoreSource": "k-score",
    "tier": "Gold",
    "tierIcon": "🥇",
    "components": {
      "conviction": {
        "accumulators": 450,
        "maintained": 1200,
        "reducers": 180,
        "extractors": 50,
        "total": 1880
      }
    },
    "accepted": true,
    "acceptanceReason": "tier_accepted"
  }
}
```

---

## GASdf Integration Changes

### Before (Current)

```javascript
// token-gate.js - Multiple hardcoded lists
const DIAMOND_TOKENS = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
]);

async function isTokenAccepted(mint) {
  // Bypass HolDex for hardcoded tokens
  if (DIAMOND_TOKENS.has(mint)) {
    return { accepted: true, tier: 'Diamond', kScore: 100 };
  }
  // Call HolDex for others
  return await holdex.isTokenAccepted(mint);
}
```

### After (With I-Score)

```javascript
// token-gate.js - Single source of truth
const NATIVE_SOL = 'So11111111111111111111111111111111111111112';

async function isTokenAccepted(mint) {
  // Only hardcode: Native SOL (not a token, can't query)
  if (mint === NATIVE_SOL) {
    return {
      accepted: true,
      tier: 'Native',
      unifiedScore: 100,
      type: 'NATIVE',
      scoreSource: 'native'
    };
  }

  // EVERYTHING else via HolDex unified score
  const { token } = await holdex.getTokenScore(mint);

  return {
    accepted: token.accepted,
    tier: token.tier,
    tierIcon: token.tierIcon,
    unifiedScore: token.unifiedScore,
    type: token.type,
    scoreSource: token.scoreSource,
    components: token.components,
  };
}
```

### Benefits

| Before | After |
|--------|-------|
| 3 hardcoded lists to maintain | 1 hardcode (native SOL only) |
| Adding Diamond token = code change + deploy | Adding = HolDex DB update |
| USDC kScore=0 hidden by hardcode | USDC iScore=97 from real metrics |
| Philosophy violated | HolDex = true source of truth |

---

## Migration Path

### Phase 1: HolDex Backend (Week 1-2)
1. [ ] Add `token_type` column to tokens table
2. [ ] Add `i_score` column to tokens table
3. [ ] Implement `calculateIScore()` function
4. [ ] Implement `classifyToken()` function
5. [ ] Create `/api/token/:mint/score` endpoint
6. [ ] Backfill I-Score for known infrastructure tokens
7. [ ] Add cron job for I-Score recalculation (hourly)

### Phase 2: GASdf Integration (Week 2-3)
1. [ ] Update holdex.js client to use new endpoint
2. [ ] Remove DIAMOND_TOKENS from token-gate.js
3. [ ] Remove DIAMOND_TOKENS from oracle.js
4. [ ] Update frontend to show type badge (Infra vs Community)
5. [ ] Add Redis cache for unified scores
6. [ ] Update tests

### Phase 3: Monitoring & Tuning (Week 3-4)
1. [ ] Monitor I-Score distribution
2. [ ] Tune formula weights if needed
3. [ ] Add alerting for score anomalies
4. [ ] Document edge cases

---

## Open Questions for HolDex Team

1. **Backing Type Curation:** How should we maintain the `backingType` field? Manual curation or automated detection?

2. **LST Detection:** Should we detect LSTs by checking for stake pool programs, or maintain a curated list?

3. **Score Refresh Rate:** K-Score updates with each trade. I-Score components (liquidity, volume) - how often should we recalculate?

4. **Infrastructure Candidates:** When `flaggedForReview: true`, what's the process? Auto-promote after N days? Manual approval?

5. **Historical Data:** Should we store I-Score history like K-Score for trend analysis?

---

## Appendix: Tier Thresholds

```
Score 100     = Native (SOL only)
Score 90-99   = Diamond
Score 80-89   = Platinum
Score 70-79   = Gold
Score 60-69   = Silver
Score 50-59   = Bronze     ← Minimum for GASdf acceptance
Score 40-49   = Copper
Score 20-39   = Iron
Score 0-19    = Rust
```

---

*Document generated by GASdf team for HolDex integration planning.*
