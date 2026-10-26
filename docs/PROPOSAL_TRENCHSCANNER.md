# Proposal: GASdf × TrenchScanner — frictionless subscriptions

> To @GCRtrd. No change required on TrenchScanner. Proof-backed, devnet first.

## Friction (your code, read at pin `cffd91c2`)

Subscription = onchain burn of 55,200 $ASDFASDFA/month (`parseBurn`,
no memo). Two blockers for newcomers: holding an unknown ticker, and
holding SOL for fees. Your reconciler stays untouched.

## Flow A — pay in anything (monetary bridge)

1. User pays SOL / USDC / whitelisted memecoin to GASdf (quote TTL 60s).
2. GASdf swaps to 55,200 ASDF via Jupiter and sends them to the user.
3. Relay co-signs the user's burn (Flow B below) — one user signature total.
4. Your `burnReconciler` sees a standard user burn and credits months.

## Flow B — pure gasless (already proven)

User holds ASDF but no SOL: GASdf co-signs + submits the burn via
Helius. 7 devnet txs finalized, proofs in ledger. Works standalone today.

## Ask

- Nothing on your code. Awareness + tolerance for GASdf-sourced burns.
- Later, if volume follows: co-marketing, allowlist sync (HolDex list),
  optional rev-share on relayed subscriptions — your call, your terms.

## Proofs attached on request

Devnet signatures, cost ledger (lamports + CU per relay), flat-fee
formula. Contact: Titouan (zeyxx), $ASDFASDFA community member.
