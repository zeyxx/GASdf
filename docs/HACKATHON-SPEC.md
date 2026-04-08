# GASdf — Colosseum Frontier Hackathon Spec

**Optimistic Epistemic Oracle for Solana**
AI governance where independent validators reach consensus under mathematical doubt.

## Context

- **Hackathon**: Colosseum Frontier, April 6 — May 11, 2026 (5 weeks, online)
- **Track**: Artificial Intelligence
- **Prize**: Track prizes ($2,500–$25,000 USDC) + $250K pre-seed accelerator
- **Team**: Solo (T.)
- **Submission**: 2 videos (pitch 3min + tech demo 2-3min) + GitHub repo

## What We Have (already working)

| Component | Status | Location |
|---|---|---|
| CYNIC kernel | Production, months old. 5 Dogs, 6 axioms, φ-bounded consensus, crystal learning | `cynic-kernel/` |
| Pinocchio programme | Deployed devnet. 5 instructions. 24.4KB .so | `programs/cynic-governance/` |
| Agent bridge | E2E proven. 3 verdicts on-chain | `bridge/` |
| Devnet community | `8Pyd1hqd6jTX2jR8YvCAjnd3cyP5qB7XaxzwAGtHCSFD` | devnet |
| Program ID | `A4QK3jj2kDx6w3da7FF3wxiBMnD2NrDsL1F7RCJA5NXx` | devnet |
| Helius API key | Configured for devnet | `~/.helius/config.json` |
| Persistent browser | GitHub session saved | Playwright MCP |

## Judging Criteria (6, equal weight)

1. **Functionality** — Does it work? Code quality?
2. **Potential Impact** — TAM, Solana ecosystem impact?
3. **Novelty** — Unique concept?
4. **UX** — Utilizes Solana performance for great UX?
5. **Open-source** — Composable with Solana ecosystem?
6. **Business Plan** — Viable business?

---

## Deliverables

### D1. Deliberation Page (P0) — ~25h

**The product IS the experience of watching AI consensus form.**

One page. Not a dashboard. Deep and polished.

Sections:
1. **Proposal input** — text box + submit. Calls CYNIC `/judge` via bridge
2. **Dog deliberation** — Dogs appear ONE BY ONE as they finish (progressive arrival via polling `/judge/status/{id}`). Each Dog shows: model name, latency, 6 axiom scores as visual bars, reasoning excerpt
3. **Consensus formation** — geometric mean converges in real-time. Verdict (HOWL/WAG/GROWL/BARK) forms. Anomaly detection highlighted when Dogs disagree
4. **On-chain settlement** — verdict submitted to Solana. Tx signature + link to Solana Explorer. PDA created, data readable
5. **Community state** — shows current community: mint, threshold, total verdicts, pause state. Past verdicts list with scores

**Tech stack**: Vite + React + TypeScript. Imports from `@gasdf/governance` SDK. Reads on-chain data via Helius RPC. Calls bridge API for submissions.

**Design principles**:
- Dark theme, minimal, data-dense
- Axiom scores as horizontal bars (color-coded by HOWL/WAG/GROWL/BARK thresholds)
- Dog arrival creates visual "drip" effect — each Dog card animates in
- Disagreement between Dogs highlighted in red (anomaly axiom)
- No routing, no navigation, no settings page. ONE page.

### D2. execute_action — Threshold Change (P0) — ~10h

Complete the programme lifecycle:

```
propose → judge → verdict on-chain → timelock → execute → state changes
```

Implement execute_action for ONE action type: **community threshold change**. Internal to our programme, no external CPI.

- Test E2E on devnet: submit verdict → wait timelock → call execute_action → verify threshold changed
- Add to bridge: `node bridge/agent-bridge.js execute <verdict-pda>`
- Show in UI: "Execute" button appears after timelock, triggers state change

### D3. `@gasdf/governance` SDK (P1) — ~5h

Extract `bridge/governance.js` into a publishable npm package:

```
@gasdf/governance
├── src/
│   ├── instructions.ts    # createInitializeCommunityIx, createSubmitVerdictIx, createExecuteActionIx
│   ├── pda.ts             # findCommunityPDA, findVerdictPDA
│   ├── state.ts           # deserializeCommunity, deserializeVerdict
│   ├── types.ts           # Community, Verdict, VerdictType, AxiomScores
│   └── index.ts           # re-exports
├── package.json
├── tsconfig.json
└── README.md
```

- TypeScript with full types
- Zero dependencies beyond `@solana/web3.js`
- Web UI imports from this package (dogfooding)
- Published to npm before submission

### D4. `/judge/status/{id}` Kernel Endpoint (P1) — ~4h

New CYNIC kernel endpoint returning partial results as Dogs complete:

```
GET /judge/status/{verdict_id}
→ { status: "pending"|"partial"|"complete", dogs_completed: 3, dogs_total: 5, partial_scores: [...] }
```

- Returns dog_scores[] as they arrive
- Frontend polls every 2s
- Dogs appear progressively: gemini-flash (2s) → qwen-7b (4s) → qwen-gpu (6s) → gemma-cpu (15s) → deterministic (instant)
- Creates narrative tension in the demo

### D5. Pitch Video (P1) — ~15h

**3 minutes MAX. Startup pitch, NOT product demo.**

Structure:
1. **Hook** (15s): "98.6% of pump.fun tokens are rugs. 40,000 new tokens per day. Zero governance."
2. **Problem** (30s): DAOs failed — 98% voter apathy. MetaDAO too complex. Jupiter CLOSED its DAO. Memecoins have NO governance at all.
3. **Solution** (45s): Optimistic epistemic oracle. 5 independent AI validators deliberate under mathematical doubt. Verdicts settle on Solana. Humans contest during timelock. "Optimistic governance — assume the AI is right, prove it wrong."
4. **Demo clip** (30s): Quick montage from the deliberation page. Dogs arriving, scores diverging, verdict forming, on-chain tx.
5. **Business model** (20s): $GASDF token pays for Dog inferences. Protection funnel → governance upgrade. Self-hostable.
6. **Market** (15s): TAM — every Solana token without governance (99%+). Starting with pump.fun communities.
7. **Team + ask** (15s): Background, why us, what's next.

**Tool**: Loom or OBS. No slides — talk over the product.

### D6. Technical Demo Video (P1) — ~10h

**2-3 minutes. The "how", not the "why".**

Structure:
1. **Architecture** (30s): Pinocchio programme (Rust, zero-copy) → CYNIC kernel (5 Dogs, 6 axioms) → Agent bridge → Deliberation page
2. **Live walkthrough** (90s): Submit a real proposal on devnet. Show Dogs arriving. Show axiom breakdown. Show on-chain PDA. Show execute_action changing threshold.
3. **Code highlights** (30s): Programme instruction layout (match byte discriminator). Consensus algorithm (geometric mean, φ-bounded). SDK usage.
4. **Why Solana** (15s): Sub-second finality = real-time governance settlement. Pinocchio = 95% less CU than Anchor. Composable with token programme.

### D7. Twitter/X Build-in-Public (P2) — ~1h/day

Not code. Pure leverage.

- Week 1: "Building an AI governance system for Solana memecoins" + architecture diagram
- Week 2: "5 AI models just deliberated on a token proposal" + screenshot of Dog scores diverging
- Week 3: "Live on devnet" + tx link + deliberation page screenshot
- Week 4: "Here's what happens when the AIs disagree" + anomaly detection screenshot
- Week 5: Submission thread + demo video clip

### D8. Crystal Badge (P2) — ~3h

In the deliberation page, show:
```
Informed by 12 past verdicts (3 crystallized patterns)
```

Don't explain the math. Show that the system LEARNS. Judges who read the code will discover the crystal pipeline. Everyone else just sees "it gets smarter."

### D9. Real Community Test (P3) — ~8h, week 4 only

IF timeline allows: find a small Solana community (Discord/Telegram) and run 3 governance proposals through the system. Screenshot the results. Include in pitch as "user feedback."

**High risk. Do not invest before D1-D6 are frozen.**

---

## Timeline

```
         March 30          April 6          April 13         April 20         April 27         May 4            May 11
         |--- Pre-hack ----|---- Week 1 ----|---- Week 2 ----|---- Week 3 ----|---- Week 4 ----|---- Week 5 ----|
         |                 |                |                |                |                |                |
Code:    |  D2 execute     |  D3 SDK        |  D1 page       |  D1 page       |  FEATURE       |                |
         |  D4 /status     |  D1 page       |  D1 polish     |  D8 crystal    |  FREEZE        |                |
         |                 |  scaffold       |                |  badge         |                |                |
         |                 |                |                |                |                |                |
Video:   |                 |                |                |  draft pitch   |  D5 pitch      |  D6 tech demo  |
         |                 |                |                |  script        |  record+edit   |  record+edit   |
         |                 |                |                |                |                |                |
Social:  |                 |  D7 first      |  D7 devnet     |  D7 demo       |  D7 preview    |  D7 submit     |
         |                 |  tweet         |  tx links      |  screenshots   |  teaser        |  thread         |
         |                 |                |                |                |                |                |
Test:    |                 |                |  devnet E2E    |  full flow     |  D9 community? |  final verify  |
         |                 |                |  hardening     |  test          |  (if ready)    |                |
```

### Milestones

| Date | Milestone | Gate |
|---|---|---|
| April 5 | D2 + D4 done. execute_action + /status endpoint working | Can demo full lifecycle |
| April 13 | D3 SDK published. D1 page scaffolded, proposal submission works | Functional web app |
| April 20 | D1 page complete. Progressive Dog arrival, on-chain verification | Demo-ready product |
| April 27 | FEATURE FREEZE. D8 crystal badge. Pitch script draft. | Nothing new after this |
| May 4 | D5 pitch video final. D6 tech demo recorded. | Videos ready |
| May 11 | Final submission. | Ship |

### Decision Points

| When | Decision | If yes | If no |
|---|---|---|---|
| April 20 | Is D1 page polished enough for video? | Start pitch script | Continue polishing, defer video |
| April 27 | Is there time for D9 (real community)? | Attempt week 4-5 | Skip, focus on videos |
| May 4 | Are both videos done? | Polish + submit early | Crunch to finish |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│             Deliberation Page               │
│         (Vite + React + TypeScript)         │
│                                             │
│  ┌─────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ Propose │ │ Dogs     │ │ On-chain    │  │
│  │ input   │ │ arriving │ │ settlement  │  │
│  └────┬────┘ └────▲─────┘ └──────▲──────┘  │
│       │           │              │          │
└───────┼───────────┼──────────────┼──────────┘
        │           │              │
        ▼           │              │
┌──────────────┐    │         ┌────┴──────────┐
│ Agent Bridge │    │         │ Helius RPC    │
│  (Node.js)   │    │         │ (read chain)  │
│              │    │         └───────────────┘
│ /submit      │    │
│ /status      │────┘ (polls /judge/status)
│ /execute     │
└──────┬───────┘
       │
       ▼
┌──────────────┐        ┌─────────────────────┐
│ CYNIC Kernel │───────▶│ Solana Devnet        │
│ (Rust)       │  tx    │                      │
│              │        │ cynic-governance     │
│ 5 Dogs       │        │ programme            │
│ 6 Axioms     │        │ (Pinocchio, 24.4KB)  │
│ φ-bounded    │        │                      │
└──────────────┘        └─────────────────────┘
```

## Hostile Expert Objections (must answer in pitch)

1. **"That's autocracy with extra steps"** → No. Optimistic governance: AI proposes, humans contest during timelock. Like optimistic rollups but for governance.

2. **"Zero users"** → 98.6% of tokens have zero governance. The demand is implicit in the carnage. We start with protection (anti-rug), upgrade to governance.

3. **"Why not just use a DAO?"** → 98% voter apathy. Jupiter closed its DAO. MetaDAO is too complex for retail. We flip the model: AI active, humans reactive.

4. **"5 AI models is expensive"** → $GASDF token pays for inference. Self-hostable: community runs its own Dogs. Deterministic-dog is free (heuristic circuit breaker).

## What Is NOT in Scope

- Telegram/Discord bot (Phase 1)
- Token creation / SPL integration (Phase 1)
- Multi-community management UI (Phase 1)
- execute_action CPI — burn/transfer (Phase 1)
- P2P crystal replication (Phase 2)
- $GASDF token economics (Phase 3)
- Crystal pipeline visualization (too complex to explain in 3 min)
- Full SSE streaming (polling is sufficient)
- Mobile responsive (demo is desktop)

## Success Criteria

1. Live devnet demo: propose → 5 Dogs deliberate → verdict on-chain → execute → state changes
2. Two videos submitted, each under time limit
3. SDK published on npm
4. At least 5 tweets with engagement during hackathon
5. GitHub repo clean, documented, public with clear README

---

*Crystallized 2026-03-30. Design frozen. Code now.*
