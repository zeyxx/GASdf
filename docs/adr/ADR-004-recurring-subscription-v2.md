# ADR-004: Recurring Subscription via Token Delegation (V2)

## Status
Proposed

## Context

V1 subscriptions are session-based: one-time payment per session (open → quoted → pending → settled/expired). Each renewal requires a new user signature. This creates friction for recurring billing (monthly/weekly subscriptions).

The "gamechanger" is true recurring billing: user does a 1-time token delegation upfront, then renewals happen automatically without monthly pop-ups.

## Decision

### Mechanism: SPL Token Delegation

1. **Delegation**: User approves GASdf (or a program) to spend up to `maxAmount` of $ASDF per `period` (e.g., 30 days). This is a standard SPL `Approve` instruction — revocable anytime by the user.

2. **Subscription PDA (on-chain state)**:
   - `subscriber`: user pubkey
   - `plan`: plan ID
   - `amount`: $ASDF per period
   - `period`: seconds (e.g., 2592000 for 30 days)
   - `nextRenewal`: timestamp of next renewal
   - `status`: active | expired | revoked
   - `delegationAmount`: max delegated amount
   - `renewalCount`: number of successful renewals

3. **Renewal trigger**: A keeper/cron job checks all active PDAs. If `now >= nextRenewal`, it triggers:
   - Transfer `amount` $ASDF from user's ATA to treasury (via delegated authority)
   - Burn `amount` $ASDF (100% direct burn)
   - Update PDA: `nextRenewal += period`, `renewalCount += 1`

4. **Revocation**: User calls `Revoke` on the SPL delegation. PDA status → revoked. No further renewals.

5. **Expiry**: If delegation is revoked or insufficient balance, PDA status → expired. User must re-delegate.

### V1 vs V2

| Aspect | V1 (Current) | V2 (This ADR) |
|---|---|---|
| Payment | One-time per session | Recurring via delegation |
| User signature | Every renewal | Once (delegation) |
| State | Off-chain (SQLite) | On-chain (PDA) |
| Renewal trigger | User-initiated | Keeper/cron |
| Revocation | N/A (session expires) | User calls Revoke |
| Trust | Server-side | On-chain verifiable |

### What Stays Off-Chain (V2)

- Keeper/cron job (triggers renewal, but the tx is on-chain)
- Ledger accounting (append-only JSONL)
- Plan definitions (off-chain registry, referenced by plan ID)

### What Goes On-Chain (V2)

- Subscription PDA (state)
- SPL token delegation (spend authority)
- Renewal transaction (transfer + burn)
- Revocation (user-initiated)

## Consequences

### Positive
- True recurring billing without monthly pop-ups
- User retains control (revocable delegation)
- On-chain verifiable (B2B trust)
- No monthly signature friction

### Negative
- Requires on-chain program (Pinocchio or Anchor)
- Keeper/cron infrastructure needed
- Delegation amount must be sufficient (user must maintain $ASDF balance)
- More complex error handling (insufficient balance, revoked delegation)

### Risks
- User delegates too much → mitigated by `maxAmount` cap
- Keeper goes down → mitigated by multiple keepers or user-initiated renewal
- Delegation expires → SPL delegation doesn't expire, but user can revoke

## Implementation Plan

1. **Phase 1**: On-chain program (subscription PDA + delegation verification)
2. **Phase 2**: Keeper/cron for automated renewal
3. **Phase 3**: SDK integration (delegation flow in `gasdf-sdk`)
4. **Phase 4**: Revocation UI + user controls

## Related
- ADR-002: SVM Rent Recovery (atomic tx bundling)
- ADR-003: Autonomous Subscriptions (V1 session-based)
- PRD.md Section 5 (V2 scope)
