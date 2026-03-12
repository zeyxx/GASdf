# CLAUDE.md — GASdf

## Références primaires (lire dans cet ordre)
1. `FOUNDATION.md` — vision, économie, blocs ICO vers Futard.io
2. `DESIGN.md` — spec fonctionnelle de chaque composant
3. `ENGINEERING.md` — stack, règles de code, séquence de build

## Contexte projet

GASdf est un relay gasless pour Solana : payer les frais de transaction en USDC, USDT, ou $ASDF au lieu de SOL. Objectif immédiat : ICO sur Futard.io (MetaDAO futarchy). Token protocole : $GASDF.

**Phase actuelle : Phase 0 — prouver que ça marche.**
Condition de sortie : 1 transaction réelle on-chain documentée.

## Règles absolues

### Transaction submission
- TOUJOURS Helius Sender — JAMAIS raw `connection.sendTransaction()`
- TOUJOURS `skipPreflight: true` avec Sender
- TOUJOURS Jito tip minimum 0.0002 SOL
- TOUJOURS priority fee via `ComputeBudgetProgram.setComputeUnitPrice`
- JAMAIS fee hardcodée — utiliser `getPriorityFeeEstimate`

### Explorer links
- TOUJOURS `orbmarkets.io` — JAMAIS Solscan, Solana FM, XRAY
- Tx : `https://orbmarkets.io/tx/{signature}`
- Address : `https://orbmarkets.io/address/{address}`

### Code
- JAMAIS `console.log` → utiliser `logger` (pino)
- JAMAIS magic numbers inline → `constants.js`
- JAMAIS `catch` vide → logger.error + retour explicite
- Invariant : `treasury.publicKey === feePayer.publicKey` → throw si faux (jamais silent fail)

### Scope Phase 0
Ne pas implémenter : multi fee-payer, PostgreSQL, yield $GASDF, E-Score, HolDex, MCP server public, bonding curve, MEV bundles.

## MCP disponibles
- `helius-mcp` — priority fees, tx submission, Solana docs research
  - `getPriorityFeeEstimate` pour les fees
  - `searchSolanaDocs`, `fetchHeliusBlog`, `getSIMD` pour la recherche
  - `readSolanaSourceFile` pour les internals Solana

## Skills disponibles
- `/svm` — Solana architecture, tx structure, ALTs, fee markets
- `/helius` — Helius SDK rules, Sender, priority fees, DAS API

## Commandes
```bash
npm install
npm run dev      # dev avec watch
npm start        # production
npm test         # vitest
npm run lint     # eslint
```

## Architecture rapide
```
routes/quote.js    → POST /v1/quote
routes/submit.js   → POST /v1/submit
routes/tokens.js   → GET  /v1/tokens
routes/health.js   → GET  /v1/health
services/          → logique métier
utils/config.js    → fail fast au démarrage si env vars manquantes
utils/redis.js     → quote store + locks + velocity
```
