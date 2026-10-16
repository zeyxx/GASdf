/**
 * Batch burn job (phase 1): burn the treasury balance of a fee mint.
 * Mainnet flow adds Jupiter swap-to-ASDF before this step; on devnet the
 * test mint burns directly (mechanics proof, no ASDF on devnet).
 * Usage: FEE_PAYER_PRIVATE_KEY=<bs58> RPC_URL=<url> node scripts/batch-burn.js <MINT>
 * Appends a proof line to data/batch-burn-ledger.jsonl.
 */
const fs = require('fs');
const path = require('path');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const {
  getOrCreateAssociatedTokenAccount,
  createBurnInstruction,
  getAccount,
} = require('@solana/spl-token');
const { Transaction } = require('@solana/web3.js');

const LEDGER = path.join(__dirname, '..', 'data', 'batch-burn-ledger.jsonl');

async function main() {
  const mintArg = process.argv[2];
  if (!mintArg) {
    console.error('Usage: node scripts/batch-burn.js <MINT>');
    process.exit(1);
  }
  const mint = new PublicKey(mintArg);
  const secret = process.env.FEE_PAYER_PRIVATE_KEY;
  if (!secret) {
    console.error('FEE_PAYER_PRIVATE_KEY not set');
    process.exit(1);
  }
  const bs58 = require('bs58').default;
  const treasury = Keypair.fromSecretKey(bs58.decode(secret));
  const conn = new Connection(process.env.RPC_URL || 'https://api.devnet.solana.com', 'confirmed');

  const ata = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, treasury.publicKey);
  const balance = Number((await getAccount(conn, ata.address)).amount);
  console.log(`treasury ATA=${ata.address.toBase58()} balance=${balance}`);
  if (balance <= 0) {
    console.log('nothing to burn');
    return;
  }

  const tx = new Transaction().add(
    createBurnInstruction(ata.address, mint, treasury.publicKey, balance)
  );
  const sig = await conn.sendTransaction(tx, [treasury], { skipPreflight: false });
  await conn.confirmTransaction(sig, 'confirmed');
  const proof = {
    ts: new Date().toISOString(),
    network: process.env.NETWORK || 'devnet',
    mint: mint.toBase58(),
    burnedBaseUnits: balance,
    signature: sig,
    explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
  };
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.appendFileSync(LEDGER, `${JSON.stringify(proof)}\n`);
  console.log(JSON.stringify(proof));
}

main().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
