#!/usr/bin/env node
/**
 * CYNIC → Solana Agent Bridge
 *
 * Connects the CYNIC kernel (/judge) to the cynic-governance on-chain program.
 * Flow: proposal text → /judge → verdict → submit_verdict tx → on-chain PDA
 *
 * Usage:
 *   node bridge/agent-bridge.js judge "Should we burn 5% of treasury?"
 *   node bridge/agent-bridge.js init   (initialize community for $ASDF)
 *   node bridge/agent-bridge.js read   (read community state)
 */

import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { readFileSync } from "fs";

import {
  createInitializeCommunityIx,
  createSubmitVerdictIx,
  createExecuteThresholdChangeIx,
  findCommunityPDA,
  findVerdictPDA,
  deserializeCommunity,
  deserializeVerdict,
} from "./governance.js";

// --- Config ---

const RPC_URL = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
const CYNIC_URL_RAW = process.env.CYNIC_REST_ADDR || "http://localhost:3030";
const CYNIC_URL = CYNIC_URL_RAW.startsWith("http")
  ? CYNIC_URL_RAW
  : `http://${CYNIC_URL_RAW}`;
const CYNIC_API_KEY = process.env.CYNIC_API_KEY || "";

// Agent keypair — the key authorized to submit verdicts
const AGENT_KEYPAIR_PATH =
  process.env.AGENT_KEYPAIR || "/tmp/gasdf-deployer.json";

// Fake mint for demo — in production, this is the token's real mint
const DEMO_MINT_PATH = process.env.DEMO_MINT_KEYPAIR || "/tmp/asdf-mint.json";

// --- Helpers ---

function loadKeypair(path) {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function proposalHash(text) {
  return createHash("sha256").update(text).digest();
}

const VERDICT_TYPE_MAP = { HOWL: 0, WAG: 1, GROWL: 2, BARK: 3 };

function cynicVerdictToType(verdict) {
  return VERDICT_TYPE_MAP[verdict.toUpperCase()] ?? 3; // default BARK
}

function scoreToBasicPoints(score) {
  // CYNIC scores are 0.0-1.0, on-chain is basis points (0-10000)
  // but φ-bounded max is 0.618 = 6180bp
  return Math.round(score * 10000);
}

// --- CYNIC API ---

async function judgeProposal(text) {
  const headers = { "Content-Type": "application/json" };
  if (CYNIC_API_KEY) headers["Authorization"] = `Bearer ${CYNIC_API_KEY}`;

  const res = await fetch(`${CYNIC_URL}/judge`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: text,
      domain: "general",
    }),
  });

  if (!res.ok) {
    throw new Error(`CYNIC /judge failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// --- Commands ---

async function cmdInit() {
  const connection = new Connection(RPC_URL, "confirmed");
  const agent = loadKeypair(AGENT_KEYPAIR_PATH);

  // Generate a mint keypair for demo (or load existing)
  let mint;
  try {
    mint = loadKeypair(DEMO_MINT_PATH);
    console.log(`Loaded existing mint: ${mint.publicKey.toBase58()}`);
  } catch {
    mint = Keypair.generate();
    const { writeFileSync } = await import("fs");
    writeFileSync(
      DEMO_MINT_PATH,
      JSON.stringify(Array.from(mint.secretKey))
    );
    console.log(`Generated new mint: ${mint.publicKey.toBase58()}`);
  }

  const guardian = agent; // for demo, agent = guardian

  const ix = createInitializeCommunityIx({
    payer: agent.publicKey,
    mint: mint.publicKey,
    agent: agent.publicKey,
    guardian: guardian.publicKey,
    threshold: 3820, // φ⁻² = 0.382 = WAG minimum
    timelockSlots: 100, // ~40 seconds on local validator
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [agent]);

  const [communityPDA] = findCommunityPDA(mint.publicKey);
  console.log(`\nCommunity initialized!`);
  console.log(`  PDA:       ${communityPDA.toBase58()}`);
  console.log(`  Mint:      ${mint.publicKey.toBase58()}`);
  console.log(`  Agent:     ${agent.publicKey.toBase58()}`);
  console.log(`  Threshold: 3820 bp (WAG minimum)`);
  console.log(`  Timelock:  100 slots`);
  console.log(`  Tx:        ${sig}`);
}

async function cmdJudge(proposalText) {
  if (!proposalText) {
    console.error("Usage: agent-bridge.js judge <proposal text>");
    process.exit(1);
  }

  console.log(`\n--- CYNIC Agent Bridge ---`);
  console.log(`Proposal: "${proposalText}"`);

  // Step 1: Get verdict from CYNIC kernel
  console.log(`\n[1/4] Calling CYNIC /judge...`);
  const cynicResult = await judgeProposal(proposalText);

  // API shape: { verdict: "Howl"|"Wag"|..., q_score: { total, fidelity, phi, ... }, voter_count, ... }
  const verdictLabel = cynicResult.verdict ?? "BARK";
  const qs = cynicResult.q_score ?? {};
  const qScoreTotal = qs.total ?? 0;
  const dogCount = cynicResult.voter_count ?? 0;

  const axiomScores = {
    fidelity: scoreToBasicPoints(qs.fidelity ?? 0),
    phi: scoreToBasicPoints(qs.phi ?? 0),
    verify: scoreToBasicPoints(qs.verify ?? 0),
    culture: scoreToBasicPoints(qs.culture ?? 0),
    burn: scoreToBasicPoints(qs.burn ?? 0),
    sovereignty: scoreToBasicPoints(qs.sovereignty ?? 0),
  };

  console.log(`  Verdict: ${verdictLabel} (Q=${qScoreTotal.toFixed(4)})`);
  console.log(`  Dogs: ${dogCount}`);
  console.log(`  Axioms:`, axiomScores);

  // Step 2: Build transaction
  console.log(`\n[2/4] Building Solana transaction...`);
  const connection = new Connection(RPC_URL, "confirmed");
  const agent = loadKeypair(AGENT_KEYPAIR_PATH);
  const mint = loadKeypair(DEMO_MINT_PATH);

  const [communityPDA] = findCommunityPDA(mint.publicKey);
  const hash = proposalHash(proposalText);

  const qScoreBp = scoreToBasicPoints(qScoreTotal);

  const ix = createSubmitVerdictIx({
    agent: agent.publicKey,
    community: communityPDA,
    proposalHash: hash,
    qScore: qScoreBp,
    axiomScores,
    dogCount,
    verdictType: cynicVerdictToType(verdictLabel),
  });

  // Step 3: Sign and submit
  console.log(`\n[3/4] Signing and submitting...`);
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [agent]);

  // Step 4: Verify on-chain
  console.log(`\n[4/4] Verifying on-chain...`);
  const [verdictPDA] = findVerdictPDA(communityPDA, hash);
  const verdictAccount = await connection.getAccountInfo(verdictPDA);
  const onChain = deserializeVerdict(verdictAccount.data);

  console.log(`\n--- On-Chain Verdict ---`);
  console.log(`  PDA:       ${verdictPDA.toBase58()}`);
  console.log(`  Type:      ${onChain.verdictType}`);
  console.log(`  Q-Score:   ${onChain.qScore} bp`);
  console.log(`  Fidelity:  ${onChain.fidelity} bp`);
  console.log(`  Phi:       ${onChain.phi} bp`);
  console.log(`  Verify:    ${onChain.verify} bp`);
  console.log(`  Culture:   ${onChain.culture} bp`);
  console.log(`  Burn:      ${onChain.burn} bp`);
  console.log(`  Sovereignty: ${onChain.sovereignty} bp`);
  console.log(`  Dogs:      ${onChain.dogCount}`);
  console.log(`  Timestamp: ${new Date(onChain.timestamp * 1000).toISOString()}`);
  console.log(`  Tx:        ${sig}`);

  return { sig, verdictPDA: verdictPDA.toBase58(), onChain };
}

async function cmdRead() {
  const connection = new Connection(RPC_URL, "confirmed");
  const mint = loadKeypair(DEMO_MINT_PATH);
  const [communityPDA] = findCommunityPDA(mint.publicKey);

  const account = await connection.getAccountInfo(communityPDA);
  if (!account) {
    console.log("Community not found. Run: node bridge/agent-bridge.js init");
    process.exit(1);
  }

  const community = deserializeCommunity(account.data);
  console.log(`\n--- Community State ---`);
  console.log(`  PDA:            ${communityPDA.toBase58()}`);
  console.log(`  Mint:           ${community.mint}`);
  console.log(`  Agent:          ${community.agent}`);
  console.log(`  Guardian:       ${community.guardian}`);
  console.log(`  Paused:         ${community.paused}`);
  console.log(`  Threshold:      ${community.threshold} bp`);
  console.log(`  Timelock:       ${community.timelockSlots} slots`);
  console.log(`  Total Verdicts: ${community.totalVerdicts}`);
}

async function cmdExecute(verdictPdaStr, newThresholdStr) {
  if (!verdictPdaStr || !newThresholdStr) {
    console.error(
      "Usage: agent-bridge.js execute <verdict-pda> <new-threshold-bp>"
    );
    process.exit(1);
  }

  const newThreshold = parseInt(newThresholdStr, 10);
  if (isNaN(newThreshold) || newThreshold > 6180) {
    console.error("Threshold must be 0-6180 basis points");
    process.exit(1);
  }

  console.log(`\n--- Execute Action: Threshold Change ---`);
  const connection = new Connection(RPC_URL, "confirmed");
  const agent = loadKeypair(AGENT_KEYPAIR_PATH);
  const mint = loadKeypair(DEMO_MINT_PATH);
  const [communityPDA] = findCommunityPDA(mint.publicKey);

  // Read current state
  const commAccount = await connection.getAccountInfo(communityPDA);
  const before = deserializeCommunity(commAccount.data);
  console.log(`  Community:      ${communityPDA.toBase58()}`);
  console.log(`  Current thresh: ${before.threshold} bp`);
  console.log(`  New thresh:     ${newThreshold} bp`);
  console.log(`  Verdict PDA:    ${verdictPdaStr}`);

  // Check verdict
  const verdictPda = new (await import("@solana/web3.js")).PublicKey(
    verdictPdaStr
  );
  const verdictAccount = await connection.getAccountInfo(verdictPda);
  const verdict = deserializeVerdict(verdictAccount.data);
  console.log(`  Verdict type:   ${verdict.verdictType}`);
  console.log(`  Verdict Q:      ${verdict.qScore} bp`);
  console.log(`  Executed:       ${verdict.executed}`);

  if (verdict.executed) {
    console.error("\nVerdict already executed!");
    process.exit(1);
  }

  // Build + submit
  const ix = createExecuteThresholdChangeIx({
    agent: agent.publicKey,
    community: communityPDA,
    verdict: verdictPda,
    newThreshold,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [agent]);

  // Verify
  const afterAccount = await connection.getAccountInfo(communityPDA);
  const after = deserializeCommunity(afterAccount.data);
  console.log(`\n--- Result ---`);
  console.log(`  Threshold: ${before.threshold} bp → ${after.threshold} bp`);
  console.log(`  Tx:        ${sig}`);
}

// --- Main ---

const [, , cmd, ...rest] = process.argv;

switch (cmd) {
  case "init":
    cmdInit().catch(console.error);
    break;
  case "judge":
    cmdJudge(rest.join(" ")).catch(console.error);
    break;
  case "read":
    cmdRead().catch(console.error);
    break;
  case "execute":
    cmdExecute(rest[0], rest[1]).catch(console.error);
    break;
  default:
    console.log(`CYNIC Agent Bridge

Usage:
  node bridge/agent-bridge.js init                        Initialize $ASDF community
  node bridge/agent-bridge.js judge "proposal text"       Judge + submit on-chain
  node bridge/agent-bridge.js execute <verdict> <thresh>  Execute threshold change
  node bridge/agent-bridge.js read                        Read community state`);
}
