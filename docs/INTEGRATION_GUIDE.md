# GASdf Consumer Integration Guide

> Canonical integration reference for external consumers of GASdf.
> Supersedes `docs/CONSUMER_INTEGRATION.md`, `docs/INTEGRATION_TRENCHSCANNER.md`,
> and `docs/INTEGRATION_HOLDEX.md` (retained for historical context, marked
> superseded).
>
> Audience: external consumers integrating GASdf into their product.
> Target consumers: `@gcrtrd` (TrenchScanner & CultScreener).
> Production ingress: `https://gasdf.talaria.build`

---

## 1. Architecture & Role of GASdf

GASdf is a **gasless fee-payer and swap sponsor** sitting in front of Solana.
It lets an end user complete an on-chain action (e.g. a subscription burn) by
paying in a token they already hold (USDC, SOL, USDT, …) while GASdf:

1. **Quotes** the exact input amount required to reach the target $ASDF amount,
   with a bounded price impact and a short TTL.
2. **Builds** an atomic versioned transaction: Jupiter swap → $ASDF → burn
   (or any sponsored action), with the relay as `feePayer`.
3. **Co-signs** and broadcasts via the Kora relay so the user pays **zero SOL
   for network fees**.

```
Consumer (TrenchScanner / CultScreener)
        │
        │  HTTPS  (https://gasdf.talaria.build)
        ▼
   GASdf relay-gateway
        │  quote (Jupiter) + session + atomic tx build
        │  Kora fee-payer co-sign
        ▼
   Solana (single atomic transaction)
```

### Common invariants consumers can rely on

- **Atomicity**: swap + sponsored action succeed or revert together. No partial
  state, no lost funds.
- **Gasless**: the relay's fee payer covers all network fees. End users need no
  SOL balance.
- **Non-invasive**: the on-chain event emitted is a standard `BurnChecked` (or
  the sponsored action's standard instruction) whose `tokenAccountOwner` is the
  user's wallet. Existing reconcilers keep working unchanged.
- **Deterministic quote**: `getLiveQuote(token, planId, appId)` returns a
  `LiveQuote` with `status`, `priceImpactPct`, `ttlSeconds`, `validUntil`,
  `quotedAt`, `inputMint`, `inputAmountFormatted`, `targetAsdfFormatted`.
- **No rent drain**: the user's $ASDF ATA is never closed, avoiding
  `NonZeroBalance` failures.

---

## 2. Plans & targets

| appId          | planId               | target $ASDF | duration   | notes                              |
|----------------|----------------------|--------------|------------|------------------------------------|
| `trenchscanner`| `pro-monthly`        | 30 000       | 30 days    | Pro subscription, monthly          |
| `cultscreener` | `cultify-12h`        | 5 000        | 12 hours   | Cultify boost, 12h window          |
| `cultscreener` | `holder-behavior-12h`| 10 000       | 12 hours   | Holder Behavior analysis, 12h      |

Quote TTL: 60s. Refresh the quote every ~50s to avoid expiry.

---

## 3. Quickstart with `gasdf-sdk`

### Install

```bash
# npm registry (when published)
npm install gasdf-sdk

# or directly from the repo (subpath #sdk)
npm install github:zeyxx/GASdf#sdk
```

### Construct a client

```ts
import { GasdfClient } from 'gasdf-sdk';

const client = new GasdfClient({
  gatewayUrl: 'https://gasdf.talaria.build',
  timeoutMs: 15000,
});
```

### Supported token symbols

`'USDC' | 'SOL' | 'USDT'` (and any whitelisted mint the gateway accepts).

---

## 4. Common flow — live quote + sponsored submission

### 4.1 Live quote validation (recommended before signing)

```ts
const quote = await client.getLiveQuote('USDC', 'pro-monthly', 'trenchscanner');
if (quote.status !== 'valid') throw new Error(`quote not valid: ${quote.status}`);
if (!Number.isFinite(quote.priceImpactPct) || quote.priceImpactPct >= 5) {
  throw new Error(`price impact too high: ${quote.priceImpactPct}`);
}
if (quote.ttlSeconds <= 0) throw new Error('quote expired');
```

### 4.2 One-click sponsored submission

```ts
const receipt = await client.executeOneClickSubscription({
  appId: 'trenchscanner',          // 'trenchscanner' | 'cultscreener'
  planId: 'pro-monthly',          // see plans table
  buyerPubkey: walletAddress,
  inputToken: 'USDC',             // 'USDC' | 'SOL' | 'USDT'
  signer,
  onStage: (stage) => console.log('stage:', stage), // preparing | signing | relaying
});
console.log('TX SIGNATURE:', receipt.txSignature);
```

### 4.3 Manual step-by-step pipeline

For consumers that prefer to drive each step:

```ts
const session = await client.createSession('trenchscanner', 'pro-monthly', walletAddress);
const prepared = await client.prepareAtomicSubscription(session.sessionId, 'USDC');
const signed = await signer.signTransaction(/* decode prepared.base64Tx */);
const receipt = await client.submitAtomicSubscription(session.sessionId, signed);
```

### 4.4 CultScreener variant (5k / 10k $ASDF)

```ts
// Cultify 12h (5 000 $ASDF)
const quote = await client.getLiveQuote('USDC', 'cultify-12h', 'cultscreener');
const receipt = await client.executeOneClickSubscription({
  appId: 'cultscreener',
  planId: 'cultify-12h',
  buyerPubkey: walletAddress,
  inputToken: 'USDC',
  signer,
});

// Holder Behavior 12h (10 000 $ASDF)
const receipt2 = await client.executeOneClickSubscription({
  appId: 'cultscreener',
  planId: 'holder-behavior-12h',
  buyerPubkey: walletAddress,
  inputToken: 'USDC',
  signer,
});
```

---

## 5. Variant-specific integration

### 5.1 TrenchScanner (React) — 1-Click Pro subscription (30 000 $ASDF / 30 days)

Replaces the manual flow (buy $ASDF + separate burn confirmation) with a single
button. No backend change required on TrenchScanner: `parseBurnTransaction`
detects the burn credited to the token account owner automatically.

```tsx
import React, { useState, useEffect } from 'react';
import { GasdfClient, type LiveQuote, type SupportedTokenSymbol } from '@gasdf/sdk';

const gasdf = new GasdfClient({ gatewayUrl: 'https://gasdf.talaria.build' });

export function GasdfSubscriptionButton({
  walletAddress,
  walletSigner,
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

  // Refresh quote before the 60s TTL expires
  useEffect(() => {
    let active = true;
    async function fetchQuote() {
      try {
        const q = await gasdf.getLiveQuote(token, 'pro-monthly');
        if (active) setQuote(q);
      } catch (err) {
        console.error('GASdf quote error:', err);
      }
    }
    fetchQuote();
    const interval = setInterval(fetchQuote, 40_000);
    return () => { active = false; clearInterval(interval); };
  }, [token]);

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
      alert(`Transaction failed: ${err.message}`);
    } finally {
      setLoading(false);
      setStage('idle');
    }
  }

  return (
    <div className="gasdf-pay-container p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-zinc-400">Pay with:</span>
        <select
          value={token}
          onChange={(e) => setToken(e.target.value as SupportedTokenSymbol)}
          className="bg-zinc-800 text-white rounded px-2 py-1 text-sm border border-zinc-700"
        >
          <option value="USDC">USDC</option>
          <option value="SOL">SOL</option>
          <option value="USDT">USDT</option>
        </select>
      </div>

      {quote && (
        <div className="text-sm mb-4">
          <div className="text-zinc-300 font-semibold">
            Price: ~{quote.inputAmountFormatted.toFixed(3)} {quote.inputSymbol}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            Auto-burns 30 000 $ASDF • 100% sponsored network fees
          </div>
        </div>
      )}

      <button
        onClick={handleSubscribe}
        disabled={loading || !quote}
        className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <span>
            {stage === 'preparing' && 'Computing route...'}
            {stage === 'signing' && 'Wallet confirmation required...'}
            {stage === 'relaying' && 'Broadcasting on Solana...'}
          </span>
        ) : (
          <span>Subscribe 1-Click Pro (30d)</span>
        )}
      </button>
    </div>
  );
}
```

### 5.2 Holdex / CultScreener (vanilla JS) — 5k / 10k $ASDF unlocks

Eliminates user drop-off on paid features (Cultify 5 000 $ASDF, Holder
Behavior 10 000 $ASDF). No backend change required: Holdex's
`verifyBurnTransaction` inspects the confirmed on-chain transaction directly
and validates the burn because the token account authority remains the user's
wallet.

```javascript
import { GasdfClient } from '@gasdf/sdk';

const gasdf = new GasdfClient({
  gatewayUrl: 'https://gasdf.talaria.build',
});

async function unlockWithGasdf(mintAddress, selectedToken = 'USDC', planId = 'cultify-12h') {
  const statusEl = document.getElementById('cultify-burn-btn');
  statusEl.textContent = 'Preparing transaction...';

  // 1. One-click execution (session -> Jupiter route -> wallet sign -> Kora relay)
  const receipt = await gasdf.executeOneClickSubscription({
    appId: 'cultscreener',
    planId, // 'cultify-12h' (5 000) or 'holder-behavior-12h' (10 000)
    buyerPubkey: wallet.address,
    inputToken: selectedToken,
    signer: wallet.provider,
    onStage: (stage) => {
      if (stage === 'signing') statusEl.textContent = 'Confirm in your wallet...';
      if (stage === 'relaying') statusEl.textContent = 'Validating on Solana...';
    },
  });

  // 2. Call Holdex's existing verification endpoint
  statusEl.textContent = 'Verifying burn...';
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
    statusEl.textContent = 'Access unlocked!';
    await loadAnalysis(mintAddress, false);
  }
}
```

---

## 6. Security invariants (common)

1. **Non-invasive claim endpoint**: `/subscription/claim` works unchanged
   because the on-chain event is a standard `BurnChecked` whose
   `tokenAccountOwner` is the user's wallet.
2. **No rent drain**: the user's $ASDF ATA is never closed, avoiding
   `NonZeroBalance` failures.
3. **Atomicity**: swap + burn succeed or revert together. Zero fund loss.
4. **Anti-replay (Holdex)**: the Holdex backend records the transaction
   signature with a `UNIQUE` constraint in the verified-burns table.

---

## 7. Specific parameters for `@gcrtrd`

- `appId`: `'trenchscanner'` (Pro subscription) or `'cultscreener'` (Cultify).
- `planId`: `'pro-monthly'` (30 000 $ASDF), `'cultify-12h'` (5 000 $ASDF),
  or `'holder-behavior-12h'` (10 000 $ASDF).
- `inputToken`: `'USDC' | 'SOL' | 'USDT'`.
- `buyerPubkey`: the end user's Solana wallet (base58).
- Quote TTL: 60s. Refresh the quote every ~50s to avoid expiry.
- No SOL required from the end user for network fees (relay sponsors them).

---

## 8. Verification

A runnable consumer verification script lives at
`examples/consumer-trenchscanner.mjs`. It hits the production ingress and
validates every field of the live quote:

```bash
node examples/consumer-trenchscanner.mjs
```

---

## 9. References

- `docs/CONSUMER_INTEGRATION.md` — superseded; retained for history.
- `docs/INTEGRATION_TRENCHSCANNER.md` — superseded; retained for history.
- `docs/INTEGRATION_HOLDEX.md` — superseded; retained for history.
- `docs/PROPOSAL_TRENCHSCANNER.md` — original proposal to @gcrtrd.
- `sdk/` — `@gasdf/sdk` source (subscription client).
- `packages/sdk/` — `gasdf-sdk` source (gasless tx client).
- `contracts/subscription-reference/fixtures/plans.json` — plan reference.
EOF
echo written