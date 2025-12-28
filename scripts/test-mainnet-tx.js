#!/usr/bin/env node
/**
 * Test a real gasless transaction on mainnet
 *
 * This script:
 * 1. Creates a fresh test user keypair (no SOL needed!)
 * 2. Gets a quote from GASdf
 * 3. Builds a memo transaction with GASdf as fee payer
 * 4. User signs (but doesn't pay gas)
 * 5. Submits to GASdf which signs as fee payer and broadcasts
 */

const { Keypair, Transaction, PublicKey, TransactionInstruction } = require('@solana/web3.js');
const fetch = require('node-fetch');

const GASDF_URL = 'http://localhost:3000';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║     GASdf Mainnet Gasless Transaction Test                ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // Step 1: Create test user (no SOL needed - that's the point!)
  const userKeypair = Keypair.generate();
  console.log('1️⃣  Test User Created');
  console.log(`   Address: ${userKeypair.publicKey.toBase58()}`);
  console.log('   Balance: 0 SOL (gasless!)\n');

  // Step 2: Get quote from GASdf
  console.log('2️⃣  Getting quote from GASdf...');
  const quoteRes = await fetch(`${GASDF_URL}/v1/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentToken: 'So11111111111111111111111111111111111111112', // SOL
      userPubkey: userKeypair.publicKey.toBase58(),
    }),
  });

  if (!quoteRes.ok) {
    const error = await quoteRes.text();
    throw new Error(`Quote failed: ${error}`);
  }

  const quote = await quoteRes.json();
  console.log(`   Quote ID: ${quote.quoteId}`);
  console.log(`   Fee Payer: ${quote.feePayer}`);
  console.log(`   Fee: ${quote.feeFormatted}`);
  console.log(`   TTL: ${quote.ttl}s\n`);

  // Step 3: Build memo transaction with GASdf as fee payer
  console.log('3️⃣  Building memo transaction...');

  // Get recent blockhash from GASdf's RPC
  const healthRes = await fetch(`${GASDF_URL}/health`);
  const health = await healthRes.json();

  // We need to get blockhash - let's call the RPC directly or use a helper endpoint
  // For now, let's use the public RPC
  const { Connection } = require('@solana/web3.js');
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  // Create memo instruction
  const memoText = `GASdf test: ${new Date().toISOString()} - Gasless tx powered by $ASDF burn`;
  const memoInstruction = new TransactionInstruction({
    keys: [{ pubkey: userKeypair.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memoText, 'utf-8'),
  });

  // Build transaction with GASdf as fee payer
  const transaction = new Transaction({
    feePayer: new PublicKey(quote.feePayer),
    recentBlockhash: blockhash,
  });
  transaction.add(memoInstruction);

  console.log(`   Memo: "${memoText}"`);
  console.log(`   Fee Payer: ${quote.feePayer} (GASdf pays!)`);
  console.log(`   Blockhash: ${blockhash.slice(0, 20)}...\n`);

  // Step 4: User signs (partial - fee payer signs on submit)
  console.log('4️⃣  User signing transaction...');
  transaction.partialSign(userKeypair);
  console.log('   ✓ User signature added\n');

  // Step 5: Submit to GASdf
  console.log('5️⃣  Submitting to GASdf...');
  const serialized = transaction.serialize({
    requireAllSignatures: false, // Fee payer signs on GASdf side
  });

  const submitRes = await fetch(`${GASDF_URL}/v1/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      transaction: serialized.toString('base64'),
      userPubkey: userKeypair.publicKey.toBase58(),
    }),
  });

  if (!submitRes.ok) {
    const error = await submitRes.text();
    throw new Error(`Submit failed: ${error}`);
  }

  const result = await submitRes.json();

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    🎉 SUCCESS!                            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  console.log(`   Signature: ${result.signature}`);
  console.log(`   Explorer:  ${result.explorer || `https://solscan.io/tx/${result.signature}`}`);
  console.log(`   Status:    ${result.status}`);
  console.log('\n   User paid: 0 SOL');
  console.log('   GASdf paid the gas fee → 80% will burn $ASDF\n');

  return result;
}

main()
  .then((result) => {
    console.log('Test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  });
