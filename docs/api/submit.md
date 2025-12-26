# POST /submit

Submit a signed transaction for gasless execution.

## Endpoint

```
POST https://api.gasdf.io/submit
```

## Request

### Headers

| Header | Value | Required |
|--------|-------|----------|
| `Content-Type` | `application/json` | Yes |
| `x-request-id` | UUID | No |

### Body

```json
{
  "transaction": "AQAAAA...base64...",
  "quoteId": "qt_a1b2c3d4e5f6"
}
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `transaction` | string | Yes | Base64-encoded signed transaction |
| `quoteId` | string | Yes | Quote ID from `/quote` |

## Response

### Success (200)

```json
{
  "success": true,
  "signature": "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp...",
  "slot": 123456789,
  "confirmationStatus": "confirmed"
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether submission succeeded |
| `signature` | string | Transaction signature (base58) |
| `slot` | number | Slot where transaction was confirmed |
| `confirmationStatus` | string | `processed`, `confirmed`, or `finalized` |

### Error Responses

#### 400 Bad Request - Invalid Quote

```json
{
  "error": "Quote not found or expired",
  "code": "QUOTE_NOT_FOUND"
}
```

#### 400 Bad Request - Quote Already Used

```json
{
  "error": "Quote already used",
  "code": "QUOTE_ALREADY_USED"
}
```

#### 400 Bad Request - Invalid Transaction

```json
{
  "error": "Invalid transaction",
  "code": "INVALID_TRANSACTION",
  "details": {
    "reason": "Failed to deserialize transaction"
  }
}
```

#### 400 Bad Request - Wrong Fee Payer

```json
{
  "error": "Transaction fee payer does not match quote",
  "code": "INVALID_FEE_PAYER",
  "details": {
    "expected": "FEEpayer...",
    "actual": "Wrong..."
  }
}
```

#### 400 Bad Request - Missing Fee Transfer

```json
{
  "error": "Missing fee transfer instruction",
  "code": "MISSING_FEE_TRANSFER"
}
```

#### 400 Bad Request - Invalid Fee Amount

```json
{
  "error": "Fee amount does not match quote",
  "code": "INVALID_FEE_AMOUNT",
  "details": {
    "expected": "12000",
    "actual": "10000"
  }
}
```

#### 400 Bad Request - Missing Signature

```json
{
  "error": "Transaction not signed by payer",
  "code": "MISSING_SIGNATURE"
}
```

#### 500 Transaction Failed

```json
{
  "error": "Transaction failed",
  "code": "TRANSACTION_FAILED",
  "details": {
    "signature": "5VERv8...",
    "logs": [
      "Program log: Error: insufficient funds"
    ]
  }
}
```

## Transaction Requirements

Your transaction MUST:

1. **Set fee payer** - `transaction.feePayer = quote.feePayer`
2. **Include fee transfer** - Transfer `quote.feeAmountRaw` of `quote.paymentMint` to `quote.feeCollector`
3. **Be signed by user** - Sign the transaction with your wallet (NOT the fee payer)
4. **Have recent blockhash** - Use a blockhash from the last 150 blocks

## Building the Transaction

```javascript
import { Transaction, PublicKey } from '@solana/web3.js';
import { createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';

// 1. Get quote first
const quote = await fetch('/quote', { ... }).then(r => r.json());

// 2. Build your instructions
const transaction = new Transaction();
transaction.add(yourInstruction);

// 3. Add fee transfer instruction
const payerAta = await getAssociatedTokenAddress(
  new PublicKey(quote.paymentMint),
  wallet.publicKey
);
const collectorAta = await getAssociatedTokenAddress(
  new PublicKey(quote.paymentMint),
  new PublicKey(quote.feeCollector)
);

transaction.add(
  createTransferInstruction(
    payerAta,
    collectorAta,
    wallet.publicKey,
    BigInt(quote.feeAmountRaw)
  )
);

// 4. Set fee payer
transaction.feePayer = new PublicKey(quote.feePayer);

// 5. Set blockhash
const { blockhash } = await connection.getLatestBlockhash();
transaction.recentBlockhash = blockhash;

// 6. Sign (only your wallet, not fee payer)
const signed = await wallet.signTransaction(transaction);

// 7. Serialize and submit
const serialized = signed.serialize({
  requireAllSignatures: false  // Fee payer signs on server
});

const result = await fetch('/submit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    transaction: serialized.toString('base64'),
    quoteId: quote.quoteId
  })
}).then(r => r.json());
```

## Example

### cURL

```bash
curl -X POST https://api.gasdf.io/submit \
  -H "Content-Type: application/json" \
  -d '{
    "transaction": "AQAAAA...base64encodedtx...",
    "quoteId": "qt_a1b2c3d4e5f6"
  }'
```

### JavaScript

```javascript
// After building and signing transaction
const result = await fetch('https://api.gasdf.io/submit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    transaction: signed.serialize({ requireAllSignatures: false }).toString('base64'),
    quoteId: quote.quoteId
  })
});

const { success, signature } = await result.json();

if (success) {
  console.log('Transaction:', `https://solscan.io/tx/${signature}`);
}
```

## GET /submit/status/:txId

Check transaction status.

### Request

```
GET https://api.gasdf.io/submit/status/qt_a1b2c3d4e5f6
```

### Response

```json
{
  "quoteId": "qt_a1b2c3d4e5f6",
  "status": "confirmed",
  "signature": "5VERv8...",
  "attempts": 1,
  "lastError": null,
  "createdAt": 1703548800000
}
```

### Status Values

| Status | Description |
|--------|-------------|
| `pending` | Waiting to be processed |
| `processing` | Currently being submitted |
| `confirmed` | Successfully confirmed |
| `failed` | All retries exhausted |

## Notes

- Transactions are retried up to 3 times on transient failures
- Quote must be used within 60 seconds
- Fee payer signature is added server-side
- The same quote cannot be used twice
