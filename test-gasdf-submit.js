/**
 * GASdf E2E Test - Real Transaction Submission
 * 
 * Requirements:
 * - TEST_WALLET_PRIVATE_KEY: Base58 private key with USDC balance
 */

const { Keypair, PublicKey, Transaction, SystemProgram, Connection } = require('@solana/web3.js');
const { createTransferInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58');

const GASDF_URL = 'https://gasdf-43r8.onrender.com';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

async function main() {
  // Check for test wallet
  const privateKey = process.env.TEST_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    console.log('=== GASdf Submit Test ===\n');
    console.log('No TEST_WALLET_PRIVATE_KEY provided.\n');
    console.log('To test real submission, you need a wallet with USDC.\n');
    console.log('Example:');
    console.log('  TEST_WALLET_PRIVATE_KEY=<base58-key> node test-gasdf-submit.js\n');
    console.log('--- Dry Run (Quote Only) ---\n');
    
    // Just test the quote endpoint
    const testPubkey = Keypair.generate().publicKey.toBase58();
    const quoteRes = await fetch(`${GASDF_URL}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentToken: USDC_MINT.toBase58(),
        userPubkey: testPubkey,
      }),
    });
    
    const quote = await quoteRes.json();
    if (quote.error) {
      console.log('Quote error:', quote.error);
      return;
    }
    
    console.log('Quote received:');
    console.log('  Quote ID:', quote.quoteId);
    console.log('  Fee:', quote.feeFormatted);
    console.log('  Fee Payer:', quote.feePayer);
    console.log('  Treasury ATA:', quote.treasury.ata);
    console.log('  TTL:', quote.ttl, 'seconds');
    console.log('\nTo submit, you would:');
    console.log('  1. Build a transaction with fee transfer to treasury ATA');
    console.log('  2. Set feePayer to', quote.feePayer);
    console.log('  3. Add your transaction instructions');
    console.log('  4. Sign with your wallet');
    console.log('  5. POST to /submit with quoteId + serialized tx');
    return;
  }

  // Real submission test
  console.log('=== GASdf Real Submit Test ===\n');
  
  const decode = bs58.default ? bs58.default.decode : bs58.decode;
  const userWallet = Keypair.fromSecretKey(decode(privateKey));
  console.log('User wallet:', userWallet.publicKey.toBase58());
  
  const connection = new Connection(RPC_URL);
  
  // Step 1: Get quote
  console.log('\n1. Getting quote...');
  const quoteRes = await fetch(`${GASDF_URL}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentToken: USDC_MINT.toBase58(),
      userPubkey: userWallet.publicKey.toBase58(),
    }),
  });
  
  const quote = await quoteRes.json();
  if (quote.error) {
    console.log('Quote error:', quote.error);
    return;
  }
  
  console.log('  Quote ID:', quote.quoteId);
  console.log('  Fee:', quote.feeFormatted);
  
  // Step 2: Check user's USDC balance
  console.log('\n2. Checking USDC balance...');
  const userUsdcAta = await getAssociatedTokenAddress(USDC_MINT, userWallet.publicKey);
  const balance = await connection.getTokenAccountBalance(userUsdcAta).catch(() => null);
  
  if (!balance) {
    console.log('  No USDC account found for this wallet');
    return;
  }
  
  const usdcBalance = parseFloat(balance.value.uiAmountString);
  const feeAmount = parseInt(quote.feeAmount);
  console.log('  USDC balance:', usdcBalance);
  console.log('  Fee required:', feeAmount / 1e6, 'USDC');
  
  if (usdcBalance * 1e6 < feeAmount) {
    console.log('  Insufficient USDC balance!');
    return;
  }
  
  // Step 3: Build transaction
  console.log('\n3. Building transaction...');
  const feePayer = new PublicKey(quote.feePayer);
  const treasuryAta = new PublicKey(quote.treasury.ata);
  
  const { blockhash } = await connection.getLatestBlockhash();
  
  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: feePayer,
  });
  
  // Fee transfer to treasury
  tx.add(
    createTransferInstruction(
      userUsdcAta,
      treasuryAta,
      userWallet.publicKey,
      BigInt(feeAmount),
      [],
      TOKEN_PROGRAM_ID
    )
  );
  
  // Step 4: Sign with user wallet (partial sign)
  console.log('\n4. Signing transaction...');
  tx.partialSign(userWallet);
  
  const serializedTx = tx.serialize({ 
    requireAllSignatures: false,
    verifySignatures: false 
  }).toString('base64');
  
  console.log('  Transaction size:', Buffer.from(serializedTx, 'base64').length, 'bytes');
  
  // Step 5: Submit
  console.log('\n5. Submitting to GASdf...');
  const submitRes = await fetch(`${GASDF_URL}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      transaction: serializedTx,
      userPubkey: userWallet.publicKey.toBase58(),
    }),
  });
  
  const result = await submitRes.json();
  console.log('\nResult:', JSON.stringify(result, null, 2));
  
  if (result.signature) {
    console.log('\n✓ Transaction submitted!');
    console.log('  Signature:', result.signature);
    console.log('  Explorer: https://solscan.io/tx/' + result.signature);
  }
}

main().catch(console.error);
