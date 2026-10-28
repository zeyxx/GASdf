# Consumer Integration Guide — GASdf

> Audience: external consumers integrating GASdf into their product.
> Target consumers: `@gcrtrd` (TrenchScanner & CultScreener).
> Production ingress: `https://relay.talaria.build`

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
        │  HTTPS  (https://relay.talaria.build)
        ▼
   GASdf relay-gateway
        │  quote (Jupiter) + session + atomic tx build
        │  Kora fee-payer co-sign
        ▼
   Solana (single atomic transaction)
```

### Invariants consumers can rely on

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

### Plans & targets

| appId          | planId        | target $ASDF | notes                              |
|----------------|---------------|--------------|------------------------------------|
| `trenchscanner`| `pro-monthly` | 30 000       | Pro subscription, monthly          |
| `cultscreener` | `cultify-12h` | 5 000        | Cultify boost, 12h window          |

---

## 2. Quickstart with `gasdf-sdk`

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
  gatewayUrl: 'https://relay.talaria.build',
  timeoutMs: 15000,
});
```

### Supported token symbols

`'USDC' | 'SOL' | 'USDT'` (and any whitelisted mint the gateway accepts).

---

## 3. Real code example — live quote + sponsored submission

```ts
import { GasdfClient } from 'gasdf-sdk';

const GATEWAY = 'https://relay.talaria.build';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function subscribe(walletAddress: string, signer: { signTransaction: (tx: any) => Promise<any> }) {
  const client = new GasdfClient({ gatewayUrl: GATEWAY, timeoutMs: 15000 });

  // 1. Health check (optional but recommended for deploy pinning)
  const health = await fetch(`${GATEWAY}/health`).then((r) => r.json());
  console.log('relay health:', health);

  // 2. Live quote — the third arg selects the consumer appId
  const quote = await client.getLiveQuote('USDC', 'pro-monthly', 'trenchscanner');
  console.log('QUOTE:', quote);

  // Validate the quote before asking the user to sign
  if (quote.status !== 'valid') throw new Error(`quote not valid: ${quote.status}`);
  if (!Number.isFinite(quote.priceImpactPct) || quote.priceImpactPct >= 5) {
    throw new Error(`price impact too high: ${quote.priceImpactPct}`);
  }
  if (quote.ttlSeconds <= 0) throw new Error('quote expired');
  if (quote.inputMint !== USDC_MINT) throw new Error('unexpected input mint');
  if (quote.targetAsdfFormatted !== 30000) throw new Error('unexpected target');

  // 3. 1-click sponsored submission (session + prepare + sign + relay)
  const receipt = await client.executeOneClickSubscription({
    appId: 'trenchscanner',          // 'trenchscanner' | 'cultscreener'
    planId: 'pro-monthly',
    buyerPubkey: walletAddress,
    inputToken: 'USDC',
    signer,
    onStage: (stage) => console.log('stage:', stage), // preparing | signing | relaying
  });

  console.log('TX SIGNATURE:', receipt.txSignature);
  return receipt;
}
```

### CultScreener variant

```ts
const quote = await client.getLiveQuote('USDC', 'cultify-12h', 'cultscreener');
const receipt = await client.executeOneClickSubscription({
  appId: 'cultscreener',
  planId: 'cultify-12h',
  buyerPubkey: walletAddress,
  inputToken: 'USDC',
  signer,
});
```

### Step-by-step (manual) pipeline

For consumers that prefer to drive each step:

```ts
const session = await client.createSession('trenchscanner', 'pro-monthly', walletAddress);
const prepared = await client.prepareAtomicSubscription(session.sessionId, 'USDC');
const signed = await signer.signTransaction(/* decode prepared.base64Tx */);
const receipt = await client.submitAtomicSubscription(session.sessionId, signed);
```

---

## 4. Specific parameters for `@gcrtrd`

- `appId`: `'trenchscanner'` (Pro subscription) or `'cultscreener'` (Cultify).
- `planId`: `'pro-monthly'` (30 000 $ASDF) or `'cultify-12h'` (5 000 $ASDF).
- `inputToken`: `'USDC' | 'SOL' | 'USDT'`.
- `buyerPubkey`: the end user's Solana wallet (base58).
- Quote TTL: 45s. Refresh the quote every ~40s to avoid expiry.
- No SOL required from the end user for network fees (relay sponsors them).

### Security invariants

1. **Non-invasive**: the claim endpoint (`/subscription/claim`) works unchanged
   because the on-chain event is a standard `BurnChecked` whose
   `tokenAccountOwner` is the user's wallet.
2. **No rent drain**: the user's $ASDF ATA is never closed, avoiding
   `NonZeroBalance` failures.
3. **Atomicity**: swap + burn succeed or revert together. Zero fund loss.

---

## 5. Verification

A runnable consumer verification script lives at
`examples/consumer-trenchscanner.mjs`. It hits the production ingress and
validates every field of the live quote:

```bash
node examples/consumer-trenchscanner.mjs
```

---

## 6. References

- `docs/INTEGRATION_TRENCHSCANNER.md` — React component example & invariants.
- `docs/PROPOSAL_TRENCHSCANNER.md` — original proposal to @gcrtrd.
- `sdk/` — `@gasdf/sdk` source (subscription client).
- `packages/sdk/` — `gasdf-sdk` source (gasless tx client).
EOF
echo written