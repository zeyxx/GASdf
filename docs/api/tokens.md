# GET /tokens

Get list of supported payment tokens.

## Endpoint

```
GET https://gasdf-43r8.onrender.com/v1/tokens
```

## Response

### Success (200)

```json
{
  "tokens": [
    {
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "symbol": "USDC",
      "name": "USD Coin",
      "decimals": 6,
      "logoUri": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
      "kScore": "TRUSTED",
      "feeMultiplier": 1.0
    },
    {
      "mint": "So11111111111111111111111111111111111111112",
      "symbol": "SOL",
      "name": "Wrapped SOL",
      "decimals": 9,
      "logoUri": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
      "kScore": "TRUSTED",
      "feeMultiplier": 1.0
    },
    {
      "mint": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      "symbol": "BONK",
      "name": "Bonk",
      "decimals": 5,
      "logoUri": "https://arweave.net/hQiPZOsRZXGXBJd_82PHVHd6aYVIgvfnEXSPL5K9B0k",
      "kScore": "STANDARD",
      "feeMultiplier": 1.2
    }
  ]
}
```

### Token Fields

| Field | Type | Description |
|-------|------|-------------|
| `mint` | string | Token mint address (base58) |
| `symbol` | string | Token symbol |
| `name` | string | Token name |
| `decimals` | number | Token decimal places |
| `logoUri` | string | Token logo URL (optional) |
| `kScore` | string | Token trust score |
| `feeMultiplier` | number | Fee multiplier for this token |

## K-Score Levels

K-Score indicates the token's trust level, affecting the fee multiplier:

| K-Score | Multiplier | Description |
|---------|------------|-------------|
| `TRUSTED` | 1.0x | Major tokens with high liquidity (USDC, SOL, USDT) |
| `STANDARD` | 1.2x | Verified tokens with good liquidity |
| `RISKY` | 1.5x | Lower liquidity or newer tokens |
| `UNKNOWN` | 2.0x | Unverified tokens (highest risk) |

## Example

### cURL

```bash
curl https://gasdf-43r8.onrender.com/v1/tokens
```

### JavaScript

```javascript
const response = await fetch('https://gasdf-43r8.onrender.com/v1/tokens');
const { tokens } = await response.json();

// Filter trusted tokens
const trusted = tokens.filter(t => t.kScore === 'TRUSTED');
console.log('Trusted tokens:', trusted.map(t => t.symbol));
// ['USDC', 'SOL', 'USDT']

// Build token selector
tokens.forEach(token => {
  console.log(`${token.symbol}: ${token.feeMultiplier}x fee`);
});
```

## Common Tokens

### Mainnet

| Symbol | Mint | K-Score |
|--------|------|---------|
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | TRUSTED |
| SOL | `So11111111111111111111111111111111111111112` | TRUSTED |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | TRUSTED |
| BONK | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` | STANDARD |
| JUP | `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN` | STANDARD |

### Devnet

On devnet, use SPL token test mints or create your own for testing.

## Notes

- Token list is updated periodically based on liquidity and usage
- New tokens may start as UNKNOWN and get upgraded based on trading history
- Tokens can be delisted if liquidity drops below threshold
- Use `TRUSTED` tokens for lowest fees
