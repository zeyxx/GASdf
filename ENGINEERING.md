# GASdf — Engineering Stack
**v1.0 — 12/03/2026 | Comment on build**
**Référence design : DESIGN.md**

---

## Méta-principe

**Séparation stricte des préoccupations à chaque échelle.**

Dans le fichier → une fonction, une responsabilité.
Dans le module → une couche, une interface.
Dans l'architecture → un domaine, un port.
Dans le build → une phase, un comportement observable.

Ce principe génère tous les autres choix ci-dessous.

---

## Stack

```
Runtime    : Node.js 20+ LTS
Framework  : Express.js (minimal, pas de magic)
Solana     : @solana/web3.js v1.x (legacy — VersionedTransaction pour ALTs Phase 2)
Tokens     : @solana/spl-token
RPC        : helius-sdk (wrapper Helius, pas raw @solana/web3.js Connection)
Swaps      : Jupiter v6 API (JUPITER_API_KEY requis)
Cache      : Redis (ioredis)
Config     : dotenv
Logs       : pino (structured JSON, pas console.log)
Tests      : vitest
Lint       : eslint + prettier
```

---

## Structure du repo

```
src/
├── index.js                 # Entrée — Express bootstrap, graceful shutdown
├── routes/
│   ├── quote.js             # POST /v1/quote
│   ├── submit.js            # POST /v1/submit
│   ├── tokens.js            # GET /v1/tokens
│   └── health.js            # GET /v1/health
├── services/
│   ├── fee-payer.js         # Keypair + circuit breaker + velocity buffer
│   ├── token-gate.js        # Whitelist Phase 0
│   ├── holder-discount.js   # Log formula + tier lookup
│   ├── jupiter.js           # Quote + swap (price oracle + burn swaps)
│   ├── helius.js            # Priority fees + tx submission (Sender)
│   └── burn-worker.js       # Cron burn : accumulate → swap → burn
├── utils/
│   ├── config.js            # Env vars + validation au démarrage
│   ├── redis.js             # Client Redis + helpers (quote store, locks, velocity)
│   ├── validator.js         # Validation structure transaction (submit)
│   └── logger.js            # pino instance
└── constants.js             # Mints, ratios φ, tiers — jamais inline

test/
├── unit/                    # Services isolés (mocks RPC/Redis)
└── integration/             # Flow complet quote→submit (devnet)

.env.example                 # Toutes les vars requises documentées
FOUNDATION.md
DESIGN.md
ENGINEERING.md (ce fichier)
CLAUDE.md
```

---

## Règles absolues (non négociables)

### Solana — Transaction Submission
```
TOUJOURS via Helius Sender (helius.transactions.sendSmartTransaction)
JAMAIS raw connection.sendTransaction()
TOUJOURS skipPreflight: true avec Sender
TOUJOURS Jito tip minimum 0.0002 SOL
TOUJOURS priority fee via ComputeBudgetProgram.setComputeUnitPrice
JAMAIS fee hardcodée — toujours getPriorityFeeEstimate
```

### Solana — Transaction Size
```
Limite absolue : 1232 bytes
Phase 0 fix   : Jupiter maxAccounts=15, onlyDirectRoutes=true
Phase 2 fix   : Address Lookup Tables (VersionedTransaction)
Pre-flight    : vérifier la taille AVANT de co-signer (pas après)
Fail early    : rejeter au quote si tx prévisionnellement trop grande
```

### Solana — Invariants
```
treasury.publicKey === feePayer.publicKey
  → Si faux : throw Error (jamais return null silencieux)

Quote TTL : 60s
  → Quote expiré = reject immédiat, pas de retry silencieux

Burn lock : Redis distributed lock
  → Si lock déjà tenu = skip (pas d'erreur)
```

### Code
```
Pas de any TypeScript (si on migre vers TS plus tard)
Pas de magic numbers inline → constants.js
Pas de console.log → logger.pino
Pas de catch vide → logger.error + re-throw ou retour explicite
Chaque route : validation schema en entrée (pas de trust implicite)
```

### Explorer Links
```
TOUJOURS orbmarkets.io — jamais Solscan, Solana FM, XRAY
Format tx      : https://orbmarkets.io/tx/{signature}
Format address : https://orbmarkets.io/address/{address}
Format token   : https://orbmarkets.io/token/{mint}
```

---

## Séquence de build

### Phase 0 — Fondations (avant tout code domaine)

**Condition de sortie :** server démarre, répond à /health, Redis connecté.

```
□ config.js       — env vars + validation (fail fast au démarrage si manquant)
□ logger.js       — pino structured JSON
□ redis.js        — client + ping de connexion
□ constants.js    — PHI, mints, tiers, ratios
□ index.js        — Express bootstrap + graceful shutdown
□ GET /health     — { status, redis, feePayer: { balance, seuil } }
□ .env.example    — toutes les vars documentées
□ Tests           — health check passe
```

**Observable :** `curl localhost:3000/v1/health` retourne 200.

---

### Phase 1 — Quote Engine

**Condition de sortie :** /quote retourne un fee valide en USDC.

```
□ token-gate.js          — whitelist 3 tokens
□ helius.js              — getPriorityFeeEstimate (MCP tool ou SDK)
□ jupiter.js             — getFeeInToken (prix token → SOL)
□ fee-payer.js           — getFeePayer() + circuit breaker simple
□ holder-discount.js     — getAsdfBalance + calculateDiscount
□ redis.js               — setQuote / getQuote / deleteQuote
□ POST /v1/quote         — flow complet
□ GET  /v1/tokens        — liste whitelist
□ Tests                  — quote USDC, quote USDT, quote $ASDF
                          — token rejeté, circuit breaker ouvert
```

**Observable :** POST /v1/quote avec USDC mint retourne quoteId + feeAmount.

---

### Phase 2 — Submit Engine

**Condition de sortie :** une transaction réelle on-chain, fee payer remboursé.

```
□ validator.js           — deserialize + checks structure tx
                            (feePayer correct, instruction paiement présente,
                             taille ≤ 1232 bytes, pas de CPI drain)
□ helius.js              — sendSmartTransaction (Sender + Jito + priority fee)
□ POST /v1/submit        — flow complet : quote → validate → co-sign → send → confirm
□ redis.js               — recordSubmit (pour burn worker)
□ Tests                  — tx valide acceptée (devnet)
                          — tx sans instruction paiement rejetée
                          — quote expiré rejeté
                          — tx trop grande rejetée
```

**Observable :** lien orbmarkets.io d'une transaction réelle confirmée.

---

### Phase 3 — Burn Worker

**Condition de sortie :** $ASDF brûlé on-chain, fee payer auto-remboursé.

```
□ burn-worker.js         — cron 60s + distributed lock
                            USDC/USDT : Jupiter swap → $ASDF → burn
                            $ASDF     : fraction → SOL (refill) + reste → burn
□ fee-payer.js           — velocity-based refill check
□ redis.js               — incrBurnTotal + recordBurnProof
□ startBurnWorker()      — appelé depuis index.js au démarrage
□ Tests                  — burn déclenché quand balance > seuil
                          — double-burn impossible (lock)
                          — refill SOL quand fee payer < seuil
```

**Observable :** burn tx on orbmarkets.io après 100 submits cumulés.

---

## Patterns adoptés

### Circuit Breaker (fee-payer.js)
```
Problème : fee payer vide → toutes les tx échouent silencieusement
Comment  : état OPEN/CLOSED basé sur solde SOL
           OPEN  → /quote retourne 503 immédiatement
           CLOSED → normal
           Check au démarrage + toutes les 30s
```

### Distributed Lock (redis.js)
```
Problème : burn worker dupliqué si plusieurs instances
Comment  : SET burn-lock NX EX 120
           Si lock tenu → skip proprement (pas d'erreur)
           Auto-expire après 120s (protection contre crash)
```

### Fail Fast Config (config.js)
```
Problème : service démarre avec config invalide → erreurs cryptiques plus tard
Comment  : validateConfig() au require() — process.exit(1) si vars manquantes
           Env vars requises en prod : HELIUS_API_KEY, REDIS_URL,
           FEE_PAYER_PRIVATE_KEY, JUPITER_API_KEY, ASDF_MINT
```

### Structured Logging (logger.js)
```
Problème : logs impossibles à parser, pas de contexte
Comment  : pino avec champs standardisés { level, service, msg, ...context }
           Jamais console.log en dehors de config validation
           Request ID sur chaque log de route
```

### Early Validation (validator.js)
```
Problème : tx invalide découverte après co-signature = fee payer dépensé pour rien
Comment  : tous les checks AVANT co-signature
           Ordre : deserialize → taille → structure → paiement → CPI check
           Fail sur le premier check qui échoue
```

---

## Patterns rejetés

```
Hexagonal / Ports & Adapters
  → Overkill pour Phase 0. Un seul adaptateur RPC (Helius), un seul store (Redis).
  → Revisiter si Phase 2 ajoute multi-RPC ou multi-store.

CQRS / Event Sourcing
  → Pas de read/write model séparé nécessaire. Volume Phase 0 < 100K tx/mois.
  → Revisiter si analytics nécessitent un read model dédié.

PostgreSQL (cold storage)
  → Phase 2. Redis suffit pour Phase 0 (quotes éphémères + burn proofs).
  → Revisiter après 100 tx réelles documentées.

Multi fee-payer
  → Phase 2. Un seul wallet suffit pour prouver le modèle.

TypeScript strict
  → Pas pour Phase 0 (vitesse > safety en exploration initiale).
  → Revisiter avant Phase 2 si le projet scale.

Microservices
  → Jamais pour ce scale. Modular monolith uniquement.
```

---

## Variables d'environnement requises

```bash
# Requis en production (process.exit si absent)
HELIUS_API_KEY=          # Helius RPC + priority fees + Sender
REDIS_URL=               # redis://... (Railway add-on recommandé)
FEE_PAYER_PRIVATE_KEY=   # Base58, 64-88 chars
JUPITER_API_KEY=         # portal.jup.ag (requis post Jan 31 2026)
ASDF_MINT=9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump

# Optionnel
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=https://asdfasdfa.tech
TREASURY_ADDRESS=        # Défaut = fee payer (Phase 0)
BASE_FEE_LAMPORTS=50000  # 5000 × 5 (break-even) × 2 (markup)
QUOTE_TTL_SECONDS=60
```

---

## Déploiement (Railway)

```
Service   : Railway Hobby ($5/mois)
Redis     : Railway add-on Redis (ou Upstash free tier)
Health    : GET /v1/health (Railway healthcheck)
Restart   : automatique sur crash (Railway)
Logs      : Railway dashboard (pino JSON → readable)
```

**Checklist déploiement :**
```
□ Toutes les env vars configurées dans Railway
□ Fee payer wallet financé (1-2 SOL sur mainnet)
□ JUPITER_API_KEY actif (portal.jup.ag)
□ HELIUS_API_KEY actif (free tier OK Phase 0)
□ REDIS_URL pointant vers instance active
□ health check passe en prod
□ 1 tx test manuelle réussie
```

---

## Références

- `FOUNDATION.md` — vision, économie, blocs ICO
- `DESIGN.md` — spec fonctionnelle (ce que chaque composant EST)
- Skills : `/svm` (Solana internals), `/helius` (Helius implementation rules)
- Helius MCP : `claude mcp add helius npx helius-mcp@latest`
