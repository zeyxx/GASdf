# GASdf — Foundation Document
**v1.0 — 11/03/2026 | Remplace STRATEGY.md comme référence primaire**

---

## 1. Ce que GASdf fait

GASdf permet de payer les frais de transaction Solana avec USDC, USDT ou $ASDF au lieu de SOL.

---

## 2. Qui l'utilise et pourquoi

**AI Agents Solana** — ont du USDC, pas de SOL. Douleur réelle, marché immédiat.
> "Ton agent n'a plus jamais à gérer du SOL."

**CEX → DeFi onboarding** — users depuis Coinbase/Binance avec USDC, zéro SOL.
> Approche via les developers, pas directement les users.

**$ASDF holders** — paient le gas au coût + leur token est brûlé.
> Supply ↓ → valeur ↑. Incentive aligné.

---

## 3. MVP exact

Ce qui doit exister. Rien de plus.

```
□ Backend gasless relay déployé (Railway Hobby)
□ Fee payer financé (1-2 SOL seedés par asdfasdfa)
□ JUPITER_API_KEY configuré
□ HELIUS_API_KEY configuré
□ Redis configuré
□ 1 transaction réelle on-chain documentée
□ Landing page (service + stats live)
□ Dashboard public (tx count + $ASDF brûlé)
```

**Condition de sortie MVP :** lien Solscan d'une vraie tx, fee payer remboursé.

---

## 4. L'économie

```
$ASDF ── token racine ── 1B supply, 10% brûlé, 543 holders
  │
  └── GASdf brûle $ASDF à chaque transaction
        │
        └── $GASDF ── token protocole ── gouvernance + yield
              │
              └── ICO Futard.io (MetaDAO futarchy)
```

### Flux de fees

```
User paie en USDC/USDT
  └── Coût réseau → remboursé au fee payer
  └── Surplus → trésorerie protocole
        ├── Coûts infra réels (Railway, Helius)
        ├── Yield → $GASDF stakers (en $ASDF ou USDC)
        └── Achats $ASDF marché → réserve protocole → brûlé

User paie en $ASDF
  └── Batch swap $ASDF → SOL → rembourse fee payer
  └── $ASDF accumulés → brûlés
```

### Structure ICO (MetaDAO — non flexible)

```
10,000,000  $GASDF → communauté (USDC, 4 jours, pro-rata)
 2,900,000  $GASDF + 20% USDC levés → AMM liquidity (locked)
12,900,000  $GASDF → asdfasdfa (vested, milestones prix)
──────────────────────────────────────────────────────────
~25,800,000 $GASDF total max

Min raise   : ~$3,000 (calibré sur coûts infra réels)
Vesting     : 2x / 4x / 8x / 16x / 32x ICO price — cliff 18 mois
0 token upfront pour asdfasdfa.
```

### Connexion $ASDF ↔ $GASDF (post-ICO via governance)

```
Brûler $ASDF  → mint $GASDF (bonding curve, irréversible)
Locker $ASDF  → $GASDF progressif (veToken)
Stake $GASDF  → yield en $ASDF ou USDC
Burn $GASDF   → $ASDF depuis réserve protocole
```

---

## 5. Chemin séquentiel vers l'ICO

**Règle : chaque bloc débloque le suivant. Aucun ne peut être sauté.**

```
BLOC 0 — SERVICE LIVE
  Condition de sortie : 1 tx réelle on-chain, fee payer remboursé
  ─────────────────────────────────────────────────────────────
  □ Railway déployé + toutes env vars configurées
  □ Fee payer seeded (1-2 SOL)
  □ JUPITER_API_KEY configuré
  □ 1ère transaction testée manuellement
  □ Lien Solscan public

BLOC 1 — VOLUME PROUVÉ
  Condition de sortie : 100+ tx réelles, burns documentés, modèle éco validé
  ─────────────────────────────────────────────────────────────
  □ Agent interne tourne via GASdf (stress test continu)
  □ Dashboard public live (tx + $ASDF brûlé en temps réel)
  □ Bugs prod réels corrigés (pas les théoriques)
  □ Min raise final calibré sur coûts infra réels observés

BLOC 2 — PRÉSENCE PUBLIQUE
  Condition de sortie : 1 intégration externe + communauté briefée $GASDF
  ─────────────────────────────────────────────────────────────
  □ Landing page live (clair, minimal, lien dashboard)
  □ Twitter/X actif (narrative "le monde brûle du gaz")
  □ Telegram actif + responsive
  □ 1 intégration externe réelle (dApp ou AI agent)
  □ Réponse "pourquoi pas Octane ?" rodée publiquement

BLOC 3 — ICO READY
  Condition de sortie : ICO ouverte sur Futard.io
  ─────────────────────────────────────────────────────────────
  □ Cayman SPC entity créée
  □ IP transférée à l'entité (domaines, software, comptes sociaux)
  □ Paramètres ICO finaux (min raise, service provider fee, seuil burn whitelist)
  □ 1 SOL pour déployer le DAO
  □ Contact MetaDAO via intake form + Kollan Telegram
  □ 1 semaine promo publique minimum
  □ $ASDF community briefée et prête pour l'ICO
```

---

## 6. Ce qu'on ne fait PAS (scope protection)

```
✗ HolDex K-score        — supprimé Phase 0, single point of failure
✗ E-Score / Harmony     — Phase 3+, après ICO via governance
✗ Ecosystem burn bonus  — Phase 3+
✗ Multi fee-payer       — Phase 2, après service prouvé
✗ MEV / Jito bundles    — Phase 2+
✗ MCP server            — après 1 intégration externe réelle
✗ CYNIC                 — Phase 4+, hors scope total
✗ RPC communautaire     — projet séparé, Phase 4+
```

---

## 7. Réponse compétitive

**"Pourquoi pas Octane ?"**
> Octane est un outil open-source à déployer soi-même, sans économie pour les holders.
> GASdf est un service géré + un protocole : chaque transaction brûle $ASDF,
> récompense les holders, gouverné par la communauté via futarchy.
> Ce n'est pas un outil. C'est un protocole.

**Helius intègre gasless nativement (probable 60-90j) :**
> GASdf tourne SUR Helius, pas contre.
> "Helius fait le RPC, GASdf fait le gasless."

---

## 8. Narrative centrale

> "Le monde brûle du gaz. On brûle le gas blockchain jusqu'à zéro."

**$ASDF** = la preuve de conviction. 100M brûlés avant qu'un protocole existe.
**GASdf** = le protocole qui monétise cette conviction.
**$GASDF** = la gouvernance de ce protocole.
**Futard.io** = là où la communauté prend le contrôle.

---

## Références

- `STRATEGY.md` — historique des décisions, questions ouvertes MetaDAO, failure modes
- `TODO.md` — bugs techniques connus
- `src/` — implémentation Phase 0
