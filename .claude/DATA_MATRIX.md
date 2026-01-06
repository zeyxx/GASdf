# GASdf Data Matrix

> Vision complète de toutes les données traitées et gérées par le système.

---

## 1. Redis (Hot Data)

Prefix: `gasdf:`

### Quotes (Ephemeral)
| Clé | TTL | Description |
|-----|-----|-------------|
| `quote:{quoteId}` | 60s | Quote active avec paymentToken, userPubkey, feePayer, feeAmount |
| `tx:{quoteId}` | 3600s | Transaction queue entry |

### Stats (Persistent)
| Clé | TTL | Description |
|-----|-----|-------------|
| `stats:burn_total` | - | Total $ASDF brûlés (lamports) |
| `stats:tx_count` | - | Nombre total de transactions |
| `stats:treasury_total` | - | Balance treasury trackée |

### Burn Tracking (Per-Wallet)
| Clé | TTL | Description |
|-----|-----|-------------|
| `burn:wallet:{address}` | - | Total brûlé par wallet |
| `burn:wallet:txcount:{address}` | - | Nb transactions par wallet |
| `burn:leaderboard` | - | Sorted set: wallet → score (burn total) |
| `burn:proof:{signature}` | 365j | Preuve de burn vérifiable |
| `burn:proofs` | 90j | Liste chronologique (1000 max) |
| `burn:proof:count` | - | Compteur total de preuves |

### Treasury
| Clé | TTL | Description |
|-----|-----|-------------|
| `treasury:history` | 30j | Liste d'événements treasury (100 max) |

### Anti-Replay Protection
| Clé | TTL | Description |
|-----|-----|-------------|
| `txhash:{hash}` | 90s | Transaction hash vue (SET NX) |

### Rate Limiting
| Clé | TTL | Description |
|-----|-----|-------------|
| `ratelimit:wallet:{type}:{address}` | 60s | Compteur par wallet (quote/submit) |

### Anomaly Detection
| Clé | TTL | Description |
|-----|-----|-------------|
| `anomaly:wallet:{type}:{address}` | 300s | Activité wallet (5min window) |
| `anomaly:ip:{type}:{ip}` | 300s | Activité IP |

### Velocity Tracking
| Clé | TTL | Description |
|-----|-----|-------------|
| `velocity:count:{bucket}` | ~1h | Tx count par bucket (60s) |
| `velocity:cost:{bucket}` | ~1h | Cost total par bucket |

### Caches
| Clé | TTL | Description |
|-----|-----|-------------|
| `jup:quote:{input}:{output}:{bucket}` | 10s | Jupiter quotes cachés |
| `holdex:token:{mint}` | 300s | HolDex token data |
| `holdex:token:{mint}` (error) | 30s | Erreurs HolDex (TTL réduit) |

### Locks (Distributed)
| Clé | TTL | Description |
|-----|-----|-------------|
| `lock:{name}` | 30-60s | Verrou distribué (SET NX) |

### Audit Log
| Clé | TTL | Description |
|-----|-----|-------------|
| `audit:log` | 7j | Liste d'événements audit (10k max) |

### Pending Operations
| Clé | TTL | Description |
|-----|-----|-------------|
| `pending:swap_amount` | - | Montant en attente de swap |

---

## 2. PostgreSQL (Cold Data)

### Table: `burns`
| Colonne | Type | Description |
|---------|------|-------------|
| id | SERIAL | PK |
| signature | VARCHAR(100) | Signature burn (UNIQUE) |
| swap_signature | VARCHAR(100) | Signature swap Jupiter |
| amount_burned | NUMERIC(20,6) | Montant $ASDF brûlé |
| sol_equivalent | NUMERIC(20,9) | Équivalent SOL |
| treasury_amount | NUMERIC(20,9) | Part treasury (23.6%) |
| method | VARCHAR(20) | 'jupiter' |
| wallet | VARCHAR(50) | Wallet source |
| created_at | TIMESTAMP | Date création |

### Table: `transactions`
| Colonne | Type | Description |
|---------|------|-------------|
| id | SERIAL | PK |
| quote_id | VARCHAR(50) | Quote ID (UNIQUE) |
| signature | VARCHAR(100) | Signature transaction |
| user_wallet | VARCHAR(50) | Wallet utilisateur |
| payment_token | VARCHAR(50) | Token de paiement |
| fee_amount | NUMERIC(20,6) | Montant fee |
| fee_sol_equivalent | NUMERIC(20,9) | Équivalent SOL |
| status | VARCHAR(20) | pending/submitted/confirmed/failed |
| error_message | TEXT | Message erreur si failed |
| ip_address | VARCHAR(50) | IP client |
| created_at | TIMESTAMP | Date création |
| completed_at | TIMESTAMP | Date complétion |

### Table: `token_stats`
| Colonne | Type | Description |
|---------|------|-------------|
| mint | VARCHAR(50) | PK - Mint address |
| symbol | VARCHAR(20) | Symbole token |
| name | VARCHAR(100) | Nom token |
| total_fees_collected | NUMERIC(20,6) | Total fees collectés |
| total_transactions | INT | Nb transactions |
| last_used | TIMESTAMP | Dernière utilisation |
| k_score | VARCHAR(20) | Score HolDex |
| created_at | TIMESTAMP | Date création |
| updated_at | TIMESTAMP | Date MAJ |

### Table: `audit_log`
| Colonne | Type | Description |
|---------|------|-------------|
| id | SERIAL | PK |
| event_type | VARCHAR(50) | Type d'événement |
| event_data | JSONB | Données structurées |
| wallet | VARCHAR(50) | Wallet concerné |
| ip_address | VARCHAR(50) | IP source |
| severity | VARCHAR(10) | INFO/WARN/ERROR |
| created_at | TIMESTAMP | Date création |

### Table: `daily_stats`
| Colonne | Type | Description |
|---------|------|-------------|
| date | DATE | PK |
| total_burns | NUMERIC(20,6) | Burns du jour |
| total_transactions | INT | Tx du jour |
| unique_wallets | INT | Wallets uniques |
| total_fees_sol | NUMERIC(20,9) | Fees en SOL |
| treasury_balance | NUMERIC(20,9) | Balance treasury |
| created_at | TIMESTAMP | Date création |

---

## 3. In-Memory Caches (Per-Instance)

### holder-tiers.js
| Cache | TTL | Description |
|-------|-----|-------------|
| `holderCache` | 60s | Balance $ASDF par wallet |
| `totalSupplyCache` | 120s | Supply total $ASDF |

### harmony.js
| Cache | TTL | Description |
|-------|-----|-------------|
| `eScoreCache` | 120s | E-Score HolDex par wallet |

### holdex.js
| Cache | TTL | Description |
|-------|-----|-------------|
| `tokenCache` (L1) | 300s | Token data HolDex (in-memory) |
| Redis (L2) | 300s | Token data HolDex (partagé) |

### jupiter.js
| Cache | TTL | Description |
|-------|-----|-------------|
| Redis | 10s | Jupiter quotes |

### fee-payer-pool.js
| Cache | TTL | Description |
|-------|-----|-------------|
| `balanceCache` | 30s | Balances fee payers |
| `reservations` | - | Réservations quotes actives |

### treasury-ata.js
| Cache | TTL | Description |
|-------|-----|-------------|
| `ataCache` | 300s | ATAs treasury créés |

### helius.js
| Cache | TTL | Description |
|-------|-----|-------------|
| `priorityFeeCache` | 10s | Priority fees estimés |

### pyth.js
| Cache | TTL | Description |
|-------|-----|-------------|
| `priceCache` | 10s | Prix SOL/USD |

### oracle.js
| Cache | TTL | Description |
|-------|-----|-------------|
| `tokenPriceCache` | 60s | Prix tokens via Jupiter |

---

## 4. External Data Sources

### HolDex API
| Endpoint | Données | Usage |
|----------|---------|-------|
| `GET /api/token/{mint}` | K-score, tier, supply, burnedPercent | Token gating |
| `GET /api/harmony/{wallet}` | E-Score (7 dimensions) | Discount engagement |

### Jupiter API
| Endpoint | Données | Usage |
|----------|---------|-------|
| `GET /quote` | Route, prix, slippage | Fee calculation + swaps |
| `POST /swap` | Transaction encodée | Exécution swap |

### Helius SDK
| Méthode | Données | Usage |
|---------|---------|-------|
| `getPriorityFeeEstimate` | microLamports/CU | Priority fee dynamique |
| `getAssetsByOwner` | NFTs, tokens | Balance checks (DAS) |

### Pyth Network
| Feed | Données | Usage |
|------|---------|-------|
| `SOL/USD` | Prix spot | Conversion fees |

### Solana RPC
| Méthode | Données | Usage |
|---------|---------|-------|
| `getBalance` | SOL balance | Fee payer monitoring |
| `getTokenAccountBalance` | Token balance | Treasury, holder tiers |
| `sendTransaction` | Signature | Submit transactions |
| `simulateTransaction` | Logs, CU used | CPI protection |

---

## 5. Audit Events (Types)

| Event Type | Severity | Description |
|------------|----------|-------------|
| `QUOTE_CREATED` | INFO | Quote générée |
| `QUOTE_REJECTED` | WARN | Quote refusée (token, circuit) |
| `SUBMIT_SUCCESS` | INFO | Transaction soumise |
| `REPLAY_ATTACK_DETECTED` | ERROR | Tentative replay |
| `CPI_ATTACK_DETECTED` | ERROR | Drain CPI détecté |
| `VALIDATION_FAILED` | WARN | Validation échouée |
| `FEE_PAYER_MISMATCH` | WARN | Fee payer incorrect |
| `BLOCKHASH_EXPIRED` | WARN | Blockhash expiré |
| `SIMULATION_FAILED` | WARN | Simulation échouée |
| `BURN_EXECUTED` | INFO | Burn exécuté |
| `TREASURY_REFILL` | INFO | Treasury rechargé |

---

## 6. Metrics (Prometheus)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `gasdf_quotes_total` | Counter | status | Quotes créées |
| `gasdf_quote_duration_seconds` | Histogram | status | Latence quotes |
| `gasdf_submits_total` | Counter | status | Transactions soumises |
| `gasdf_submit_duration_seconds` | Histogram | status | Latence submits |
| `gasdf_active_quotes` | Gauge | - | Quotes actives |
| `gasdf_burn_total` | Counter | - | Total brûlé |
| `gasdf_fee_payer_balance` | Gauge | pubkey | Balance fee payer |

---

## 7. Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              USER REQUEST                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              /v1/quote                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  HolDex API  │  │   Jupiter    │  │   Helius     │  │ Holder Tier  │ │
│  │  (K-score)   │  │   (price)    │  │ (priority)   │  │  (balance)   │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                 │                 │                 │         │
│         └─────────────────┴─────────────────┴─────────────────┘         │
│                                    │                                     │
│                                    ▼                                     │
│                    ┌───────────────────────────────┐                     │
│                    │  Redis: quote:{id} (60s TTL)  │                     │
│                    │  + fee payer reservation       │                     │
│                    └───────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              /v1/submit                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Redis Quote  │  │   Validate   │  │  Simulate    │  │    Sign      │ │
│  │   Lookup     │  │  (replay,    │  │  (CPI check) │  │  + Send      │ │
│  │              │  │   fee pmt)   │  │              │  │              │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                 │                 │                 │         │
│         └─────────────────┴─────────────────┴─────────────────┘         │
│                                    │                                     │
│                                    ▼                                     │
│         ┌──────────────────────────────────────────────────────┐        │
│         │  PostgreSQL: transactions + Redis: pending swap      │        │
│         └──────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BURN WORKER (60s interval)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Treasury Scan│  │ Jupiter Swap │  │  Burn 76.4%  │  │ Treasury 23.6│ │
│  │ (balances)   │  │ → $ASDF      │  │              │  │              │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                 │                 │                 │         │
│         └─────────────────┴─────────────────┴─────────────────┘         │
│                                    │                                     │
│                                    ▼                                     │
│    ┌────────────────────────────────────────────────────────────────┐   │
│    │  Redis: burn stats + PostgreSQL: burns + Redis: burn proofs   │   │
│    └────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Data Retention

| Système | Données | Rétention |
|---------|---------|-----------|
| Redis | Quotes | 60s |
| Redis | Tx hashes | 90s |
| Redis | Rate limits | 60s |
| Redis | Anomaly tracking | 5min |
| Redis | Jupiter cache | 10s |
| Redis | HolDex cache | 5min |
| Redis | Audit log | 7 jours |
| Redis | Burn proofs list | 90 jours |
| Redis | Burn proof (single) | 1 an |
| Redis | Treasury history | 30 jours |
| PostgreSQL | Burns | Permanent |
| PostgreSQL | Transactions | Permanent |
| PostgreSQL | Token stats | Permanent |
| PostgreSQL | Audit log | Permanent |
| PostgreSQL | Daily stats | Permanent |

---

*Dernière mise à jour: 2026-01-06*
