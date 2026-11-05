# GASdf — Agent Protocol

## What GASdf IS
Execution layer for gasless Solana transactions. B2B2C: sells execution to integrators (B2B), end users never connect directly (B2C).

## What GASdf IS NOT
Not a trading agent, not a scanner, not an oracle, not a wallet, not a subscription billing engine.

## Architecture
- Hexagonal: Domain (pure logic, zero I/O) / Adapters (side effects behind ports) / Facilitator (x402) / Gateway (HTTP)
- DDD: bounded contexts (gasless, subscription, atomic), value objects, domain events
- FCIS: pure logic in domain/, side effects in adapters/

## On-Chain vs Off-Chain
- Off-chain (V1): tx assembly, gas payment, price oracle, auth, fee calculation, treasury, subscription state
- On-chain (existing): token swap (Jupiter), token burn (SPL), token transfer (SPL)
- On-chain (V2): fee verification, treasury multisig (Squads), subscription PDA

## Economic Model
- Flat fee: 50000 lamports base, 2.0x markup, 5000 lamports network fee
- 100% direct burn (no treasury split, no golden ratio)
- Burn threshold: $5.00 (5_000_000 base units for 6-decimal)
- Burn cycle: 60s
- Quote TTL: 60s
- Ingress: gasdf.talaria.build

## Token Basket (V1)
SOL, USDC, USDT, $ASDF (9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump)

## Conventions
- Code/commits: 100% English
- Tests: 3 suites (gasless 19, SDK 70, relay-gateway 38)
- No Docker (CYNIC infra for deployment)
- No src/ (removed, was Phase 0 palimpsest)
- SDK published as gasdf-sdk on npm

## Invariants
- Non-custodial: user signs, server assembles, relayer pays gas
- Atomic: swap + burn in 1 tx
- Rent recovery: ADR-002
- Threshold-aware burn: minimum $5
- Append-only ledger: data/ledger.jsonl

## Relationships
- TrenchScanner (sollama58): intelligence layer, sends curated alerts via webhook
- Trading agent (separate project): consumes TrenchScanner signals, calls GASdf for execution
- CYNIC: orchestration framework (long-term, not in critical path)
