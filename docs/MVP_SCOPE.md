# GASdf MVP production — scope

> Status: operator-decided. CYNIC posture: peer at `usable`, reads proofs only.

## Wants (MVP)

- Pay fees in SOL / USDC / known memecoins without holding them.
- Relay co-signs and submits via Helius Sender; fail-closed routes.
- Quote with TTL; Jupiter API (free tier) for memecoin/SOL prices and swap route.
- Redis/DB allowed from MVP (quotes, ledger, rate limits) — no longer deferred.
- Strict compute-cost measurement, mandatory, both sides:
  - onchain: CU per service execution (Gas-as-a-Service);
  - offchain: CYNIC cloud-compute cost per run (proofs, measures, runs).
- One proof ledger (JSONL append-only) per submission.

## Later (funds-gated)

- Onchain Pinocchio program (payment verification onchain) — only once
  revenue funds audit-grade deployment. Until then validation stays
  offchain + program reverts later.
- Multi fee-payer pool — after first payer saturates.

## Refused at MVP

- Holder tiers (subscription levels by ASDF holdings), K-score/E-score
  gating (anti-sybil token scores), yield/revenue-sharing: monetization
  overengineering.
- Yield returns ONLY when ALL hold: user funds securable serenely
  (audited custody, no inventive risk), PMF proven, service already
  self-sufficient. Before that, every margin funds reserves, never rewards.

## Gates

- MVP ships when: quote TTL live, Jupiter pricing live, submit fail-closed,
  cost ledger (lamports/tx + CU + offchain compute) published per tx,
  circuit breaker armed, mainnet payer funded from revenue only.
