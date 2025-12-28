# GASdf Integration Guide

> For gcrtrd - Integration into HolDex / ASDev / ASDForecast

## TL;DR

```javascript
// 3 lines for a gasless transaction
const quote = await gasdf.quote(paymentToken, userWallet);
const tx = buildTransaction(quote.feePayer, instructions);
const result = await gasdf.submit(quote.quoteId, signedTx);
```

**Result:** User pays with any token, 80% burns $ASDF.

---

## Installation

```bash
# Option 1: NPM (quand publié)
npm install @gasdf/sdk

# Option 2: Copier directement
cp /path/to/GASdf/sdk/index.js ./lib/gasdf.js
```

---

## Quick Start

### 1. Initialiser le SDK

```javascript
const { GASdf } = require('@gasdf/sdk');
// ou: const { GASdf } = require('./lib/gasdf');

const gasdf = new GASdf({
  baseUrl: 'http://localhost:3000',  // Dev
  // baseUrl: 'https://api.gasdf.io', // Prod
  timeout: 30000,
});
```

### 2. Flow Complet

```javascript
import { Connection, Transaction, PublicKey } from '@solana/web3.js';

async function executeGaslessTransaction(
  userWallet,      // Wallet adapter ou Keypair
  paymentToken,    // Token mint pour payer (USDC, SOL, n'importe quoi)
  instructions     // Tes instructions
) {
  // ═══════════════════════════════════════════════════════════════════
  // STEP 1: Get Quote
  // ═══════════════════════════════════════════════════════════════════
  const quote = await gasdf.quote(paymentToken, userWallet.publicKey.toBase58());

  console.log(`Fee: ${quote.feeFormatted}`);           // "0.0001 USDC"
  console.log(`Expires in: ${quote.ttl}s`);            // 60
  console.log(`Fee payer: ${quote.feePayer}`);         // GASdf's wallet
  console.log(`K-Score: ${quote.kScore.tier}`);        // TRUSTED/STANDARD/RISKY

  // ═══════════════════════════════════════════════════════════════════
  // STEP 2: Build Transaction with GASdf Fee Payer
  // ═══════════════════════════════════════════════════════════════════
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const { blockhash } = await connection.getLatestBlockhash();

  const transaction = new Transaction({
    feePayer: new PublicKey(quote.feePayer),  // GASdf pays!
    recentBlockhash: blockhash,
  });

  // Add your instructions
  for (const ix of instructions) {
    transaction.add(ix);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 3: User Signs (fee payer signature added by GASdf)
  // ═══════════════════════════════════════════════════════════════════

  // With wallet adapter:
  const signed = await userWallet.signTransaction(transaction);

  // Or with Keypair:
  // transaction.partialSign(userKeypair);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 4: Submit to GASdf
  // ═══════════════════════════════════════════════════════════════════
  const serialized = signed.serialize({
    requireAllSignatures: false  // Fee payer signs on submit
  });

  const result = await gasdf.submit(
    quote.quoteId,
    serialized.toString('base64'),
    userWallet.publicKey.toBase58()
  );

  console.log(`Success! Signature: ${result.signature}`);
  console.log(`Explorer: ${result.explorer}`);

  return result;
}
```

---

## Integration by App

### HolDex - Gasless Token Swaps

```javascript
// In your swap handler
async function handleSwap(tokenIn, tokenOut, amount, userWallet) {
  // 1. Build swap instructions (Jupiter, Raydium, etc.)
  const swapIxs = await buildSwapInstructions(tokenIn, tokenOut, amount);

  // 2. Execute gasless
  const result = await executeGaslessTransaction(
    userWallet,
    tokenIn,     // User pays fee with the token they're swapping FROM
    swapIxs
  );

  // 3. Show confirmation
  showToast(`Swap confirmed! ${result.signature}`);
}
```

### ASDev - Gasless Token Launch

```javascript
// In your launch handler
async function handleTokenLaunch(tokenParams, userWallet) {
  // 1. Build launch instructions
  const launchIxs = await buildLaunchInstructions(tokenParams);

  // 2. User can pay launch fee with any token they have
  const paymentToken = await selectPaymentToken(userWallet);

  // 3. Execute gasless
  const result = await executeGaslessTransaction(
    userWallet,
    paymentToken,
    launchIxs
  );

  return result;
}
```

### ASDForecast - Gasless Predictions

```javascript
// In your bet handler
async function handlePlaceBet(marketId, outcome, amount, userWallet) {
  // 1. Build bet instruction
  const betIx = await buildBetInstruction(marketId, outcome, amount);

  // 2. Execute gasless - user pays with their betting token
  const result = await executeGaslessTransaction(
    userWallet,
    USDC_MINT,  // or the market's token
    [betIx]
  );

  return result;
}
```

---

## API Reference

### `gasdf.quote(paymentToken, userPubkey, options?)`

Get a fee quote.

```javascript
const quote = await gasdf.quote(
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC
  'UserWallet111111111111111111111111111111111'
);
```

**Response:**
```javascript
{
  quoteId: "550e8400-e29b-41d4-a716-446655440000",
  feePayer: "GASdfFeePayer11111111111111111111111111111",
  feeAmount: "100000",           // in token smallest units
  feeFormatted: "0.1 USDC",
  paymentToken: {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    decimals: 6
  },
  kScore: {
    score: 95,
    tier: "TRUSTED",            // TRUSTED | STANDARD | RISKY | UNKNOWN
    feeMultiplier: 1.0          // Higher for risky tokens
  },
  expiresAt: 1703123456789,
  ttl: 60                        // seconds
}
```

### `gasdf.submit(quoteId, transaction, userPubkey)`

Submit signed transaction.

```javascript
const result = await gasdf.submit(
  quote.quoteId,
  serializedTx.toString('base64'),
  userWallet.publicKey.toBase58()
);
```

**Response:**
```javascript
{
  signature: "5UfDuX...",
  status: "submitted",
  attempts: 1,
  explorer: "https://solscan.io/tx/5UfDuX..."
}
```

### `gasdf.tokens()`

List supported payment tokens.

```javascript
const tokens = await gasdf.tokens();
// [{ mint, symbol, decimals, kScore, feeMultiplier }, ...]
```

### `gasdf.stats()`

Get burn statistics.

```javascript
const stats = await gasdf.stats();
// { totalBurned, burnedFormatted, txCount, treasury: { model, burnRatio } }
```

### `gasdf.burnProofs(limit?)`

Get verifiable burn proofs.

```javascript
const proofs = await gasdf.burnProofs(10);
// { burns: [{ signature, amount, method, explorerUrl }], totalBurns }
```

---

## Error Handling

```javascript
import { GASdfError } from '@gasdf/sdk';

try {
  const quote = await gasdf.quote(token, wallet);
} catch (error) {
  if (error instanceof GASdfError) {
    switch (error.code) {
      case 'CIRCUIT_BREAKER_OPEN':
        // Service temporarily unavailable
        showToast('Service busy, retry in ' + error.retryAfter + 's');
        break;
      case 'NO_PAYER_CAPACITY':
        // All fee payers exhausted
        showToast('High demand, please retry');
        break;
      case 'QUOTE_EXPIRED':
        // Quote TTL exceeded
        // Get new quote
        break;
      case 'REPLAY_DETECTED':
        // Transaction already submitted
        break;
      default:
        showToast(error.message);
    }
  }
}
```

---

## React Hook Example

```javascript
// hooks/useGaslessTransaction.js
import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { GASdf, GASdfError } from '@gasdf/sdk';

const gasdf = new GASdf({ baseUrl: process.env.NEXT_PUBLIC_GASDF_URL });

export function useGaslessTransaction() {
  const { publicKey, signTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = useCallback(async (paymentToken, instructions) => {
    if (!publicKey || !signTransaction) {
      throw new Error('Wallet not connected');
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Get quote
      const quote = await gasdf.quote(paymentToken, publicKey.toBase58());

      // 2. Build transaction
      const tx = new Transaction({
        feePayer: new PublicKey(quote.feePayer),
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      });
      instructions.forEach(ix => tx.add(ix));

      // 3. Sign
      const signed = await signTransaction(tx);

      // 4. Submit
      const result = await gasdf.submit(
        quote.quoteId,
        signed.serialize({ requireAllSignatures: false }).toString('base64'),
        publicKey.toBase58()
      );

      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [publicKey, signTransaction]);

  return { execute, loading, error };
}

// Usage in component:
function SwapButton() {
  const { execute, loading } = useGaslessTransaction();

  const handleSwap = async () => {
    const result = await execute(USDC_MINT, [swapInstruction]);
    toast.success(`Swapped! ${result.signature}`);
  };

  return (
    <button onClick={handleSwap} disabled={loading}>
      {loading ? 'Processing...' : 'Swap (Gasless)'}
    </button>
  );
}
```

---

## UI Components

### Fee Display

```jsx
function GaslessFeeDisplay({ quote }) {
  return (
    <div className="fee-display">
      <span className="label">Network Fee:</span>
      <span className="amount">{quote.feeFormatted}</span>
      <span className="badge">{quote.kScore.tier}</span>
      <span className="burn-info">80% burns $ASDF</span>
    </div>
  );
}
```

### Burn Counter Widget

```jsx
function BurnCounter() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    gasdf.stats().then(setStats);
    const interval = setInterval(() => gasdf.stats().then(setStats), 30000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return <Spinner />;

  return (
    <div className="burn-counter">
      <span className="label">Total $ASDF Burned:</span>
      <span className="amount">{stats.burnedFormatted}</span>
    </div>
  );
}
```

---

## Configuration

### Environment Variables

```bash
# .env.local
NEXT_PUBLIC_GASDF_URL=http://localhost:3000   # Dev
# NEXT_PUBLIC_GASDF_URL=https://api.gasdf.io  # Prod
```

### Supported Tokens

Par défaut, tous les tokens sont supportés. Le K-Score détermine le fee multiplier:

| Tier | K-Score | Fee Multiplier | Examples |
|------|---------|----------------|----------|
| TRUSTED | 80-100 | 1.0x | SOL, USDC, USDT |
| STANDARD | 50-79 | 1.2x | Most tokens |
| RISKY | 20-49 | 1.5x | New/low liquidity |
| UNKNOWN | 0-19 | 2.0x | Unverified tokens |

---

## Testing

```bash
# Local GASdf server
cd /path/to/GASdf
NODE_ENV=development npm run dev

# Test endpoints
curl http://localhost:3000/health
curl http://localhost:3000/v1/tokens
```

---

## Questions?

Ping @zeyxx on X or open an issue on the repo.

---

## Complete Flow (Visual)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   User      │     │  Your App   │     │   GASdf     │
│  (Wallet)   │     │  (HolDex)   │     │   Service   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │   Click Swap      │                   │
       │──────────────────>│                   │
       │                   │                   │
       │                   │   POST /quote     │
       │                   │──────────────────>│
       │                   │                   │
       │                   │   { quoteId,      │
       │                   │     feePayer,     │
       │                   │     feeAmount }   │
       │                   │<──────────────────│
       │                   │                   │
       │   Sign TX         │                   │
       │   (feePayer =     │                   │
       │    GASdf wallet)  │                   │
       │<──────────────────│                   │
       │                   │                   │
       │   Signed TX       │                   │
       │──────────────────>│                   │
       │                   │                   │
       │                   │   POST /submit    │
       │                   │──────────────────>│
       │                   │                   │
       │                   │                   │  Signs as fee payer
       │                   │                   │  Sends to Solana
       │                   │                   │  80% → burn $ASDF
       │                   │                   │
       │                   │   { signature }   │
       │                   │<──────────────────│
       │                   │                   │
       │   Success!        │                   │
       │<──────────────────│                   │
       │                   │                   │
```
