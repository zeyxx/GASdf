#!/usr/bin/env node
/**
 * Batch test with $ASDF fee payments
 */

const { Keypair, Transaction, PublicKey, TransactionInstruction } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createTransferInstruction, getAccount } = require('@solana/spl-token');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const GASDF_URL = 'http://localhost:3000';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const TREASURY_ADDRESS = new PublicKey('9F5NUrZYd7jm5BqDYyXXmTWX9Y1Gt3T11NR7GAnRM68w');
const ASDF_MINT = new PublicKey('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');

async function runTransaction(index, userKeypair, connection) {
  // Get quote
  const quoteRes = await fetch(`${GASDF_URL}/v1/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentToken: ASDF_MINT.toBase58(),
      userPubkey: userKeypair.publicKey.toBase58(),
    }),
  });

  if (!quoteRes.ok) throw new Error(`Quote failed: ${await quoteRes.text()}`);
  const quote = await quoteRes.json();
  const feeAmount = parseInt(quote.feeAmount);

  // Build transaction
  const { blockhash } = await connection.getLatestBlockhash();
  const transaction = new Transaction({
    feePayer: new PublicKey(quote.feePayer),
    recentBlockhash: blockhash,
  });

  // Memo
  transaction.add(new TransactionInstruction({
    keys: [{ pubkey: userKeypair.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(`Batch #${index} - ${Date.now()}`, 'utf-8'),
  }));

  // $ASDF fee payment
  const userAta = await getAssociatedTokenAddress(ASDF_MINT, userKeypair.publicKey);
  const treasuryAta = await getAssociatedTokenAddress(ASDF_MINT, TREASURY_ADDRESS);
  transaction.add(createTransferInstruction(userAta, treasuryAta, userKeypair.publicKey, feeAmount));

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

  return { index, signature: result.signature.slice(0, 16), fee: feeAmount };
}

async function main() {
  const { Connection } = require('@solana/web3.js');
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

  // Load test user
  const testWalletPath = path.join(__dirname, '../.keys/test-user.json');
  const keyData = JSON.parse(fs.readFileSync(testWalletPath, 'utf-8'));
  const userKeypair = Keypair.fromSecretKey(Uint8Array.from(keyData));

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║      Batch $ASDF Fee Payment Test (10 transactions)           ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Check initial balances
  const userAta = await getAssociatedTokenAddress(ASDF_MINT, userKeypair.publicKey);
  const treasuryAta = await getAssociatedTokenAddress(ASDF_MINT, TREASURY_ADDRESS);

  const userBalance = await getAccount(connection, userAta).then(a => Number(a.amount));
  const treasuryBalance = await getAccount(connection, treasuryAta).then(a => Number(a.amount));

  console.log(`User $ASDF:     ${(userBalance / 1e6).toFixed(2)}`);
  console.log(`Treasury $ASDF: ${(treasuryBalance / 1e6).toFixed(6)}\n`);

  const TX_COUNT = 10;
  let totalFees = 0;
  let successCount = 0;

  for (let i = 1; i <= TX_COUNT; i++) {
    try {
      process.stdout.write(`TX ${i}/${TX_COUNT}... `);
      const result = await runTransaction(i, userKeypair, connection);
      console.log(`✓ ${result.signature}... (fee: ${result.fee})`);
      totalFees += result.fee;
      successCount++;
      if (i < TX_COUNT) await new Promise(r => setTimeout(r, 1500));
    } catch (error) {
      console.log(`✗ ${error.message.slice(0, 50)}`);
    }
  }

  // Final balances
  const finalUserBalance = await getAccount(connection, userAta).then(a => Number(a.amount));
  const finalTreasuryBalance = await getAccount(connection, treasuryAta).then(a => Number(a.amount));

  console.log('\n--- Results ---');
  console.log(`Successful: ${successCount}/${TX_COUNT}`);
  console.log(`Total fees paid: ${totalFees} units (${(totalFees / 1e6).toFixed(6)} $ASDF)`);
  console.log(`\nUser $ASDF:     ${(finalUserBalance / 1e6).toFixed(2)} (was ${(userBalance / 1e6).toFixed(2)})`);
  console.log(`Treasury $ASDF: ${(finalTreasuryBalance / 1e6).toFixed(6)} (was ${(treasuryBalance / 1e6).toFixed(6)})`);
  console.log(`\n→ Treasury accumulated ${((finalTreasuryBalance - treasuryBalance) / 1e6).toFixed(6)} $ASDF`);
}

main().catch(console.error);
