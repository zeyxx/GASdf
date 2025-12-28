#!/usr/bin/env node
/**
 * Batch test - Run multiple gasless transactions
 */

const { Keypair, Transaction, PublicKey, TransactionInstruction } = require('@solana/web3.js');
const fetch = require('node-fetch');

const GASDF_URL = 'http://localhost:3000';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

async function runTransaction(index, connection) {
  const userKeypair = Keypair.generate();

  // Get quote
  const quoteRes = await fetch(`${GASDF_URL}/v1/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentToken: 'So11111111111111111111111111111111111111112',
      userPubkey: userKeypair.publicKey.toBase58(),
    }),
  });

  if (!quoteRes.ok) throw new Error(`Quote failed: ${await quoteRes.text()}`);
  const quote = await quoteRes.json();

  // Build transaction
  const { blockhash } = await connection.getLatestBlockhash();
  const memoText = `GASdf batch test #${index} - ${Date.now()}`;

  const transaction = new Transaction({
    feePayer: new PublicKey(quote.feePayer),
    recentBlockhash: blockhash,
  });

  transaction.add(new TransactionInstruction({
    keys: [{ pubkey: userKeypair.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memoText, 'utf-8'),
  }));

  // Sign and submit
  transaction.partialSign(userKeypair);
  const serialized = transaction.serialize({ requireAllSignatures: false });

  const submitRes = await fetch(`${GASDF_URL}/v1/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      transaction: serialized.toString('base64'),
      userPubkey: userKeypair.publicKey.toBase58(),
    }),
  });

  if (!submitRes.ok) throw new Error(`Submit failed: ${await submitRes.text()}`);
  const result = await submitRes.json();

  return { index, signature: result.signature, user: userKeypair.publicKey.toBase58().slice(0, 8) };
}

async function main() {
  const { Connection } = require('@solana/web3.js');
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║         GASdf Batch Transaction Test (5 tx)               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // Check initial balance
  const initialHealth = await fetch(`${GASDF_URL}/health`).then(r => r.json());
  const initialBalance = initialHealth.checks.feePayer.payers[0].balance;
  console.log(`Initial fee payer balance: ${initialBalance} SOL\n`);

  const results = [];
  const TX_COUNT = 5;

  for (let i = 1; i <= TX_COUNT; i++) {
    try {
      process.stdout.write(`Transaction ${i}/${TX_COUNT}... `);
      const result = await runTransaction(i, connection);
      console.log(`✓ ${result.signature.slice(0, 20)}...`);
      results.push(result);

      // Small delay to avoid rate limiting
      if (i < TX_COUNT) await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      console.log(`✗ ${error.message}`);
    }
  }

  // Check final state
  console.log('\n--- Results ---');
  console.log(`Successful: ${results.length}/${TX_COUNT}`);

  // Check final balance
  const finalHealth = await fetch(`${GASDF_URL}/health`).then(r => r.json());
  const finalBalance = finalHealth.checks.feePayer.payers[0].balance;
  console.log(`Final fee payer balance: ${finalBalance} SOL`);

  // Check stats
  const stats = await fetch(`${GASDF_URL}/v1/stats`).then(r => r.json());
  console.log(`\n--- GASdf Stats ---`);
  console.log(`Total transactions: ${stats.totalTransactions}`);
  console.log(`Treasury balance: ${stats.treasury.balanceFormatted}`);
  console.log(`Total burned: ${stats.burnedFormatted}`);

  console.log('\n--- Transaction Signatures ---');
  results.forEach(r => {
    console.log(`https://solscan.io/tx/${r.signature}`);
  });
}

main().catch(console.error);
