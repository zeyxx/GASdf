# GASdf v2 Product Roadmap

## Vision
Autonomous, self-sustaining gasless relay and subscription gateway on Solana.
No reliance on outside capital: fees sustain the network runner, profits drive $ASDFASDFA buyback and burn.

---

## Phase 1: Core Foundation & Strict Token Basket (Current)
Target: Absolute stability, zero-leak economic safety, proven profitability.

- [x] **Kora Signer Integration**: Bare Rust binary + systemd running 24/7 on Proxmox LXC 107.
- [x] **Relay Gateway**: TypeScript ESM gateway with x402 payment facilitator (`exact` & `upto` schemes).
- [x] **Domain Logic Port**: Pure DDD vocabulary for gasless & subscriptions with zero-I/O decisions.
- [x] **Subscription API**: Endpoints `/subscription/plans`, `/tokens`, `/sessions`, `/quote`, `/settle`.
- [x] **Append-Only Ledger**: Full accounting of every micro-fee and subscription settlement in `data/ledger.jsonl`.
- [x] **Threshold-Aware Batch Burn**: Burn evaluator preventing fee dissipation (minimum $5 threshold).
- [x] **Automated Test Suite**: 19/19 native tests passing (gasless, subscriptions, calibration).
- [x] **Strict Token Basket**: Restricted strictly to high-liquidity assets:
  - SOL (native)
  - USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)
  - USDT (`Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`)
  - $ASDFASDFA (`9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump`)
- [ ] **Automated SOL Refill Loop**: Auto-replenish Kora signer when balance drops below 0.5 SOL SAFU threshold.
- [ ] **External Integration Spec for @gcrtrd**: Concrete client SDK / snippet for TrenchScanner Pay-per-scan.

---

## Phase 2: Dynamic Community Expansion (HolDex / CultScreener)
Target: Open payment support to the wider Solana memecoin ecosystem once Phase 1 is proven viable.

- [ ] **CultScreener Adapter**: Periodic ingestion of verified tokens via `https://github.com/sollama58/CultScreener` (`GET /api/tokens`).
- [ ] **Conviction Gating**: Auto-accept tokens meeting conviction threshold and liquidity minimums.
- [ ] **Dynamic Slippage Guard**: Real-time Jupiter route evaluation per token.
- [ ] **Onchain Program Gate (Pinocchio)**: Move payment validation onchain when treasury revenues justify audit cost.
