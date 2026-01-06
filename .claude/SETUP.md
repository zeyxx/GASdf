# Claude Code Setup pour GASdf

> "Find the smallest possible set of high-signal tokens" — Anthropic

Ce guide documente la configuration Claude Code optimisée pour l'écosystème $asdfasdfa.

---

## Structure

```
.claude/
├── SETUP.md                  # Ce fichier
├── DEV_BACKLOG.md           # Backlog de développement
├── settings.local.json       # Permissions locales
├── agents/
│   └── librarian.md         # Subagent de recherche (Sonnet)
└── commands/
    ├── commit-push.md       # Workflow git
    ├── deploy.md            # Déploiement Render
    ├── monitor.md           # Monitoring services
    ├── test-e2e.md          # Tests E2E
    ├── debug-flow.md        # Debug quote/submit/burn
    ├── check-tokenomics.md  # Vérification économie φ
    └── security-review.md   # Checklist sécurité
```

---

## Principes de Contexte

### 1. Objectifs Scopés
Chaque conversation = un objectif clair:
- "Corriger le bug X"
- "Implémenter la feature Y"
- "Investiguer le problème Z"

### 2. Planification Avant Exécution
- Utiliser le mode plan (`Shift+Tab`) pour les tâches complexes
- Faire clarifier les ambiguïtés avant de coder
- Valider le plan avant l'implémentation

### 3. Reset Stratégique
- `/rewind` → revenir à un point stable
- `/new` → nouvelle conversation avec prompt affiné
- `/compact` → compresser le contexte si proche de la limite

---

## Subagents

### Librarian (Sonnet)
Recherche docs/code sans polluer le contexte principal.

**Quand l'utiliser:**
```
Use librarian to research [topic] and summarize the key patterns
```

**Exemples:**
- Docs Solana SDK
- API Jupiter
- Patterns Helius
- Best practices crypto

**Avantage:** Contexte séparé + modèle moins cher = économie de tokens.

---

## Skills (Commandes)

| Commande | Description |
|----------|-------------|
| `/commit-push` | Commit et push rapide |
| `/deploy` | Tests + déploiement Render |
| `/monitor` | Vérifier santé des services |
| `/test-e2e` | Tests end-to-end production |
| `/debug-flow` | Analyser le flux quote→submit→burn |
| `/check-tokenomics` | Vérifier l'économie φ |
| `/security-review` | Checklist sécurité |

---

## MCP Servers Actifs

| Serveur | Usage |
|---------|-------|
| `context7` | Documentation up-to-date |
| `solana` | Docs Solana + Anchor |
| `render` | Logs, déploiements, services |
| `github` | Issues, PRs, code search |

### Stratégie "Just-in-Time"
Ne pas charger toute la documentation d'avance. Utiliser les MCPs pour chercher au moment du besoin.

---

## Architecture GASdf (Référence Rapide)

### Flux Principal
```
Quote → Submit → Burn
  │       │        │
  │       │        └── 60s worker: swap → burn 76.4%
  │       └── Validate, sign, send
  └── Token gate (K≥50), fee calc, reserve payer
```

### Économie φ
```javascript
φ = 1.618...
BURN_RATIO = 76.4%    // 1 - 1/φ³
TREASURY_RATIO = 23.6% // 1/φ³
MAX_DISCOUNT = 95%     // cap holder + E-score
```

### Fichiers Clés
| Fichier | Responsabilité |
|---------|---------------|
| `src/routes/quote.js` | Génération de quotes |
| `src/routes/submit.js` | Soumission transactions |
| `src/services/burn.js` | Worker de burn |
| `src/services/holder-tiers.js` | Discounts holders |
| `src/services/harmony.js` | E-Score (HolDex) |
| `src/services/jupiter.js` | Swaps |
| `src/services/token-gate.js` | Vérification tokens |

---

## Pour les Nouveaux Contributeurs

1. **Lire le CLAUDE.md** — Vue d'ensemble du projet
2. **Lire l'ARCHITECTURE.md** — Flux détaillés
3. **Exécuter les tests** — `npm test` pour comprendre le comportement
4. **Utiliser le librarian** — Pour les questions sur Solana/crypto

### Première Contribution
```bash
# 1. Comprendre le codebase
Use librarian to explain the quote → submit flow in GASdf

# 2. Lancer les tests
npm test

# 3. Modifier en mode plan
[Shift+Tab] # Entrer en mode plan
```

---

## Troubleshooting Claude Code

### Contexte Plein
- `/compact` pour compresser
- `/new` avec prompt affiné
- Éviter les longs outputs de commandes

### Réponses de Mauvaise Qualité
- Reformuler le prompt avec plus de contexte
- Spécifier le format de sortie attendu
- Utiliser `/rewind` si nécessaire

### Recherche Inefficace
- Utiliser le subagent librarian
- Être spécifique dans les queries
- Préférer `context7` aux recherches web génériques

---

*Dernière mise à jour: 2026-01-06*
