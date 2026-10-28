# ADR-003: Autonomous Solana Subscriptions & Gas-as-a-Service (GaaS)

- **Status:** Proposed
- **Date:** 2026-10-28
- **Author:** zeyxx
- **Scope:** `GASdf` (`gasdf-sdk`, `relay-gateway`, `kora-signer`)

---

## 1. Context & Problem Statement

Subscription payments on Solana suffer from two fatal checkout drop-offs:
1. **The 0-SOL Wall:** Users holding USDC, USDT, or ecosystem tokens run out of native SOL and cannot pay transaction fees.
2. **Multi-Step Signature Friction:** On platforms like TrenchScanner, subscribing requires buying an intermediary token (`$ASDF`) via a DEX dialog, followed by a separate burn panel transaction, requiring 2 on-chain signatures and native SOL for gas.

Furthermore, true "Web2-style" recurring billing (automatic periodic debits without recurring wallet pop-ups) is missing from non-custodial dApp flows on Solana.

---

## 2. Architecture & Delivery Phases

### Phase 1: 1-Click Atomic Subscription (Delivered & In Production)
- **Status:** Active in `gasdf-sdk@2.0.1` and `relay-gateway` (`https://relay.talaria.build/`).
- **Signature Model:** 1 single on-chain signature from the user.
- **Gas Model:** Gas sponsored by Kora Signer (`feePayer`). User pays 0 SOL.
- **Settlement:** Atomic single-transaction execution bundling Jupiter DEX swap, destination payment/burn, and immediate closure of transient ATAs to reclaim rent in SOL (ADR-002).
- **Backend Impact:** Zero changes required on consumer apps (e.g. TrenchScanner). Existing on-chain burn listener (`parseBurnTransaction`) detects the event automatically.

### Phase 2: Autonomous Recurring Billing Engine (V2 Spec)
- **Target:** Recurring monthly billing without recurring user signatures.
- **Mechanism:** SPL Token Delegate Authorization + Scheduled Autonomous Execution.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. INITIAL ENROLLMENT (1-Time Signature)                                    │
│    - User executes SPL Token `approve(delegate = GASdf_PDA, allowance)`     │
│    - GASdf backend records subscription session:                             │
│      { subscriber, merchant, planId, tokenMint, price, interval, nextRun }  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       │ Periodic Tick (every hour / day)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 2. AUTONOMOUS CRON BILLING WORKER                                           │
│    - Checks: `now >= nextRun` AND `allowanceRemaining >= price`             │
│    - Assembles 1-Tx: `transferChecked(from = subscriber, to = merchant)`   │
│      or `swapAndBurn(...)` using the approved allowance                     │
│    - Kora Signer co-signs as feePayer (advances transaction gas)            │
│    - Submits transaction directly to Solana RPC                             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       │ Webhook Notification
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 3. REVENUE SETTLEMENT & EVENT DISPATCH                                      │
│    - Dispatches webhook to merchant (e.g. TrenchScanner `/subscription/renew`) │
│    - Advances `nextRun` by `interval` (e.g. +30 days)                       │
│    - On insufficient funds / revocation: mark status `past_due` & alert     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Autonomous Agentic GaaS Integration

### Niche & Observed Bottlenecks
- Autonomous agents (ElizaOS, Solana Agent Kit / SendAI) managing dozens of ephemeral sub-wallets suffer from "SOL gas fragmentation" and paralysis when SOL runs out while holding liquid SPL tokens.
- MPC custody platforms charge $0.005–$0.01 per signature, breaking micro-transaction economics.

### Solution
- **Agent Sub-Wallet Sponsorship:** Agents sign transactions with 0 SOL capital; gas costs are reimbursed directly out of the transacted SPL payload via atomic swap.
- **Sub-Agent Ephemeral Lifecycle:** Zero rent leakage via ADR-002 automated ATA closures.

---

## 4. Acceptance Criteria & Invariants

1. **Non-Custodial:** GASdf never holds, escrow-freezes, or stores private keys.
2. **Idempotent Billing:** Subscription workers must use deterministic idempotency keys (`sub_id + billing_period_timestamp`) to prevent double-charging under network retries.
3. **Fail-Open Fallback:** If the recurring billing worker or relay is unreachable, consumer apps can immediately fall back to manual 1-Click user-signed payments.
4. **Clean Rent Footprint:** Every transient account created during swap or burn must be closed in the same transaction block (ADR-002).
