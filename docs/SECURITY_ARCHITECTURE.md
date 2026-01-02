# GASdf Security Architecture

## Design Principle: Isolation-Based Security (Permissionless Compatible)

GASdf provides a **permissionless SDK** - anyone can integrate without permission.
This means we **cannot restrict programs** (would break integrations).

Instead, security is achieved through **ISOLATION**:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SECURITY BY ISOLATION                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. FEE PAYER = SOL ONLY                                        │
│     └─ No token accounts = no token drain possible              │
│                                                                  │
│  2. SIMULATION VALIDATES SOL DELTA                              │
│     └─ Only network fee allowed, any extra = reject             │
│                                                                  │
│  3. ANY PROGRAM ALLOWED                                         │
│     └─ Permissionless = no program restrictions                 │
│                                                                  │
│  4. TREASURY SEPARATE FROM FEE PAYER                            │
│     └─ User fees → Treasury, not fee payer                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Principle: Separation of Concerns

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER TRANSACTION                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │ User Signs  │───▶│ Fee Payment │───▶│ User's Actual TX    │  │
│  │             │    │ to Treasury │    │ (swap, transfer...) │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│         │                  │                                     │
│         │                  ▼                                     │
│         │         ┌─────────────────┐                           │
│         │         │    TREASURY     │ ◀── Receives ALL fees     │
│         │         │  (Token ATAs)   │     (tokens, not SOL)     │
│         │         └─────────────────┘                           │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────┐                                            │
│  │   FEE PAYER     │ ◀── ONLY holds SOL                         │
│  │ (Signs for gas) │     NO token accounts                      │
│  └─────────────────┘     = Cannot be token-drained              │
└─────────────────────────────────────────────────────────────────┘
```

## Core Security Rules

### Rule 1: Fee Payer = SOL Only

```
FEE PAYER WALLET:
  ✓ Holds SOL for network fees
  ✗ NO token accounts (ATAs)
  ✗ NO token balances

WHY: If no tokens exist, token drain attacks are impossible.
```

### Rule 2: Treasury = Separate Address

```
TREASURY WALLET:
  ✓ Receives all fee payments (tokens)
  ✓ Has ATAs for supported tokens
  ✓ Used for swaps and burns
  ✗ NEVER signs user transactions

WHY: Treasury keys can be cold/multisig. User tx never touches it.
```

### Rule 3: Validate by Simulation Balance Delta

```javascript
// CURRENT (gaps)
const solChange = preBalance - postBalance;
if (solChange > maxExpected) reject();

// SECURE (comprehensive)
const allAccounts = await getFeePayer AllAccounts();
for (const account of allAccounts) {
  const preBal = account.balance;
  const postBal = simulatedAccount.balance;
  if (postBal < preBal - expectedFee) {
    reject('Unauthorized balance reduction');
  }
}
```

### Rule 4: Whitelist, Not Blocklist

```javascript
// CURRENT (incomplete)
const BLOCKED_INSTRUCTIONS = [Transfer, Approve, CloseAccount...];

// SECURE (complete)
const ALLOWED_PROGRAMS = [
  '11111111111111111111111111111111',  // System (for user's own transfers)
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',  // SPL Token
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter
  // ... explicit whitelist
];

// Reject ANY instruction to unknown program
for (const ix of transaction.instructions) {
  if (!ALLOWED_PROGRAMS.includes(ix.programId)) {
    reject(`Unknown program: ${ix.programId}`);
  }
}
```

## Attack Vectors & Mitigations

### 1. CPI Token Drain

**Attack**: Hidden CPI transfers fee payer's tokens

**Current Defense**: Instruction blocklist (incomplete for CPI)

**Secure Defense**: Fee payer has NO token accounts

```
If: feePayerTokenAccounts.length === 0
Then: Token drain impossible (nothing to drain)
```

### 2. SOL Drain via System.Transfer

**Attack**: Transaction includes System.Transfer from fee payer

**Defense (Current)**: Instruction blocklist + simulation balance check

**Defense (Enhanced)**:
- Simulation checks delta
- Max expected: network fee only (~5000 lamports)
- Any additional SOL movement = reject

### 3. CloseAccount Redirect

**Attack**: Close fee payer's account, redirect rent to attacker

**Defense (Current)**: CloseAccount in blocklist

**Defense (Enhanced)**: Fee payer has no closeable accounts (no ATAs)

### 4. Signature Replay

**Attack**: Replay same signed transaction

**Defense (Current)**:
- Blockhash expiry (~60s)
- Redis atomic SET NX on tx hash

**Defense Status**: Solid, no changes needed

### 5. Quote Manipulation

**Attack**: Get quote, wait for price change, submit

**Defense (Current)**:
- Quote TTL (60s)
- Quote stored in Redis with exact amounts
- Submit validates against stored quote

**Defense Status**: Solid, no changes needed

### 6. Partial Burn Failure

**Attack**: Burn fails midway, funds stuck

**Current**: Best-effort individual burns

**Secure**: Atomic batch transaction
```javascript
// All burns in single tx
const burnTx = new Transaction();
for (const burn of pendingBurns) {
  burnTx.add(createBurnInstruction(...));
}
// Either ALL succeed or NONE
await sendAndConfirmTransaction(burnTx);
```

## Implementation Checklist

### Phase 1: Wallet Separation (Critical)

- [ ] Create dedicated TREASURY_ADDRESS (new keypair or multisig)
- [ ] Update quote.js: fee payment goes to TREASURY, not FEE_PAYER
- [ ] Update fee-payer-pool.js: fee payer only tracks SOL
- [ ] Close any token accounts on fee payer wallet
- [ ] Update burn.js: operates on TREASURY, not FEE_PAYER

### Phase 2: Validation Hardening

- [ ] Add program whitelist (reject unknown programs)
- [ ] Enhanced simulation: check ALL fee payer accounts (should be just SOL)
- [ ] Add explicit check: fee payer must have 0 token accounts

### Phase 3: Burn Atomicity

- [ ] Refactor batch burn to single atomic transaction
- [ ] Add burn verification routine (periodic check treasury = 0)
- [ ] On-chain burn proof (memo with burn details)

## Configuration

```env
# Fee payer - ONLY for signing transactions
FEE_PAYER_PRIVATE_KEY=<base58-key>

# Treasury - SEPARATE address for receiving fees
# Can be same key for simplicity, but SHOULD be different for security
# Best: Multisig or hardware wallet
TREASURY_ADDRESS=<pubkey>

# If TREASURY_ADDRESS not set, defaults to FEE_PAYER (legacy mode)
# WARNING: Legacy mode has larger attack surface
```

## Security Invariants

These MUST always be true:

1. `feePayer.tokenAccounts.length === 0`
2. `feePayer.balance >= networkFee` (else quote rejected)
3. `treasury.address !== feePayer.address` (recommended)
4. `simulation.feePayerSolDelta <= networkFee`
5. `transaction.programs ⊆ ALLOWED_PROGRAMS`

## Audit Trail

All security events logged:
- `VALIDATION_FAILED`: Transaction rejected at validation
- `SIMULATION_FAILED`: Transaction rejected at simulation
- `CPI_DRAIN_DETECTED`: Suspicious balance change
- `REPLAY_DETECTED`: Duplicate transaction hash
- `BLOCKHASH_EXPIRED`: Stale transaction
- `UNKNOWN_PROGRAM`: Unwhitelisted program in transaction

## References

- Solana Security Best Practices: https://docs.solana.com/security
- SPL Token Security: https://spl.solana.com/token#security-considerations
- Transaction Anatomy: https://docs.solana.com/developing/programming-model/transactions
