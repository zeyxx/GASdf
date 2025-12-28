#!/usr/bin/env node
/**
 * Test gasless transaction WITH token fee payment
 *
 * Full flow:
 * 1. User gets quote → fee amount in chosen token
 * 2. User builds tx with: instruction + token transfer (fee payment)
 * 3. GASdf pays gas, user pays fee in tokens
 * 4. Fees accumulate → swap to $ASDF → burn
 */

const {
  Keypair,
  Transaction,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const GASDF_URL = 'http://localhost:3000';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Treasury address for fee collection (same as fee payer for simplicity)
const TREASURY_ADDRESS = new PublicKey('9F5NUrZYd7jm5BqDYyXXmTWX9Y1Gt3T11NR7GAnRM68w');

// $ASDF token mint
const ASDF_MINT = new PublicKey('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');

async function main() {
  const { Connection } = require('@solana/web3.js');
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║   GASdf Test: Gasless TX with Token Fee Payment               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // ============================================================================
  // Step 1: Load or create test user wallet
  // ============================================================================
  const testWalletPath = path.join(__dirname, '../.keys/test-user.json');
  let userKeypair;

  if (fs.existsSync(testWalletPath)) {
    const keyData = JSON.parse(fs.readFileSync(testWalletPath, 'utf-8'));
    userKeypair = Keypair.fromSecretKey(Uint8Array.from(keyData));
    console.log('1️⃣  Loaded existing test user wallet');
  } else {
    userKeypair = Keypair.generate();
    fs.writeFileSync(testWalletPath, JSON.stringify(Array.from(userKeypair.secretKey)));
    console.log('1️⃣  Created new test user wallet');
  }

  console.log(`   Address: ${userKeypair.publicKey.toBase58()}`);

  // Check SOL balance
  const solBalance = await connection.getBalance(userKeypair.publicKey);
  console.log(`   SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

  // Check $ASDF balance
  let asdfBalance = 0;
  try {
    const userAsdfAta = await getAssociatedTokenAddress(ASDF_MINT, userKeypair.publicKey);
    const accountInfo = await getAccount(connection, userAsdfAta);
    asdfBalance = Number(accountInfo.amount);
    console.log(`   $ASDF Balance: ${(asdfBalance / 1e6).toFixed(2)} $ASDF`);
  } catch (e) {
    console.log(`   $ASDF Balance: 0 (no token account)`);
  }

  // ============================================================================
  // Step 2: Determine payment method
  // ============================================================================
  console.log('\n2️⃣  Determining payment method...');

  let paymentToken;
  let paymentAmount;
  let paymentSymbol;

  if (asdfBalance > 0) {
    // Pay with $ASDF - direct burn possible!
    paymentToken = ASDF_MINT.toBase58();
    paymentSymbol = '$ASDF';
    console.log('   ✓ Will pay fee with $ASDF (direct burn!)');
  } else if (solBalance > 10000) {
    // Pay with SOL
    paymentToken = 'So11111111111111111111111111111111111111112';
    paymentSymbol = 'SOL';
    console.log('   ✓ Will pay fee with SOL');
  } else {
    console.log('\n❌ Test user needs tokens to pay fees.');
    console.log('   Please send some $ASDF or SOL to:');
    console.log(`   ${userKeypair.publicKey.toBase58()}`);
    console.log('\n   $ASDF Mint: 9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');
    return;
  }

  // ============================================================================
  // Step 3: Get quote from GASdf
  // ============================================================================
  console.log('\n3️⃣  Getting quote from GASdf...');

  const quoteRes = await fetch(`${GASDF_URL}/v1/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentToken,
      userPubkey: userKeypair.publicKey.toBase58(),
    }),
  });

  if (!quoteRes.ok) {
    throw new Error(`Quote failed: ${await quoteRes.text()}`);
  }

  const quote = await quoteRes.json();
  paymentAmount = parseInt(quote.feeAmount);

  console.log(`   Quote ID: ${quote.quoteId}`);
  console.log(`   Fee: ${quote.feeFormatted}`);
  console.log(`   Fee Amount (raw): ${paymentAmount}`);
  console.log(`   TTL: ${quote.ttl}s`);

  // ============================================================================
  // Step 4: Build transaction with fee payment
  // ============================================================================
  console.log('\n4️⃣  Building transaction with fee payment...');

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const transaction = new Transaction({
    feePayer: new PublicKey(quote.feePayer),
    recentBlockhash: blockhash,
  });

  // Instruction 1: Memo (the user's actual action)
  const memoText = `GASdf full test: ${new Date().toISOString()} - Paid ${quote.feeFormatted} fee`;
  const memoInstruction = new TransactionInstruction({
    keys: [{ pubkey: userKeypair.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memoText, 'utf-8'),
  });
  transaction.add(memoInstruction);

  // Instruction 2: Fee payment (token transfer to treasury)
  if (paymentToken === 'So11111111111111111111111111111111111111112') {
    // SOL transfer
    const transferIx = SystemProgram.transfer({
      fromPubkey: userKeypair.publicKey,
      toPubkey: TREASURY_ADDRESS,
      lamports: paymentAmount,
    });
    transaction.add(transferIx);
    console.log(`   Added SOL transfer: ${paymentAmount} lamports → treasury`);
  } else {
    // SPL token transfer
    const userAta = await getAssociatedTokenAddress(new PublicKey(paymentToken), userKeypair.publicKey);
    const treasuryAta = await getAssociatedTokenAddress(new PublicKey(paymentToken), TREASURY_ADDRESS);

    // Check if treasury ATA exists, if not create it
    try {
      await getAccount(connection, treasuryAta);
    } catch (e) {
      console.log('   Creating treasury token account...');
      const createAtaIx = createAssociatedTokenAccountInstruction(
        userKeypair.publicKey, // payer
        treasuryAta,
        TREASURY_ADDRESS,
        new PublicKey(paymentToken)
      );
      transaction.add(createAtaIx);
    }

    const transferIx = createTransferInstruction(
      userAta,
      treasuryAta,
      userKeypair.publicKey,
      paymentAmount
    );
    transaction.add(transferIx);
    console.log(`   Added ${paymentSymbol} transfer: ${paymentAmount} → treasury`);
  }

  console.log(`   Memo: "${memoText.slice(0, 50)}..."`);

  // ============================================================================
  // Step 5: User signs transaction
  // ============================================================================
  console.log('\n5️⃣  User signing transaction...');
  transaction.partialSign(userKeypair);
  console.log('   ✓ User signature added');

  // ============================================================================
  // Step 6: Submit to GASdf
  // ============================================================================
  console.log('\n6️⃣  Submitting to GASdf...');

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

  if (!submitRes.ok) {
    const error = await submitRes.text();
    throw new Error(`Submit failed: ${error}`);
  }

  const result = await submitRes.json();

  // ============================================================================
  // Success!
  // ============================================================================
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                      🎉 SUCCESS!                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log(`   Signature: ${result.signature}`);
  console.log(`   Explorer:  https://solscan.io/tx/${result.signature}`);
  console.log(`\n   User paid: ${quote.feeFormatted} (fee)`);
  console.log(`   GASdf paid: ~0.00001 SOL (gas)`);
  console.log(`   → Fee goes to treasury → 80% burns $ASDF`);

  // Check new balances
  console.log('\n--- Updated Balances ---');
  const newSolBalance = await connection.getBalance(userKeypair.publicKey);
  console.log(`   User SOL: ${(newSolBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

  if (paymentToken !== 'So11111111111111111111111111111111111111112') {
    try {
      const userAsdfAta = await getAssociatedTokenAddress(new PublicKey(paymentToken), userKeypair.publicKey);
      const accountInfo = await getAccount(connection, userAsdfAta);
      console.log(`   User ${paymentSymbol}: ${(Number(accountInfo.amount) / 1e6).toFixed(2)}`);
    } catch (e) {}
  }

  // Check GASdf stats
  const stats = await fetch(`${GASDF_URL}/v1/stats`).then(r => r.json());
  console.log(`\n--- GASdf Stats ---`);
  console.log(`   Total TX: ${stats.totalTransactions}`);
  console.log(`   Treasury: ${stats.treasury.balanceFormatted}`);
  console.log(`   Burned: ${stats.burnedFormatted}`);

  return result;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  });
