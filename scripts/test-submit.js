#!/usr/bin/env node
/**
 * Test script for gasless submit flow on mainnet
 *
 * This script:
 * 1. Gets a quote from the API
 * 2. Builds a transaction with fee transfer
 * 3. Signs with user wallet
 * 4. Submits via /submit endpoint
 */

// Load environment variables
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createTransferInstruction,
} = require('@solana/spl-token');

// Configuration
const API_URL = process.env.API_URL || 'https://asdfasdfa.tech';
// Use Helius RPC with API key
const HELIUS_KEY = process.env.HELIUS_API_KEY;
if (!HELIUS_KEY) {
  console.error('ERROR: HELIUS_API_KEY not set');
  process.exit(1);
}
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

// Test with $ASDF (test user has balance)
const PAYMENT_TOKEN = '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump'; // $ASDF

async function main() {
  console.log('=== GASdf Submit Flow Test ===\n');

  // Load user wallet from test-user.json
  const fs = require('fs');
  const userKeyPath = path.join(__dirname, '../.keys/test-user.json');
  if (!fs.existsSync(userKeyPath)) {
    console.error('ERROR: .keys/test-user.json not found');
    process.exit(1);
  }
  const userSecretKey = new Uint8Array(JSON.parse(fs.readFileSync(userKeyPath)));
  const userKeypair = Keypair.fromSecretKey(userSecretKey);
  console.log('User wallet:', userKeypair.publicKey.toBase58());

  // Connect to RPC (with retry logic for rate limits)
  const connection = new Connection(RPC_URL, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000
  });

  // Skip balance check to avoid rate limits - we know wallet has ~0.53 SOL from health check
  console.log('(Skipping balance check due to RPC rate limits)\n');

  // Step 1: Get quote
  console.log('1. Getting quote...');
  const quoteRes = await fetch(`${API_URL}/v1/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentToken: PAYMENT_TOKEN,
      userPubkey: userKeypair.publicKey.toBase58()
    })
  });

  if (!quoteRes.ok) {
    const err = await quoteRes.json();
    console.error('Quote failed:', err);
    process.exit(1);
  }

  const quote = await quoteRes.json();
  console.log('   Quote ID:', quote.quoteId);
  console.log('   Fee:', quote.feeFormatted);
  console.log('   Fee Payer:', quote.feePayer);
  console.log('   Expires in:', quote.ttl, 'seconds\n');

  // Step 2: Build transaction
  console.log('2. Building transaction...');

  const feePayer = new PublicKey(quote.feePayer);
  const feeAmount = parseInt(quote.feeAmount);

  // Get recent blockhash via fetch (bypasses web3.js rate limit handling)
  const blockhashRes = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLatestBlockhash',
      params: [{ commitment: 'finalized' }]
    })
  });
  const blockhashData = await blockhashRes.json();
  if (blockhashData.error) {
    throw new Error(`Failed to get blockhash: ${blockhashData.error.message}`);
  }
  const { blockhash, lastValidBlockHeight } = blockhashData.result.value;

  // Create transaction with fee payer from quote
  const tx = new Transaction({
    feePayer: feePayer,
    blockhash,
    lastValidBlockHeight
  });

  // Get token accounts for $ASDF transfer
  const asdfMint = new PublicKey(PAYMENT_TOKEN);
  const userAta = await getAssociatedTokenAddress(asdfMint, userKeypair.publicKey);
  const treasuryAta = await getAssociatedTokenAddress(asdfMint, feePayer);

  console.log('   User ATA:', userAta.toBase58().slice(0, 20) + '...');
  console.log('   Treasury ATA:', treasuryAta.toBase58().slice(0, 20) + '...');

  // Add fee transfer instruction ($ASDF token transfer to treasury)
  tx.add(
    createTransferInstruction(
      userAta,
      treasuryAta,
      userKeypair.publicKey,
      BigInt(feeAmount)
    )
  );

  console.log('   Fee amount:', feeAmount, 'lamports');
  console.log('   Blockhash:', blockhash.slice(0, 20) + '...\n');

  // Step 3: Sign transaction (user only - fee payer signs on server)
  console.log('3. Signing transaction...');
  tx.partialSign(userKeypair);

  // Serialize for submission
  const serializedTx = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false
  }).toString('base64');

  console.log('   Transaction size:', serializedTx.length, 'bytes');
  console.log('   Signatures:', tx.signatures.length, '\n');

  // Step 4: Submit to API
  console.log('4. Submitting to API...');
  const submitRes = await fetch(`${API_URL}/v1/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      transaction: serializedTx,
      userPubkey: userKeypair.publicKey.toBase58()
    })
  });

  const result = await submitRes.json();

  if (!submitRes.ok) {
    console.error('Submit failed:', result);
    process.exit(1);
  }

  console.log('   ✓ Transaction submitted!');
  console.log('   Signature:', result.signature);
  console.log('   Explorer:', `https://solscan.io/tx/${result.signature}`);
  console.log('\n=== Test Complete ===');
}

main().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
