# GASdf React Examples

Ready-to-use React components for gasless transactions.

## Setup

```bash
npm install gasdf-sdk @solana/web3.js @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets
```

## Examples

### 1. App Setup (`App.tsx`)

Wrap your app with the required providers:

```tsx
import { App } from './App';

ReactDOM.render(
  <App>
    <YourApp />
  </App>,
  document.getElementById('root')
);
```

### 2. Send Button (`SendButton.tsx`)

A gasless send button with status feedback:

```tsx
<SendButton recipient="..." amount={0.1} />
```

### 3. Token Selector (`TokenSelector.tsx`)

Dropdown to select payment token:

```tsx
<TokenSelector value={token} onChange={setToken} />
```

### 4. Fee Display (`FeeDisplay.tsx`)

Auto-refreshing fee quote display:

```tsx
<FeeDisplay paymentToken={USDC_MINT} />
<FeeDisplayDetailed paymentToken={USDC_MINT} />
```

### 5. Complete Swap Page (`SwapPage.tsx`)

Full page combining all components:

```tsx
<SwapPage />
```

## Hooks Reference

### `useGaslessTransaction`

Execute gasless transactions:

```tsx
const { execute, status, isLoading } = useGaslessTransaction({
  paymentToken: USDC_MINT,
  onSuccess: (result) => console.log(result.signature),
  onError: (error) => console.error(error),
});
```

**Status values:**
- `idle` - Ready to execute
- `getting-quote` - Fetching fee quote
- `awaiting-signature` - Waiting for wallet signature
- `submitting` - Sending to GASdf
- `confirming` - Waiting for confirmation
- `success` - Transaction confirmed
- `error` - Transaction failed

### `useQuote`

Get auto-refreshing fee quotes:

```tsx
const { quote, isLoading, isValid, refresh } = useQuote({
  paymentToken: USDC_MINT,
  autoRefresh: true,
  refreshBuffer: 10, // seconds before expiry
});
```

### `useTokens`

Get supported payment tokens:

```tsx
const { tokens, isLoading } = useTokens();
```

### `useGASdf`

Access the GASdf client directly:

```tsx
const { client } = useGASdf();
const stats = await client.stats();
```
