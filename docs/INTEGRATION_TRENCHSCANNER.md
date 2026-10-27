# Guide d'Intégration GASdf pour TrenchScanner (1-Click Pro Subscription)

Ce document décrit comment remplacer le flow complexe actuel (achat manuel d'$ASDF + confirmation séparée de burn) par le bouton **1-Click Subscription** alimenté par GASdf.

---

## 1. Ce que résout cette intégration

### Avant (Actuel)
1. L'utilisateur doit ouvrir `BuyAsdfDialog`.
2. Il achète des $ASDF avec du SOL (création d'ATA, slippage manuel).
3. Il ferme la boîte de dialogue, se rend sur `BurnPanel`.
4. Il signe une 2ème transaction pour brûler les 30 000 $ASDF.
5. Friction maximale : 2 signatures, du SOL obligatoire pour les frais.

### Après (Avec GASdf SDK)
1. Un seul clic : **"S'abonner avec USDC / SOL / USDT"**.
2. **0 SOL de gas requis** : Le gas est sponsorisé par le Relayer Kora (`feePayer`).
3. **Atomique Onchain** : Le swap Jupiter vers $ASDF et le `burnChecked` des 30 000 jetons sont regroupés dans le **même bloc Solana**.
4. **Zéro modification backend nécessaire sur TrenchScanner** : Le `parseBurnTransaction` existant de TrenchScanner détecte automatiquement le burn crédité au propriétaire du compte token (`owner`).

---

## 2. Installation du SDK

Dans le projet `apps/web` :
```bash
npm install @gasdf/sdk
```

---

## 3. Utilisation dans un Composant React (ex: `BurnPanel.tsx` ou modal dédiée)

```tsx
import React, { useState, useEffect } from 'react';
import { GasdfClient, type LiveQuote, type SupportedTokenSymbol } from '@gasdf/sdk';

const gasdf = new GasdfClient({
  gatewayUrl: 'https://relay.gasdf.org', // ou IP LXC 107 en staging
});

export function GasdfSubscriptionButton({
  walletAddress,
  walletSigner, // standard wallet signer: { signTransaction }
  onSuccess,
}: {
  walletAddress: string;
  walletSigner: any;
  onSuccess: (signature: string) => void;
}) {
  const [token, setToken] = useState<SupportedTokenSymbol>('USDC');
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<'idle' | 'preparing' | 'signing' | 'relaying'>('idle');

  // 1. Rafraîchissement automatique du devis avec respect du TTL (45s)
  useEffect(() => {
    let active = true;

    async function fetchQuote() {
      try {
        const q = await gasdf.getLiveQuote(token, 'pro-monthly');
        if (active) setQuote(q);
      } catch (err) {
        console.error('Erreur devis GASdf:', err);
      }
    }

    fetchQuote();
    const interval = setInterval(fetchQuote, 40_000); // refresh avant expiration 45s
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [token]);

  // 2. Déclenchement de la souscription atomique 1-Click
  async function handleSubscribe() {
    try {
      setLoading(true);
      const receipt = await gasdf.executeOneClickSubscription({
        appId: 'trenchscanner',
        planId: 'pro-monthly',
        buyerPubkey: walletAddress,
        inputToken: token,
        signer: walletSigner,
        onStage: (s) => setStage(s),
      });

      onSuccess(receipt.txSignature);
    } catch (err: any) {
      alert(`Échec de la transaction: ${err.message}`);
    } finally {
      setLoading(false);
      setStage('idle');
    }
  }

  return (
    <div className=\"gasdf-pay-container p-4 rounded-xl border border-zinc-800 bg-zinc-900/50\">
      <div className=\"flex justify-between items-center mb-4\">
        <span className=\"text-sm text-zinc-400\">Payer avec :</span>
        <select
          value={token}
          onChange={(e) => setToken(e.target.value as SupportedTokenSymbol)}
          className=\"bg-zinc-800 text-white rounded px-2 py-1 text-sm border border-zinc-700\"
        >
          <option value=\"USDC\">USDC</option>
          <option value=\"SOL\">SOL</option>
          <option value=\"USDT\">USDT</option>
        </select>
      </div>

      {quote && (
        <div className=\"text-sm mb-4\">
          <div className=\"text-zinc-300 font-semibold\">
            Prix : ~{quote.inputAmountFormatted.toFixed(3)} {quote.inputSymbol}
          </div>
          <div className=\"text-xs text-zinc-500 mt-1\">
            Brûle automatiquement 30 000 $ASDF • Frais de réseau 100% sponsorisés
          </div>
        </div>
      )}

      <button
        onClick={handleSubscribe}
        disabled={loading || !quote}
        className=\"w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2\"
      >
        {loading ? (
          <span>
            {stage === 'preparing' && 'Calcul de la route...'}
            {stage === 'signing' && 'Confirmation wallet requise...'}
            {stage === 'relaying' && 'Diffusion sur Solana...'}
          </span>
        ) : (
          <span>S'abonner 1-Click Pro (30j)</span>
        )}
      </button>
    </div>
  );
}
```

---

## 4. Invariants de Sécurité

1. **Non-Invasif pour TrenchScanner** :
   Le claim TrenchScanner `/subscription/claim` fonctionne à l'identique car l'événement onchain émis est un `BurnChecked` de 30 000 $ASDF dont le `tokenAccountOwner` est le wallet de l'utilisateur.
2. **Protection contre le Drain de Rent** :
   Le compte ATA $ASDF de l'utilisateur n'est jamais détruit, évitant tout échec de type `NonZeroBalance`.
3. **Zéro Risque de Teneur de Marché** :
   La transaction est atomique : soit les deux étapes (Swap + Burn) réussissent, soit la transaction est annulée en totalité. Zéro perte de fonds possible.
