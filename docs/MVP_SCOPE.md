# GASdf MVP production — scope

> Status: operator-decided. CYNIC posture: peer at `usable`, reads proofs only.

## Wants (MVP)

- Pay fees in SOL / USDC / known memecoins without holding them.
- User co-signs the FULL transaction (classic behavior, no offchain
  anonymization): fees travel atomically with the gasless execution.
- Relay co-signs and submits via Helius Sender; fail-closed routes.
- First purpose is dogfooding: gasless/anti-friction for $ASDFASDFA on
  Holdex/TrenchScanner, built by the cult without outside dependencies
  for the first txs.
- $0 infra: Helius free tier only (Developer plan if truly needed).
  Second provider becomes an infra cost only when its utility is proven.
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

## Margin waterfall (every lamport above cost)

1. Hot SOL reserve refill (execution capacity first).
2. Cold USDC reserve (treasury safety).
3. Progressive $ASDFASDFA buyback and burn (deflationary proof of utility).
4. Operator revenue (last, never first).

No yield, no rewards until the yield gate (above) opens. This waterfall
is also the proof of CYNIC's utility: DevOps, measures, proofs, compute —
and distribution across Solana, starting from zero as an individual,
as a member of the $ASDFASDFA community.

## Gates

- MVP ships when: quote TTL live, Jupiter pricing live, submit fail-closed,
  cost ledger (lamports/tx + CU + offchain compute) published per tx,
  circuit breaker armed, mainnet payer funded from revenue only.
