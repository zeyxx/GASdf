# Guide d'Intégration GASdf pour Holdex / CultScreener

Ce document décrit comment éliminer le drop-off des utilisateurs sur les fonctionnalités payantes **Cultify** (5 000 $ASDF) et **Holder Behavior** (10 000 $ASDF) grâce au SDK `@gasdf/sdk`.

---

## 1. Problème Actuel dans Holdex (`frontend/js/cultify.js`)

Actuellement, lorsqu'un utilisateur veut analyser les holders d'un token :
1. Holdex vérifie si le wallet possède déjà un compte ATA $ASDF avec au moins 5 000 (ou 10 000) tokens.
2. Si le solde est insuffisant ou si l'ATA n'existe pas : **L'utilisateur est bloqué** avec le message *"You don't hold any ASDFASDFA tokens. Buy some first."*.
3. L'utilisateur doit quitter Holdex, aller sur un DEX, acheter des $ASDF, payer du SOL natif pour les frais de transaction, puis revenir signer deux fois.

---

## 2. Solution 1-Click GASdf

Grâce à GASdf :
1. L'utilisateur peut débloquer l'analyse instantanément en payant avec **USDC**, **USDT** ou **SOL natif**.
2. **0 SOL de gas requis** : Les frais Solana sont sponsorisés par le relayer Kora de GASdf.
3. **Transaction Atomique** : Le swap vers $ASDF et le `burnChecked` sont combinés dans la même transaction.
4. **Zéro modification requise sur le Backend de Holdex** :
   Le backend de Holdex (`backend/src/routes/cultify.js` -> `verifyBurnTransaction`) inspecte directement la transaction confirmée onchain sur Solana. Il valide automatiquement le burn car l'autorité du compte token reste le wallet de l'utilisateur !

---

## 3. Plans Configurés pour Holdex

| App ID | Plan ID | Montant Brûlé | Durée d'Accès |
| :--- | :--- | :--- | :--- |
| `cultscreener` | `cultify-12h` | 5 000 $ASDF (~0,75 $) | 12 heures |
| `cultscreener` | `holder-behavior-12h` | 10 000 $ASDF (~1,50 $) | 12 heures |

---

## 4. Exemple d'Intégration Frontend (`frontend/js/cultify.js`)

Dans le modal du Burn Gate de Holdex :

```javascript
import { GasdfClient } from '@gasdf/sdk';

const gasdf = new GasdfClient({
  gatewayUrl: 'https://relay.gasdf.org', // ou IP de staging
});

async function unlockWithGasdf(mintAddress, selectedToken = 'USDC') {
  const statusEl = document.getElementById('cultify-burn-btn');
  statusEl.textContent = 'Préparation de la transaction...';

  // 1. Exécution 1-Click (Session -> Route Jupiter -> Signature Wallet -> Relais Kora)
  const receipt = await gasdf.executeOneClickSubscription({
    appId: 'cultscreener',
    planId: 'cultify-12h', // ou 'holder-behavior-12h'
    buyerPubkey: wallet.address,
    inputToken: selectedToken,
    signer: wallet.provider, // standard wallet signer
    onStage: (stage) => {
      if (stage === 'signing') statusEl.textContent = 'Confirmez dans votre wallet...';
      if (stage === 'relaying') statusEl.textContent = 'Validation sur Solana...';
    },
  });

  // 2. Appel direct du endpoint de vérification existant de Holdex
  statusEl.textContent = 'Vérification du burn...';
  const claimSig = await signBurnClaim(receipt.txSignature, mintAddress, wallet.address);

  const verifyResp = await fetch('/api/cultify/verify-burn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signature: receipt.txSignature,
      mint: mintAddress,
      wallet: wallet.address,
      claimSignature: claimSig,
    }),
  });

  if (verifyResp.ok) {
    statusEl.textContent = 'Accès Débloqué !';
    await loadAnalysis(mintAddress, false);
  }
}
```

---

## 5. Invariants et Sécurité

1. **Aucun Revert SPL** : L'ATA $ASDF créée lors du swap est préservée intacte (pas d'instruction `closeAccount`), éliminant tout risque d'erreur `NonZeroBalance`.
2. **Protection Anti-Replay** : Le backend Holdex enregistre la signature de transaction avec une contrainte `UNIQUE` dans la table des burns vérifiés.
