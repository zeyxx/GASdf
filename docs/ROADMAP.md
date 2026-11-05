# GASdf Product Roadmap

## Vision
Autonomous, self-sustaining gasless relay and subscription gateway on Solana.
No reliance on outside capital: fees sustain the network runner, profits drive $ASDF buyback and burn.

---

## Phase 1: Core Foundation & Strict Token Basket (Current)
Target: Absolute stability, zero-leak economic safety, proven profitability.

- [x] Kora Signer Integration: Bare Rust binary + systemd running 24/7 on Proxmox LXC 107.
- [x] Relay Gateway: TypeScript ESM gateway with x402 payment facilitator (`exact` & `upto` schemes).
- [x] Domain Logic Port: Pure DDD vocabulary for gasless & subscriptions with zero-I/O decisions.
- [x] Subscription API: Endpoints `/subscription/plans`, `/tokens`, `/sessions`, `/quote`, `/settle`.
- [x] Append-Only Ledger: Full accounting of every micro-fee and subscription settlement.
- [x] Threshold-Aware Batch Burn: Burn evaluator preventing fee dissipation (minimum $5 threshold).
- [x] Automated Test Suite: 3 suites (gasless 19/19, SDK 70/70, relay-gateway 38/38).
- [x] Strict Token Basket: SOL, USDC, USDT, $ASDF.
- [ ] Automated SOL Refill Loop: Auto-replenish Kora signer when balance drops below 0.5 SOL SAFU threshold.
- [ ] External Integration Spec for @gcrtrd: Concrete client SDK / snippet for TrenchScanner.

---

## Phase 2: Dynamic Community Expansion (HolDex / CultScreener)
Target: Open payment support to the wider Solana memecoin ecosystem once Phase 1 is proven viable.

- [ ] CultScreener Adapter: Periodic ingestion of verified tokens via `GET /api/tokens`.
- [ ] Dynamic Slippage Guard: Real-time Jupiter route evaluation per token.
- [ ] Onchain Program Gate (Pinocchio): Move payment validation onchain when treasury revenues justify audit cost.

---

## Phase 3: Trading Agent Integration (B2B2C)
Target: Enable automated trading agents to use GASdf for gasless execution.

- [ ] Webhook contract definition (alert card JSON format, HMAC, retry)
- [ ] Webhook receiver in trading agent (not GASdf)
- [ ] GASdf end-to-end test (devnet, sign + relay with real wallet)
- [ ] Trading agent scaffold (structure, deps, config)
- [ ] Reuse evaluation of GCR's heuristics (packages/core/src/curation/)
- [ ] Stats API consumption (bearer token, calibration loop)
- [ ] Integration with TrenchScanner execution flow (useWallet().signTransaction)

---

## Phase 4: Subscription & On-chain Program (V2)
Target: Recurring billing and on-chain trust for B2B scaling.

- [ ] Squads multisig for treasury (B2B trust)
- [ ] On-chain fee verification program (B2B trust, "provably fair")
- [ ] Subscription PDA (recurring billing on-chain)
- [ ] Token delegation (1-time upfront, no monthly pop-ups)
- [ ] Renewal logic (cron/keeper/user-triggered)
- [ ] Revocation (user can revoke delegation anytime)

---

## Phase 5: Scaling & SEO/GEO
Target: Public trust, discoverability, ecosystem growth.

- [ ] Public documentation (API reference, integration guide)
- [ ] SEO-optimized landing page
- [ ] On-chain program audit (if V2 deployed)
- [ ] Ecosystem integrations (more dApps beyond TrenchScanner)
