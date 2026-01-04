# gasdf-sdk

Gasless transactions for Solana. Pay fees with any token. All fees become **$asdfasdfa** and burn forever.

[![npm](https://img.shields.io/npm/v/gasdf-sdk)](https://www.npmjs.com/package/gasdf-sdk)
[![License](https://img.shields.io/npm/l/gasdf-sdk)](./LICENSE)

## Installation

```bash
npm install gasdf-sdk @solana/web3.js
```

## Quick Start

```typescript
import { GASdf } from 'gasdf-sdk';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';

const gasdf = new GASdf();

// 1. Get a quote (user will pay in USDC)
const quote = await gasdf.getQuote({
  userPubkey: wallet.publicKey,
  paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
});

console.log(`Fee: ${quote.feeFormatted}`); // "0.01 USDC"

// 2. Build your transaction with GASdf as fee payer
const tx = new Transaction({
  feePayer: new PublicKey(quote.feePayer),
  recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
});

// Add your instructions
tx.add(/* your transfer, swap, mint, etc */);

// 3. User signs (they don't need SOL!)
const signed = await wallet.signTransaction(tx);

// 4. Submit through GASdf
const { signature } = await gasdf.submit(signed, quote.quoteId);
console.log(`Success: ${signature}`);
```

## API Reference

### `new GASdf(config?)`

Create a new GASdf client.

```typescript
const gasdf = new GASdf({
  endpoint: 'https://gasdf-43r8.onrender.com', // optional, production endpoint
  timeout: 30000,                               // optional, request timeout in ms
});
```

### `gasdf.getQuote(request)`

Get a fee quote for a gasless transaction.

```typescript
const quote = await gasdf.getQuote({
  userPubkey: 'user-wallet-address',
  paymentToken: 'token-mint-address',
  estimatedComputeUnits: 200000, // optional, for accurate pricing
});

// quote.quoteId       - Use this when submitting
// quote.feePayer      - Set as tx.feePayer
// quote.feeAmount     - Fee in smallest unit (lamports equivalent)
// quote.feeFormatted  - Human readable fee ("0.01 USDC")
// quote.expiresAt     - Quote expiry (unix ms)
```

### `gasdf.submit(transaction, quoteId)`

Submit a signed transaction through GASdf.

```typescript
const { signature, explorerUrl } = await gasdf.submit(signedTx, quote.quoteId);
```

**Requirements:**
- Transaction `feePayer` must match `quote.feePayer`
- Transaction must be signed by the user
- Transaction must NOT be signed by the fee payer (GASdf co-signs)

### `gasdf.wrap(transaction, paymentToken)`

Convenience method: get quote and set fee payer in one call.

```typescript
const { quote, transaction } = await gasdf.wrap(tx, 'USDC_MINT');

// transaction.feePayer is now set to GASdf
const signed = await wallet.signTransaction(transaction);
const result = await gasdf.submit(signed, quote.quoteId);
```

### `gasdf.getTokens()`

Get list of supported payment tokens.

```typescript
const tokens = await gasdf.getTokens();
// [{ mint, symbol, name, decimals, logoURI, kScore, tier }, ...]
```

### `gasdf.health()`

Check API health status.

```typescript
const health = await gasdf.health();
// { status: 'healthy', network: 'mainnet', checks: {...} }
```

## Error Handling

```typescript
import { GASdfError, QuoteExpiredError, ValidationError, RateLimitError } from 'gasdf-sdk';

try {
  await gasdf.submit(signedTx, quoteId);
} catch (error) {
  if (error instanceof QuoteExpiredError) {
    // Get a new quote
    const newQuote = await gasdf.getQuote(/* ... */);
  } else if (error instanceof ValidationError) {
    console.error('Validation failed:', error.errors);
  } else if (error instanceof RateLimitError) {
    // Wait and retry
  } else if (error instanceof GASdfError) {
    console.error(`Error ${error.code}: ${error.message}`);
  }
}
```

## React Hooks

For React apps using `@solana/wallet-adapter-react`:

```bash
npm install gasdf-sdk @solana/wallet-adapter-react
```

### Setup

```tsx
import { GASdfProvider } from 'gasdf-sdk/react';

function App() {
  return (
    <WalletProvider>
      <ConnectionProvider>
        <GASdfProvider>
          <YourApp />
        </GASdfProvider>
      </ConnectionProvider>
    </WalletProvider>
  );
}
```

### useGaslessTransaction

Main hook for executing gasless transactions:

```tsx
import { useGaslessTransaction } from 'gasdf-sdk/react';

function SendButton() {
  const { execute, status, isLoading } = useGaslessTransaction({
    paymentToken: USDC_MINT,
    onSuccess: (result) => console.log('Sent!', result.signature),
    onError: (error) => console.error(error),
  });

  const handleSend = async () => {
    const tx = new Transaction().add(/* your instructions */);
    await execute(tx);
  };

  return (
    <button onClick={handleSend} disabled={isLoading}>
      {status === 'awaiting-signature' ? 'Sign in wallet...' : 'Send'}
    </button>
  );
}
```

**Status values:** `idle` → `getting-quote` → `awaiting-signature` → `submitting` → `confirming` → `success` | `error`

### useQuote

Auto-refreshing fee quotes:

```tsx
import { useQuote } from 'gasdf-sdk/react';

function FeeDisplay() {
  const { quote, isLoading, isValid } = useQuote({
    paymentToken: USDC_MINT,
    autoRefresh: true, // Refreshes before expiry
  });

  if (isLoading) return <Spinner />;
  return <span>Fee: {quote?.feeFormatted}</span>;
}
```

### useTokens

Get supported payment tokens:

```tsx
import { useTokens } from 'gasdf-sdk/react';

function TokenSelect({ onChange }) {
  const { tokens, isLoading } = useTokens();

  return (
    <select onChange={(e) => onChange(e.target.value)}>
      {tokens.map((t) => (
        <option key={t.mint} value={t.mint}>{t.symbol}</option>
      ))}
    </select>
  );
}
```

## Supported Tokens

All tokens verified by [HolDex](https://holdex-api.onrender.com) with K-score >= 50 (Bronze+) are accepted.

| Tier | K-Score | Fee Multiplier |
|------|---------|----------------|
| Diamond | 90-100 | 1.0x (hardcoded: SOL, USDC, USDT, $asdfasdfa) |
| Platinum | 80-89 | 1.0x |
| Gold | 70-79 | 1.0x |
| Silver | 60-69 | 1.1x |
| Bronze | 50-59 | 1.2x |
| Copper | < 50 | **Rejected** |

## Golden Ratio Economics (φ)

All fees become $asdfasdfa:
- **76.4%** burned forever (1 - 1/φ³)
- **23.6%** treasury for operations (1/φ³)

$asdfasdfa holders get discounts based on their share of supply:

| Tier | Share | Discount |
|------|-------|----------|
| Diamond | 1%+ | 95% |
| Platinum | 0.1%+ | 67% |
| Gold | 0.01%+ | 33% |
| Silver/Bronze | < 0.01% | 0% |

## How It Works

1. **Quote**: Your app requests a fee quote
2. **Build**: Transaction is built with GASdf as fee payer
3. **Sign**: User signs (paying token fee, not SOL)
4. **Submit**: GASdf validates, co-signs, and broadcasts
5. **Burn**: Fees are swapped to $asdfasdfa and burned

## Examples

See [`examples/`](./examples/) for complete working examples:

- **[`examples/basic.ts`](./examples/basic.ts)** - Basic TypeScript usage
- **[`examples/react/`](./examples/react/)** - React components and hooks

## License

MIT
