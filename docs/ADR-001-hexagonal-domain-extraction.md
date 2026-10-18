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

## 7. Statut

Accepted. Migration incrémentale selon §5, priorité P0 d'abord (fee + token-gate).
