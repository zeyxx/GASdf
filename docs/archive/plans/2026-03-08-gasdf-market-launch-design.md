# GASdf — Design de Lancement Marché
**Date :** 08/03/2026
**Statut :** Approuvé
**Contexte :** Analyse de réalité + stratégie de lancement

---

## Réalité du Projet au 08/03/2026

### Ce qui existe
- Code solide v1.8.0 — 741 tests, 12 couches sécurité, SDK npm publié
- Architecture complète : quote → submit → burn (φ-based economics)
- Fee payer pool, Jupiter swap, burn worker 60s

### Ce qui ne fonctionne pas
- **Service DOWN** — dette Render, pas de hosting actif
- **HolDex dépendance** — K-score instable, API non fiable
- **Transaction size bug** — 1521 > 1232 bytes pour routes complexes
- **Fee payer non financé** — besoin SOL initial

### Décisions prises
- Supprimer HolDex (varnish instable) — reporté à plus tard
- Token acceptance : whitelist hardcodée USDC + USDT + $ASDF
- Fix tx size : `maxAccounts=15 + onlyDirectRoutes=true` (quick fix Phase 1)
- ALT (Address Lookup Tables) : Phase 2

---

## Réalité du Marché au 08/03/2026

### L'écosystème agent Solana
Helius est devenu l'infrastructure dominante pour AI agents :
- 60+ outils MCP, skills dédiés (Build, DFlow, Phantom, SVM)
- DFlow intégré : spot swaps, prediction markets, streaming
- Dune MCP : analytics on-chain accessibles programmatiquement
- **Gap critique : aucune solution gasless dans tout ce stack**

### La stack agent Solana (avec le vide)
```
Dune MCP      → données marché / analytics
Helius MCP    → infrastructure blockchain (60+ tools)
DFlow         → exécution trades / swaps
??????????    → gasless execution  ← LE VIDE QUE GASDF REMPLIT
```

### Volumes stablecoins Solana
- Explosion des volumes USDC/USDT sur Solana en 2026
- Les agents transactent massivement en stables — ils ont USDC, pas SOL
- Chaque agent Helius/DFlow paie toujours ses fees en SOL : friction non résolue

### Contexte mondial — Timing narratif
Guerre en Iran → prix du gaz réel explose → "gas" dans crypto chargé d'émotion.
Fenêtre narrative éphémère (2-3 mois max) : **"Le monde brûle du gaz. On brûle le gas blockchain jusqu'à zéro."**

---

## La Communauté $ASDF

- Token cult, ownership collectif ("nos", pas "mes")
- ~10 membres actifs quotidiennement, capacité de raids coordonnés
- Pas complètement inconnus — visibilité existante via raids Twitter/X
- Intérêt directement aligné : chaque tx GASdf brûle $ASDF → leur bag croît
- Limite : les dApps asdfasdfa.tech sont inutilisées → preuve technique OK, pas preuve d'usage

---

## Proposition de Valeur — Les 3 Piliers

### 1. Infrastructure pour AI Agents (primaire)
Les agents AI sur Solana n'ont pas de SOL. Ils ont USDC. GASdf résout ça sans friction.
**Pitch :** "Ton agent n'a plus jamais à gérer du SOL."

### 2. Onboarding CEX → DeFi
Users arrivant de Coinbase/Binance avec USDC, zero SOL, bloqués.
**Pitch :** "Utilise Solana dès le premier jour, sans acheter du SOL."

### 3. Burn mécanique $ASDF
Chaque tx GASdf brûle $ASDF. Les holders bénéficient de chaque swap du réseau.
**Pitch :** "La friction du gas devient de la valeur pour les holders."

---

## Tokenomics — Modèle Mathématique Complet

### Variables
```
φ = 1.618033...
C_net = 5,000 lamports  (coût gas réseau par tx)
F_base = 50,000 lamports (fee service = 2.36x C_net, dérivé de φ)
T_rate = 1/φ³ = 23.6%   (taux trésorerie)
B_rate = 1-1/φ³ = 76.4% (taux burn)
CF = 1%                  (creator fee GASdf token, pump.fun max)
V_t = volume journalier trading token GASdf (USD)
N = transactions/jour via service
P_SOL = prix SOL en USD
```

### Flux par transaction (service)
```
User paie F_base en USDC/USDT/$ASDF
    ├── Jupiter swap → SOL → couvre C_net (5,000 lam)
    └── Surplus (45,000 lam)
            ├── 76.4% → swap $ASDF → BRÛLÉ forever
            └── 23.6% → Trésorerie service
```

### Cas spécial $ASDF
```
User paie en $ASDF → 100% BRÛLÉ (zero trésorerie)
```

### Trésorerie service — Règles strictes
```
ENTRÉES  : 23.6% surplus de chaque tx
SORTIES (priorité ordre strict) :
  1. Fee payer SOL balance < 0.5 SOL → refill immédiat
  2. Infrastructure hosting (plafond $15/mois)
  3. Excédent → buy $ASDF → BRÛLÉ

RÈGLE ABSOLUE : trésorerie ne distribue jamais à personne
                elle brûle ou elle survit
```

### Token GASdf — Creator Fees → Gas Gratuit
```
V_t × 1% = creator fees journalières (USD)
    ├── Priorité 1 : couvrir N × C_net × P_SOL/1e9 (gas réseau)
    └── Priorité 2 : excédent → buy $ASDF → BRÛLÉ
```

### Seuil de gas gratuit
```
Condition : V_t × 0.01 ≥ N × 0.000005 × P_SOL

Exemple (P_SOL = $150) :
  N = 1,000 tx/jour → besoin V_t ≥ $75/jour
  N = 10,000 tx/jour → besoin V_t ≥ $750/jour
  Token $50K market cap → volume ~$5K-15K/jour → couvre 6K-20K tx gratuitement
```

### Fee progressive (sliding scale vers zéro)
```
fee_user(t) = max(0, C_net - creator_fees_journalières / N)

Aujourd'hui : fee_user = 50,000 lam
Token lancé : fee_user descend proportionnellement au volume
Seuil atteint : fee_user = 0 → gas gratuit
Excédent : burn $ASDF supplémentaire
```

**Ce graphe est public, live, vérifiable sur le dashboard.**

---

## Distribution Strategy

### Approche : Devenir infrastructure dans la stack

Pas de marketing aux end-users. Intégration dans le stack que les developers utilisent déjà.

```
Developer installe Helius MCP   (60+ tools)
Developer installe DFlow skill  (trading)
Developer installe Dune MCP     (analytics)
→ Developer installe GASdf MCP  ← distribution automatique
```

**Cible primaire :** Developers Helius/DFlow qui buildent des AI agents
**Vecteur :** GASdf MCP server + skill officiel Helius
**Secondaire :** $ASDF cult (raids, advocates, Day 1 token holders)

### Segments
| Segment | Douleur | Accès | Priorité |
|---------|---------|-------|----------|
| AI agents Solana | Agents sans SOL | Helius/DFlow community | **1** |
| $ASDF cult | Alignement total | Direct | **1** |
| CEX→DeFi onboarding | USDC sans SOL | Via dApps partenaires | 2 |
| Mobile apps | Friction gas | Dev outreach | 3 |
| Gaming microtx | Gas > tx value | Discord communautés | 3 |

---

## Relation GASdf ↔ $ASDF

```
$ASDF = root cult token (le "nous")
    └── GASdf = service infrastructure qui brûle $ASDF
            └── GASdf token = mécanisme de bootstrap financier
```

- GASdf **n'est pas en compétition** avec $ASDF — il le sert
- Payer en $ASDF via GASdf = 100% burn (récompense les holders)
- $ASDF holders sont les premiers promoteurs naturels de GASdf
- GASdf token creator fees → fee payer → path to free gas → plus d'adoption → plus de $ASDF brûlé

---

## Narrative Centrale

> **"Le monde brûle du gaz. On brûle le gas blockchain jusqu'à zéro."**

- Connexion au contexte Iran/énergie (fenêtre éphémère)
- Mathématiquement vrai et vérifiable
- Progressive : chaque tx rapproche du gas gratuit
- Émotionnellement chargé : pas un service utilitaire, un acte collectif

**Dashboard public montre :**
- $ASDF brûlés à jamais (total cumulé)
- % vers gas gratuit (progression en temps réel)
- Transactions "libérées" (users qui n'ont pas eu à gérer SOL)

---

## Plan de Lancement — Les 4 Phases

### Phase 0 — Réparer (2-3 semaines, silencieux)
```
□ Migrer infra → Railway ou Fly.io (~$5-10/mois)
□ Supprimer HolDex → whitelist USDC + USDT + $ASDF hardcodé
□ Fix tx size → maxAccounts=15 + onlyDirectRoutes=true
□ Financer fee payer (donation initiale SOL du culte)
□ padre.gg → lier GitHub GASdf au token futur
□ Builder GASdf MCP server (wrapper des endpoints existants)
```

### Phase 1 — Prouver (1-2 semaines, interne)
```
□ Mini trading agent (blueprint existant dans repo) tourne via GASdf
□ Stress test automatique : volume de txs réelles, pas simulées
□ Documenter : X txs, Y $ASDF brûlés, Z SOL économisé
□ Dashboard live "% vers gas gratuit" publiquement visible
□ Corriger les vrais bugs découverts en prod
```

### Phase 2 — Préparer le momentum (1 semaine)
```
□ GASdf token prêt (pas encore lancé)
□ Narrative rédigée, visuels prêts
□ padre.gg visible et actif
□ Stratégie de raid définie avec le culte
□ Outreach discret à 1-2 developers Helius/DFlow community
□ Vérifier : fenêtre Iran/gas encore active ?
```

### Phase 3 — Lancement coordonné
```
Jour 0 : Token GASdf live + service public annoncé
         → Raid cult synchronisé sur X
         → Narrative gas/Iran comme hook d'entrée
         → padre.gg (GitHub = crédibilité)
         → GASdf MCP disponible pour developers

Semaine 1 : Creator fees couvrent une partie du gas
            Dashboard montre la progression
            Outreach AI agents developers (GitHub/X/Helius community)

Semaine 2+ : Chaque intégration amplifiée par le cult
             "X% du gas déjà couvert par le token"
             Demande officielle skill Helius (/helius:gasdf ?)
```

---

## Ce qui N'est PAS dans ce plan

- HolDex : reporté, pas bloquant
- Multi fee-payer network : Phase 2 technique
- ALT (Address Lookup Tables) : Phase 2 technique
- DAO décentralisé fee payer : Phase 3 lointaine
- Intégrations CEX/mobile/gaming : après preuves AI agents

---

## Risques Identifiés

| Risque | Mitigation |
|--------|-----------|
| Fenêtre Iran/gas se ferme | Accélérer Phase 0-1, lancer dans les 4-6 semaines |
| GASdf token sans traction | Service doit fonctionner avant le token |
| Fee payer manque de SOL | Règle trésorerie stricte + alerte < 0.5 SOL |
| Helius refuse l'intégration | Distribution via MCP public reste valide sans eux |
| Bugs en prod Phase 1 | Trading agent = stress test contrôlé avant public |

---

*Document approuvé le 08/03/2026 — Transition vers plan d'implémentation.*
