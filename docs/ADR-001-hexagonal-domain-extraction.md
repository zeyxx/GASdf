# ADR-001 — Extraction du domaine pur (hexagonal) dans GASdf

**Status:** accepted (operator-decided, 2026-10-18)
**Context:** GASdf est actuellement en architecture layered (routes → services → utils/infra). Les docs déclarent une architecture hexagonale qui n'est pas implémentée. Le protocole doit émerger organiquement des preuves, donc le domaine doit être testable isolément et auditable.
**Decision:** extraire un domaine pur avec des ports typés, l'infra derrière des adapters. Alignement avec le modèle CYNIC (FCIS : logique pure dans domain/, side effects derrière des ports dans adapters/).

---

## 1. Problème

Les services actuels mélangent logique métier et I/O :

- `fee-schedule.js` calcule des fees mais lit `config` directement
- `jupiter.js` mélange pricing, swap execution, cache Redis
- `validator.js` valide des tx mais dépend de `connection`
- `token-gate.js` est pur (whitelist) mais couplé à `constants.js`
- `burn-worker.js` mélange accumulation, swap Jupiter, burn on-chain, ledger

Conséquence : impossible de tester la logique métier sans mocker l'infra, impossible d'auditer le domaine isolément, impossible de réutiliser le domaine dans un autre runtime (ex. Kora sidecar en Rust).

## 2. Décision

Adopter une architecture **hexagonale (ports & adapters)** pour GASdf, alignée sur CYNIC :

```
src/
├── domain/              ← logique pure, zero I/O, testable en isolation
│   ├── fee/             ← calcul de fee (base + CU + priority, cap)
│   ├── token-gate/      ← acceptation de token (whitelist)
│   ├── tx-validation/   ← validation structurelle de tx
│   └── burn/            ← économie de burn (ratio, treasury)
├── ports/               ← interfaces (contrats) que le domaine utilise
│   ├── PriceOracle.ts   ← prix token (Jupiter)
│   ├── RpcProvider.ts   ← Solana RPC
│   ├── QuoteStore.ts    ← stockage de quote (Redis/memory)
│   ├── Ledger.ts        ← append-only proof ledger
│   └── Signer.ts        ← signature/co-signature
├── adapters/            ← implémentations concrètes des ports
│   ├── jupiter/         ← adapter PriceOracle via Jupiter
│   ├── helius/          ← adapter RpcProvider via Helius
│   ├── redis/           ← adapter QuoteStore via Redis
│   ├── jsonl/           ← adapter Ledger via JSONL
│   └── kora/            ← adapter Signer via Kora
├── routes/              ← inbound adapters (HTTP) — minces, délèguent au domaine
├── middleware/          ← cross-cutting (security, validation)
└── composition/         ← wiring (composition root, injection de dépendances)
```

## 3. Règles

1. **Domaine pur** : aucune dépendance sur `@solana/web3.js`, `redis`, `express`, `fs`. Fonctions pures avec entrées/sorties typées.
2. **Ports** : interfaces TypeScript (ou Rust traits si sidecar). Le domaine dépend des ports, jamais des adapters.
3. **Adapters** : implémentent les ports. Contiennent tout l'I/O. Testables via mocks.
4. **Routes** : minces. Parsing HTTP → appel domaine → sérialisation. Pas de logique métier.
5. **Composition root** : un seul fichier (`composition/index.ts`) qui instancie les adapters et les injecte dans le domaine.
6. **Tests** : domaine testé en isolation (inputs/outputs purs). Adapters testés avec mocks. Routes testées via supertest.

## 4. Domaine à extraire (priorité)

| Domaine | Source actuelle | Port requis | Priorité |
|---|---|---|---|
| Fee calculation | `services/fee-schedule.js` | `PriceOracle` (pour conversion SOL→token) | P0 |
| Token gate | `services/token-gate.js` | aucun (pur) | P0 |
| Tx validation | `services/validator.js` | `RpcProvider` (pour sim) | P1 |
| Burn economics | `services/burn-worker.js` (partie calcul) | `PriceOracle`, `Ledger` | P1 |
| Quote lifecycle | `routes/quote.js` + `utils/redis.js` | `QuoteStore` | P2 |

## 5. Migration plan (incrémentale, pas de big-bang)

1. **Phase A** : extraire `fee-schedule` en domaine pur (`domain/fee/`) + port `PriceOracle`. Adapter Jupiter. Tests purs.
2. **Phase B** : extraire `token-gate` en domaine pur (déjà quasi-pur, juste découpler de `constants.js`).
3. **Phase C** : extraire `validator` en domaine pur + port `RpcProvider`. Adapter Helius.
4. **Phase D** : extraire `burn` économie (ratio, treasury) en domaine pur + port `Ledger`. Adapter JSONL.
5. **Phase E** : routes minces + composition root. Supprimer les imports directs d'infra dans les services.

Chaque phase = 1 PR, tests verts, pas de régression.

## 6. Conséquences

**Positives :**
- Domaine testable en isolation (pas de mock d'infra)
- Auditable : le domaine est lisible sans connaître l'infra
- Réutilisable : le domaine peut être porté en Rust (sidecar Kora) sans réécrire la logique
- Alignement avec CYNIC : même modèle mental (FCIS)

**Négatives :**
- Plus de fichiers, plus d'indirection
- Courbe d'apprentissage pour les nouveaux contributeurs
- Migration incrémentale = période de coexistence layered/hexagonal

**Risques :**
- Sur-ingénierie si le domaine est trop petit (fee calc = 1 fonction)
- Mitigation : ne pas créer de port pour 1 seul usage ; fusionner si un port n'a qu'un adapter

## 7. DDD léger (ajout 2026-10-18)

Le domaine est petit (Fee, Quote, Token, Tx, Burn, Treasury) et le protocole
émerge des preuves. Un DDD complet (event sourcing, bounded contexts multiples,
CQRS) serait de la sur-ingénierie à l'échelle 0. On adopte un **DDD léger** :

### 7.1 Ubiquitous language (glossaire)

| Terme | Définition |
|---|---|
| **Quote** | Prix du service en token de paiement, TTL 60s, immuable une fois créé |
| **Fee** | Montant total = base + CU charge + priority, en lamports puis converti en token |
| **Burn** | Conversion d'un token de paiement en $ASDF puis destruction on-chain |
| **Treasury** | Compte qui reçoit les fees (hot SOL + cold USDC) |
| **Hot reserve** | SOL disponible pour l'exécution, refill en priorité |
| **Cold reserve** | USDC de sécurité, pas de cap |
| **Margin** | Fee - coût réel (lamports + CU + tip) |
| **Margin waterfall** | Hot refill → cold reserve → burn → operator (dernier) |
| **CU cap** | Plafond de compute units accepté (1.4M) ; au-delà = refus |
| **Holder tier** | Niveau de discount selon la part de supply $ASDF détenu (Phase 2+) |

### 7.2 Value objects (immuables, validés à la construction)

- `Lamports` — montant en lamports (u64, >= 0)
- `ComputeUnits` — CU (u32, 1..=1_400_000)
- `TokenMint` — adresse de mint (base58, 32-44 chars)
- `QuoteId` — UUID v4
- `FeeAmount` — fee en lamports + conversion en token (montant + mint)
- `Margin` — fee - coût (peut être négatif → cellule refusée)

Règle : un value object se valide à la construction. Pas de magic numbers inline.

### 7.3 Aggregates

- **Quote** (root) : contient `Fee`, `PaymentToken`, `UserPubkey`, `FeePayer`, `Expiry`. Invariant : fee > 0, expiry > now, paymentToken dans la whitelist.
- **BurnBatch** (root) : contient `BurnProof[]`. Invariant : somme des burns = total brûlé, chaque proof a une signature on-chain.

Pas d'aggregate pour Transaction (stateless, validée puis soumise).

### 7.4 Domain events

- `QuoteCreated` — { quoteId, fee, paymentToken, expiry }
- `TxSubmitted` — { signature, quoteId, unitsConsumed, landed }
- `BurnExecuted` — { signature, amountBurned, mint }

Les events sont append-only dans le ledger JSONL. Pas d'event sourcing complet — le ledger est le journal.

### 7.5 Bounded context

Un seul contexte pour l'instant : **Gasless Execution**. Pas de split tant que le domaine ne grossit pas (règle : ne pas fragmenter prématurément).

### 7.6 Ce qu'on ne fait PAS (DDD complet différé)

- Event sourcing complet (le JSONL ledger suffit)
- CQRS (pas de séparation read/write au MVP)
- Repositories complexes (le ledger est le repository)
- Multiples bounded contexts (1 seul domaine = 1 contexte)

Réévaluation au BLOC 2 (présence publique) si le domaine grossit.

## 8. Statut

Accepted. Migration incrémentale selon §5, priorité P0 d'abord (fee + token-gate), avec DDD léger intégré (§7).
