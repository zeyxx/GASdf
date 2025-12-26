/**
 * Basic example: Send SOL without having SOL for fees
 *
 * Run: npx ts-node examples/basic.ts
 */

import { GASdf } from '../src';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

// Known token mints
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function main() {
  // Setup
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const gasdf = new GASdf();

  // Your user's wallet (in real app, this comes from wallet adapter)
  const userKeypair = Keypair.generate(); // Demo only!
  const recipient = new PublicKey('...');

  console.log('User wallet:', userKeypair.publicKey.toBase58());
  console.log('User has no SOL, but has USDC');

  // 1. Get a quote - user will pay fees in USDC
  console.log('\n1. Getting quote...');
  const quote = await gasdf.getQuote({
    userPubkey: userKeypair.publicKey,
    paymentToken: USDC_MINT,
  });

  console.log(`   Fee payer: ${quote.feePayer}`);
  console.log(`   Fee: ${quote.feeFormatted}`);
  console.log(`   Quote expires in: ${quote.ttl}s`);

  // 2. Build transaction with GASdf as fee payer
  console.log('\n2. Building transaction...');
  const { blockhash } = await connection.getLatestBlockhash();

  const tx = new Transaction({
    feePayer: new PublicKey(quote.feePayer), // GASdf pays SOL fees
    recentBlockhash: blockhash,
  });

  // Your actual instruction (transfer, swap, mint, anything)
  tx.add(
    SystemProgram.transfer({
      fromPubkey: userKeypair.publicKey,
      toPubkey: recipient,
      lamports: 1000000, // 0.001 SOL
    }),
  );

  // 3. User signs (notice: user doesn't need SOL!)
  console.log('\n3. User signing...');
  tx.sign(userKeypair);

  // 4. Submit through GASdf
  console.log('\n4. Submitting to GASdf...');
  const { signature, explorerUrl } = await gasdf.submit(tx, quote.quoteId);

  console.log(`\n✅ Success!`);
  console.log(`   Signature: ${signature}`);
  console.log(`   Explorer: ${explorerUrl}`);
}

main().catch(console.error);
