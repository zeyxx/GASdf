#!/usr/bin/env node
/**
 * Test a real gasless transaction with the test user wallet
 * Run: node scripts/test-real-transaction.js
 */

require('dotenv').config();

const {
  Keypair,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const fs = require('fs');

const API_URL = process.env.API_URL || 'https://gasdf-43r8.onrender.com';
const RPC_URL = 'https://api.mainnet-beta.solana.com';
const ASDF_MINT = '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump';

async function main() {
  console.log('=== GASdf Real Transaction Test ===\n');

  // Load test user keypair
  const keyData = JSON.parse(fs.readFileSync('.keys/test-user.json', 'utf8'));
  const user = Keypair.fromSecretKey(Uint8Array.from(keyData));
  console.log('User Wallet:', user.publicKey.toBase58());

  const conn = new Connection(RPC_URL);

  // Step 1: Get a quote
  console.log('\n--- Step 1: Getting Quote ---');
  const quoteRes = await fetch(`${API_URL}/v1/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userPubkey: user.publicKey.toBase58(),
      paymentToken: ASDF_MINT,
    }),
  });

  if (!quoteRes.ok) {
    const err = await quoteRes.json();
    console.error('Quote failed:', err);
    process.exit(1);
  }

  const quote = await quoteRes.json();
  console.log('Quote ID:', quote.quoteId);
  console.log('Fee Payer:', quote.feePayer);
  console.log('Fee Amount:', quote.feeFormatted);
  console.log('Treasury:', quote.treasury?.address);
  console.log('Expires:', new Date(quote.expiresAt).toISOString());

  // Step 2: Build transaction
  console.log('\n--- Step 2: Building Transaction ---');
  const feePayer = new PublicKey(quote.feePayer);
  const treasury = new PublicKey(quote.treasury.address);
  const feeAmount = BigInt(quote.feeAmount);

  // Get user's ASDF token account
  const userAta = await getAssociatedTokenAddress(
    new PublicKey(ASDF_MINT),
    user.publicKey
  );

  // Get treasury's ASDF token account (or use the one from quote)
  const treasuryAta = quote.treasury.ata
    ? new PublicKey(quote.treasury.ata)
    : await getAssociatedTokenAddress(new PublicKey(ASDF_MINT), treasury);

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');

  // Build transaction
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = feePayer;

  // Add compute budget (optional but recommended)
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));

  // Add fee payment instruction (user pays fee to treasury)
  tx.add(createTransferInstruction(
    userAta,
    treasuryAta,
    user.publicKey,
    feeAmount,
    [],
    TOKEN_PROGRAM_ID
  ));

  // Add a memo instruction (the "user's transaction")
  const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  tx.add(new TransactionInstruction({
    keys: [{ pubkey: user.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(`GASdf test: ${Date.now()}`),
  }));

  console.log('Transaction built with', tx.instructions.length, 'instructions');

  // Step 3: Sign transaction (user only)
  console.log('\n--- Step 3: Signing Transaction ---');
  tx.partialSign(user);
  console.log('User signed');

  // Serialize for submission
  const serializedTx = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).toString('base64');

  // Step 4: Submit to GASdf
  console.log('\n--- Step 4: Submitting Transaction ---');
  const submitRes = await fetch(`${API_URL}/v1/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      transaction: serializedTx,
      userPubkey: user.publicKey.toBase58(),
    }),
  });

  const result = await submitRes.json();

  if (!submitRes.ok) {
    console.error('Submit failed:', result);
    process.exit(1);
  }

  console.log('\n=== Transaction Submitted ===');
  console.log('Signature:', result.signature);
  console.log('Status:', result.status);
  console.log('Explorer:', result.explorerUrl || `https://solscan.io/tx/${result.signature}`);

  // Step 5: Check stats to verify PostgreSQL recording
  console.log('\n--- Step 5: Verifying Stats (wait 5s) ---');
  await new Promise(r => setTimeout(r, 5000));

  const statsRes = await fetch(`${API_URL}/v1/stats`);
  const stats = await statsRes.json();
  console.log('Total Transactions:', stats.totalTransactions);
  console.log('Total Burned:', stats.burnedFormatted);

  console.log('\n✅ Test complete!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
