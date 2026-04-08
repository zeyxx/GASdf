/**
 * cynic-governance on-chain instruction builders.
 *
 * Matches the Pinocchio program layout exactly:
 *   0 = initialize_community
 *   1 = submit_verdict
 *   3 = pause
 *   4 = unpause
 *
 * Uses @solana/web3.js v1 (already in repo).
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "A4QK3jj2kDx6w3da7FF3wxiBMnD2NrDsL1F7RCJA5NXx"
);

const COMMUNITY_SEED = Buffer.from("community");
const VERDICT_SEED = Buffer.from("verdict");

// --- PDA derivation ---

export function findCommunityPDA(mint) {
  return PublicKey.findProgramAddressSync(
    [COMMUNITY_SEED, new PublicKey(mint).toBuffer()],
    PROGRAM_ID
  );
}

export function findVerdictPDA(community, proposalHash) {
  const hashBuf =
    typeof proposalHash === "string"
      ? Buffer.from(proposalHash, "hex")
      : Buffer.from(proposalHash);
  if (hashBuf.length !== 32) throw new Error("proposal_hash must be 32 bytes");
  return PublicKey.findProgramAddressSync(
    [VERDICT_SEED, new PublicKey(community).toBuffer(), hashBuf],
    PROGRAM_ID
  );
}

// --- Instruction builders ---

/**
 * initialize_community
 *
 * Accounts: payer(s,w), community(w), mint, agent, guardian, systemProgram
 * Data: [0] + threshold(u16 LE) + timelock_slots(u32 LE)
 */
export function createInitializeCommunityIx({
  payer,
  mint,
  agent,
  guardian,
  threshold,
  timelockSlots,
}) {
  const [communityPDA] = findCommunityPDA(mint);

  const data = Buffer.alloc(7);
  data.writeUInt8(0, 0); // instruction discriminator
  data.writeUInt16LE(threshold, 1);
  data.writeUInt32LE(timelockSlots, 3);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(payer), isSigner: true, isWritable: true },
      { pubkey: communityPDA, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(agent), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(guardian), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * submit_verdict
 *
 * Accounts: agent(s,w), community(w), verdict(w), systemProgram
 * Data (49 bytes): [1] + proposal_hash(32) + q_score(u16) +
 *   fidelity(u16) + phi(u16) + verify(u16) + culture(u16) +
 *   burn(u16) + sovereignty(u16) + dog_count(u8) + verdict_type(u8)
 */
export function createSubmitVerdictIx({
  agent,
  community,
  proposalHash,
  qScore,
  axiomScores,
  dogCount,
  verdictType,
}) {
  const hashBuf =
    typeof proposalHash === "string"
      ? Buffer.from(proposalHash, "hex")
      : Buffer.from(proposalHash);
  if (hashBuf.length !== 32) throw new Error("proposal_hash must be 32 bytes");

  const [verdictPDA] = findVerdictPDA(community, hashBuf);

  // 1 (disc) + 32 (hash) + 2 (q) + 12 (6 axioms) + 1 (dogs) + 1 (type) = 49
  const data = Buffer.alloc(49);
  let offset = 0;
  data.writeUInt8(1, offset);
  offset += 1;
  hashBuf.copy(data, offset);
  offset += 32;
  data.writeUInt16LE(qScore, offset);
  offset += 2;

  // 6 axiom scores in order: fidelity, phi, verify, culture, burn, sovereignty
  const axiomOrder = [
    "fidelity",
    "phi",
    "verify",
    "culture",
    "burn",
    "sovereignty",
  ];
  for (const name of axiomOrder) {
    data.writeUInt16LE(axiomScores[name] ?? 0, offset);
    offset += 2;
  }

  data.writeUInt8(dogCount, offset);
  offset += 1;
  data.writeUInt8(verdictType, offset);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(agent), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(community), isSigner: false, isWritable: true },
      { pubkey: verdictPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * execute_action — threshold change (action_type 1)
 *
 * Accounts: agent(s), community(w), verdict(w)
 * Data: [2 (instruction disc)] + [1 (action_type)] + new_threshold(u16 LE)
 */
export function createExecuteThresholdChangeIx({
  agent,
  community,
  verdict,
  newThreshold,
}) {
  const data = Buffer.alloc(4);
  data.writeUInt8(2, 0); // instruction discriminator (execute_action)
  data.writeUInt8(1, 1); // action_type = threshold change
  data.writeUInt16LE(newThreshold, 2);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(agent), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(community), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(verdict), isSigner: false, isWritable: true },
    ],
    data,
  });
}

// --- Account deserializers ---

const VERDICT_TYPES = ["HOWL", "WAG", "GROWL", "BARK"];

export function deserializeCommunity(data) {
  if (data.length < 110 || data[0] !== 0) return null;
  const d = Buffer.from(data);
  return {
    disc: d.readUInt8(0),
    version: d.readUInt8(1),
    bump: d.readUInt8(2),
    paused: d.readUInt8(3) !== 0,
    mint: new PublicKey(d.subarray(4, 36)).toBase58(),
    agent: new PublicKey(d.subarray(36, 68)).toBase58(),
    guardian: new PublicKey(d.subarray(68, 100)).toBase58(),
    threshold: d.readUInt16LE(100),
    timelockSlots: d.readUInt32LE(102),
    totalVerdicts: d.readUInt32LE(106),
  };
}

export function deserializeVerdict(data) {
  if (data.length < 106 || data[0] !== 1) return null;
  const d = Buffer.from(data);
  return {
    disc: d.readUInt8(0),
    version: d.readUInt8(1),
    bump: d.readUInt8(2),
    verdictType: VERDICT_TYPES[d.readUInt8(3)] ?? "UNKNOWN",
    community: new PublicKey(d.subarray(4, 36)).toBase58(),
    proposalHash: d.subarray(36, 68).toString("hex"),
    qScore: d.readUInt16LE(68),
    fidelity: d.readUInt16LE(70),
    phi: d.readUInt16LE(72),
    verify: d.readUInt16LE(74),
    culture: d.readUInt16LE(76),
    burn: d.readUInt16LE(78),
    sovereignty: d.readUInt16LE(80),
    dogCount: d.readUInt8(82),
    // repr(C): 7 bytes padding after u8 dog_count to align i64 timestamp
    timestamp: Number(d.readBigInt64LE(90)),
    executed: d.readUInt8(98) !== 0,
  };
}
