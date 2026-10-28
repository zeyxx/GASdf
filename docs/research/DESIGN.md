# GASdf — Design Document
**v1.0 — 12/03/2026 | Spec fonctionnelle du rebuild**
**Référence primaire : FOUNDATION.md**

---

## Principe directeur

**Un seul chemin critique :** Quote → Submit → Burn.
Tout le reste est infrastructure au service de ce chemin.

---

## 1. Vue d'ensemble du système

```
Client (dApp / AI Agent)
  │
  ├── POST /v1/quote      ← "combien ça coûte ?"
  ├── POST /v1/submit     ← "voici ma tx signée"
  ├── GET  /v1/tokens     ← "quels tokens acceptés ?"
  └── GET  /v1/health     ← "le service tourne ?"

GASdf Server
  ├── Fee Payer (wallet Solana — seed 1-2 SOL)
  ├── Quote Store (Redis — TTL 60s)
  └── Burn Worker (cron — accumule → swap → brûle)
```

---

## 2. Composants

### 2.1 Quote Engine

**Ce que c'est :** Calcule le prix du service en tokens pour une transaction Solana.

**Entrée :**
```json
{
  "paymentToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "userPubkey": "...",
  "estimatedComputeUnits": 200000
}
```

**Ce qu'il fait :**
1. Vérifie que le token est dans la whitelist (USDC / USDT / $ASDF)
2. Récupère la priority fee via Helius `getPriorityFeeEstimate` (jamais hardcodée)
3. Calcule le fee total = BASE_FEE + priority fee
4. Applique le discount holder si applicable (log₁₀ formula)
5. Convertit le fee SOL → montant en token de paiement (via Jupiter price)
6. Stocke le quote dans Redis (TTL 60s) avec quoteId
7. Retourne quoteId + fee + feePayer pubkey + treasury ATA

**Sortie :**
```json
{
  "quoteId": "uuid",
  "feePayer": "...",
  "treasury": { "address": "...", "ata": "..." },
  "feeAmount": "1000000",
  "feeFormatted": "1.00 USDC",
  "paymentToken": { "mint": "...", "symbol": "USDC", "decimals": 6 },
  "holderDiscount": { "tier": "GOLD", "discountPercent": 33 },
  "expiresAt": 1234567890,
  "ttl": 60
}
```

**Ce qu'il n'est PAS :**
- Ne co-signe pas encore
- Ne valide pas la transaction du user
- Ne touche pas la blockchain

---

### 2.2 Submit Engine

**Ce que c'est :** Valide, co-signe, et broadcast la transaction du user.

**Entrée :**
```json
{
  "quoteId": "uuid",
  "transaction": "base64-encoded-signed-tx"
}
```

**Ce qu'il fait :**
1. Récupère le quote depuis Redis (expire = reject)
2. Désérialise la transaction
3. Valide la structure :
   - Fee payer = GASdf wallet (pas l'user)
   - Instruction de paiement présente (user → treasury, montant correct)
   - Pas d'instructions CPI suspectes (drain check)
   - Taille ≤ 1232 bytes (vérification pre-flight)
4. Co-signe avec la clé fee payer
5. Submit via **Helius Sender** (skipPreflight: true + Jito tip + priority fee)
6. Confirme la transaction
7. Enregistre dans Redis pour le Burn Worker
8. Retourne signature + explorer link (orbmarkets.io)

**Ce qu'il n'est PAS :**
- Ne crée pas la transaction (c'est le client qui la construit)
- Ne gère pas le routing Jupiter (c'est le client)
- Ne brûle pas immédiatement (asynchrone via Burn Worker)

**Règle critique :**
```
TOUJOURS Helius Sender — jamais raw sendTransaction RPC
TOUJOURS skipPreflight: true
TOUJOURS Jito tip minimum 0.0002 SOL
TOUJOURS priority fee via ComputeBudgetProgram
```

---

### 2.3 Burn Worker

**Ce que c'est :** Processus asynchrone qui convertit les fees collectées en $ASDF brûlés.

**Quand il tourne :** Cron toutes les 60s. Distributed lock (Redis) pour éviter les races.

**Flow USDC/USDT :**
```
Treasury accumule USDC/USDT (fees collectées)
  └── Batch check : total USD ≥ $0.50 (seuil minimum économique)
        └── Surplus = total - coût réseau couverts
              ├── Infra costs (Railway, Helius) → claimés on-chain
              ├── Yield pool → $GASDF stakers (Phase 2+)
              └── Achats $ASDF → burn pool
                    └── Jupiter swap USDC → $ASDF
                          └── burn instruction on-chain
```

**Flow $ASDF :**
```
Treasury accumule $ASDF (fees payées en $ASDF)
  └── Batch : swap $ASDF → SOL → rembourse fee payer
        └── $ASDF résiduel → brûlé directement
```

**Invariant critique :**
```
treasury.publicKey === feePayer.publicKey
(Phase 0 — un seul wallet. Si divergence → hard error, pas silent fail)
```

**Ce qu'il n'est PAS :**
- Pas synchrone avec le submit
- Pas un swap systématique (batch pour minimiser les frais)
- Pas de yield $GASDF en Phase 0 (réservé post-ICO)

---

### 2.4 Fee Payer Pool

**Ce que c'est :** Gestionnaire du wallet qui co-signe les transactions.

**Phase 0 :** Un seul wallet (clé privée en env var).

**Ce qu'il fait :**
- Expose `getFeePayer()` → Keypair
- Vérifie le solde SOL avant d'accepter des quotes (circuit breaker si < seuil)
- Calcule le seuil dynamique via velocity (tx/heure × coût moyen × buffer 2h)
- Fallback : seuil fixe 0.1 SOL si pas de données velocity

**Circuit breaker :**
```
solde < seuil → service pause (503 sur /quote)
solde > cible → reprend automatiquement
```

**Ce qu'il n'est PAS :**
- Pas multi-wallet (Phase 2)
- Pas de rotation automatique (Phase 2)

---

### 2.5 Token Gate

**Ce que c'est :** Whitelist des tokens acceptés comme paiement.

**Phase 0 — whitelist hardcodée :**
```
USDC : EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
USDT : Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
$ASDF: 9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump
```

**Ce qu'il n'est PAS :**
- Pas de HolDex K-score (supprimé — single point of failure)
- Pas de score dynamique (Phase 3+)

---

### 2.6 Holder Discount

**Ce que c'est :** Réduction du fee basée sur la part de supply $ASDF détenue.

**Formula :**
```
share = balance_user / circulating_supply
discount = min(95%, max(0, (log₁₀(share) + 5) / 3))
fee_final = max(discounted_fee, break_even_fee)
break_even = tx_cost / treasury_ratio  (treasury_ratio = 1/φ³ ≈ 23.6%)
```

**Tiers :**
```
DIAMOND  ≥ 1.000% supply → 95% discount
PLATINUM ≥ 0.100% supply → 67% discount
GOLD     ≥ 0.010% supply → 33% discount
SILVER   ≥ 0.001% supply → 0%  discount
BRONZE   < 0.001% supply → 0%  discount
```

**Cache :** 5 minutes (supply + balance). Acceptable — précision exacte non requise.

**Ce qu'il n'est PAS :**
- Pas d'E-Score / Harmony (Phase 3+, post-ICO via governance)

---

### 2.7 Quote Store (Redis)

**Ce que c'est :** Stockage éphémère des quotes actifs.

**Structure clé :**
```
quote:{quoteId} → {
  paymentToken, userPubkey, feePayer,
  treasuryAddress, treasuryAta,
  feeAmount, feeAmountLamports,
  expiresAt, createdAt
}
TTL: 60 secondes
```

**Aussi stocké :**
- Velocity data (tx/heure pour calcul du buffer fee payer)
- Burn proofs (audit trail léger)
- Rate limit counters (IP + wallet)

**Ce que Redis n'est PAS :**
- Pas de cold storage (= PostgreSQL, Phase 2)
- Pas de fallback in-memory en prod (si Redis down → service down, c'est voulu)

---

### 2.8 APIs exposées

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/v1/quote` | POST | none | Obtenir un quote de fee |
| `/v1/submit` | POST | none | Soumettre une tx signée |
| `/v1/tokens` | GET | none | Lister les tokens acceptés |
| `/v1/health` | GET | none | Status du service |

**Rate limiting :**
- IP : 30 req/min sur /quote, 15 req/min sur /submit
- Wallet : 20 quotes/min, 10 submits/min

---

## 3. Flux économique complet

```
USER PAIE EN USDC/USDT
─────────────────────────────────────────────────────────
  Submit → treasury reçoit USDC
  Burn Worker (batch) :
    Total USDC ≥ $0.50 ?
      → Jupiter : USDC → $ASDF
      → 100% $ASDF reçus → BRÛLÉS
      → SOL tx fees absorbés par le markup du service

USER PAIE EN $ASDF
─────────────────────────────────────────────────────────
  Submit → treasury reçoit $ASDF
  Burn Worker (batch) :
    $ASDF balance > 0 ?
      → Fraction : swap $ASDF → SOL (rembourse fee payer)
      → Reste : BRÛLÉ directement
```

**Note Phase 0 :** Pas de yield $GASDF stakers, pas de réserve protocole séparée.
Tout le surplus va au burn. Simple, prouvable, aligné avec la narrative.

---

## 4. Ce qui est hors scope (protection)

```
Phase 0 uniquement — tout le reste est post-ICO :

✗ Multi fee-payer          → Phase 2
✗ PostgreSQL cold storage  → Phase 2
✗ Yield $GASDF stakers     → post-ICO, governance
✗ Bonding curve $ASDF→$GASDF → post-ICO, governance
✗ E-Score / Harmony        → post-ICO, governance
✗ HolDex K-score           → supprimé définitivement Phase 0
✗ MEV / Jito bundles       → Phase 2 (tip oui, bundle non)
✗ MCP server public        → après 1 intégration externe
✗ Dashboard public         → Bloc 1 (après 100 tx réelles)
✗ SDK npm (gasdf-sdk)      → Bloc 2
✗ CYNIC                    → Phase 4+
```

---

## 5. Contrats d'interface (pour le SDK client)

Le client (dApp / agent) doit :

1. **Obtenir un quote** → `POST /v1/quote`
2. **Construire la transaction** :
   - `feePayer` = pubkey retournée par le quote
   - Inclure une instruction de transfert token : `user → treasury.ata`, montant = `feeAmount`
   - Signer avec sa propre clé
3. **Soumettre** → `POST /v1/submit` avec `{ quoteId, transaction: base64 }`
4. **Recevoir** la signature + confirmation

Le client ne gère JAMAIS le SOL. GASdf s'en charge entièrement.

---

## Références

- `FOUNDATION.md` — vision, économie, blocs ICO
- `ENGINEERING.md` — comment on construit (stack, patterns, séquence)
- `CLAUDE.md` — instructions Claude pour ce repo
