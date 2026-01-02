#!/usr/bin/env node
/**
 * Test the published gasdf-sdk with a real transaction
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { GASdf } = require('gasdf-sdk');
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
const fs = require('fs');
const path = require('path');

// Config
const HELIUS_KEY = process.env.HELIUS_API_KEY;
if (!HELIUS_KEY) {
  console.error('ERROR: HELIUS_API_KEY not set');
  process.exit(1);
}

const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
const ASDF_MINT = '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump';

async function main() {
  console.log('=== GASdf SDK Published Test ===\n');

  // Initialize SDK (uses default endpoint: asdfasdfa.tech)
  const gasdf = new GASdf();
  console.log('SDK initialized with default endpoint\n');

  // Load test user wallet
  const userKeyPath = path.join(__dirname, '../.keys/test-user.json');
  if (!fs.existsSync(userKeyPath)) {
    console.error('ERROR: .keys/test-user.json not found');
    process.exit(1);
  }
  const userSecretKey = new Uint8Array(JSON.parse(fs.readFileSync(userKeyPath)));
  const userKeypair = Keypair.fromSecretKey(userSecretKey);
  console.log('User wallet:', userKeypair.publicKey.toBase58());

  // Connect to RPC
  const connection = new Connection(RPC_URL, 'confirmed');

  // Step 1: Health check
  console.log('\n1. Health check...');
  const health = await gasdf.health();
  console.log('   Status:', health.status);
  console.log('   Network:', health.network);

  // Step 2: Get quote
  console.log('\n2. Getting quote...');
  const quote = await gasdf.getQuote({
    userPubkey: userKeypair.publicKey,
    paymentToken: ASDF_MINT,
  });

  console.log('   Quote ID:', quote.quoteId);
  console.log('   Fee:', quote.feeFormatted);
  console.log('   Fee Payer:', quote.feePayer);
  console.log('   Treasury:', quote.treasury.address);
  console.log('   Treasury ATA:', quote.treasury.ata);
  console.log('   Holder Tier:', quote.holderTier.tier, quote.holderTier.emoji);
  console.log('   Discount:', quote.holderTier.discountPercent + '%');
  console.log('   TTL:', quote.ttl + 's');

  // Step 3: Build transaction
  console.log('\n3. Building transaction...');

  // Get blockhash via public RPC (Helius rate limited)
  const blockhashRes = await fetch('https://api.mainnet-beta.solana.com', {
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
    throw new Error(`Blockhash failed: ${blockhashData.error.message}`);
  }
  const { blockhash, lastValidBlockHeight } = blockhashData.result.value;

  // Build tx with GASdf as fee payer
  const tx = new Transaction({
    feePayer: gasdf.getFeePayerPubkey(quote),
    blockhash,
    lastValidBlockHeight,
  });

  // Add fee payment instruction (transfer $ASDF to treasury)
  const asdfMint = new PublicKey(ASDF_MINT);
  const userAta = await getAssociatedTokenAddress(asdfMint, userKeypair.publicKey);
  const treasuryAta = new PublicKey(quote.treasury.ata);
  const feeAmount = BigInt(quote.feeAmount);

  tx.add(
    createTransferInstruction(
      userAta,
      treasuryAta,
      userKeypair.publicKey,
      feeAmount
    )
  );

  console.log('   User ATA:', userAta.toBase58().slice(0, 20) + '...');
  console.log('   Fee amount:', quote.feeAmount, 'units');

  // Step 4: Sign transaction (user only)
  console.log('\n4. Signing transaction...');
  tx.partialSign(userKeypair);
  console.log('   User signed ✓');

  // Step 5: Submit via SDK
  console.log('\n5. Submitting via SDK...');
  const result = await gasdf.submit(tx, quote.quoteId);

  console.log('   ✓ Transaction submitted!');
  console.log('   Signature:', result.signature);
  console.log('   Explorer:', `https://solscan.io/tx/${result.signature}`);

  console.log('\n=== Test Complete ===');
}

main().catch(err => {
  console.error('\nTest failed:', err.message);
  if (err.code) console.error('Error code:', err.code);
  process.exit(1);
});
