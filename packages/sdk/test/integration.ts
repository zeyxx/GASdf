/**
 * Integration test for GASdf SDK
 *
 * Run: npx ts-node test/integration.ts
 */

import { Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { GASdf, GASdfError, QuoteExpiredError } from '../dist/index.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ASDF_MINT = '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump';

// Test against local server
const gasdf = new GASdf({
  endpoint: 'http://localhost:3000',
  timeout: 10000,
});

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('\n🧪 GASdf SDK Integration Tests\n');
  console.log(`Endpoint: ${gasdf['endpoint']}\n`);

  // Test 1: Health check
  await test('Health check', async () => {
    const health = await gasdf.health();
    if (!health.status) throw new Error('No status in health response');
    if (!health.network) throw new Error('No network in health response');
    console.log(`  Status: ${health.status}, Network: ${health.network}`);
  });

  // Test 2: Get tokens
  await test('Get supported tokens', async () => {
    const tokens = await gasdf.getTokens();
    if (!Array.isArray(tokens)) throw new Error('Tokens not an array');
    if (tokens.length === 0) throw new Error('No tokens returned');
    console.log(`  Found ${tokens.length} tokens: ${tokens.map(t => t.symbol).join(', ')}`);
  });

  // Test 3: Get token score (trusted token)
  await test('Get token score (USDC - trusted)', async () => {
    const score = await gasdf.getTokenScore(USDC_MINT);
    if (score.tier !== 'TRUSTED') throw new Error(`Expected TRUSTED, got ${score.tier}`);
    if (score.feeMultiplier !== 1.0) throw new Error(`Expected 1.0x, got ${score.feeMultiplier}x`);
    console.log(`  USDC: ${score.tier} (${score.feeMultiplier}x)`);
  });

  // Test 4: Get token score ($ASDF - native)
  await test('Get token score ($ASDF - native)', async () => {
    const score = await gasdf.getTokenScore(ASDF_MINT);
    if (score.tier !== 'TRUSTED') throw new Error(`Expected TRUSTED, got ${score.tier}`);
    console.log(`  $ASDF: ${score.tier} (${score.feeMultiplier}x)`);
  });

  // Test 5: Get token score (unknown token)
  await test('Get token score (unknown token)', async () => {
    const randomMint = Keypair.generate().publicKey.toBase58();
    const score = await gasdf.getTokenScore(randomMint);
    if (score.tier !== 'STANDARD') throw new Error(`Expected STANDARD, got ${score.tier}`);
    console.log(`  Unknown: ${score.tier} (${score.feeMultiplier}x)`);
  });

  // Test 6: Get quote
  const userKeypair = Keypair.generate();
  let quote: Awaited<ReturnType<typeof gasdf.getQuote>>;

  await test('Get quote', async () => {
    quote = await gasdf.getQuote({
      userPubkey: userKeypair.publicKey,
      paymentToken: USDC_MINT,
    });

    if (!quote.quoteId) throw new Error('No quoteId');
    if (!quote.feePayer) throw new Error('No feePayer');
    if (!quote.feeAmount) throw new Error('No feeAmount');
    if (!quote.expiresAt) throw new Error('No expiresAt');

    console.log(`  Quote ID: ${quote.quoteId.slice(0, 8)}...`);
    console.log(`  Fee payer: ${quote.feePayer.slice(0, 8)}...`);
    console.log(`  Fee: ${quote.feeFormatted}`);
    console.log(`  TTL: ${quote.ttl}s`);
  });

  // Test 7: Quote validity check
  await test('Quote validity check', async () => {
    if (!gasdf.isQuoteValid(quote)) {
      throw new Error('Quote should be valid');
    }

    // Test expired quote
    const expiredQuote = { ...quote, expiresAt: Date.now() - 1000 };
    if (gasdf.isQuoteValid(expiredQuote)) {
      throw new Error('Expired quote should not be valid');
    }
  });

  // Test 8: Get fee payer pubkey
  await test('Get fee payer pubkey', async () => {
    const feePayerPubkey = gasdf.getFeePayerPubkey(quote);
    if (!(feePayerPubkey instanceof PublicKey)) {
      throw new Error('Should return PublicKey instance');
    }
    if (feePayerPubkey.toBase58() !== quote.feePayer) {
      throw new Error('Fee payer mismatch');
    }
  });

  // Test 9: Build transaction with quote
  await test('Build transaction with fee payer', async () => {
    const tx = new Transaction({
      feePayer: gasdf.getFeePayerPubkey(quote),
      recentBlockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi', // Fake for test
    });

    tx.add(
      SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1000,
      })
    );

    // Sign as user
    tx.sign(userKeypair);

    if (!tx.feePayer?.equals(new PublicKey(quote.feePayer))) {
      throw new Error('Fee payer not set correctly');
    }

    const userSigned = tx.signatures.some(
      s => s.publicKey.equals(userKeypair.publicKey) && s.signature !== null
    );
    if (!userSigned) {
      throw new Error('User signature missing');
    }

    console.log(`  Transaction built with ${tx.instructions.length} instruction(s)`);
    console.log(`  User signed: ${userSigned}`);
  });

  // Test 10: Submit transaction (will fail validation but tests the endpoint)
  await test('Submit transaction (validation test)', async () => {
    const tx = new Transaction({
      feePayer: gasdf.getFeePayerPubkey(quote),
      recentBlockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
    });

    tx.add(
      SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1000,
      })
    );

    tx.sign(userKeypair);

    try {
      await gasdf.submit(tx, quote.quoteId);
      throw new Error('Should have failed (blockhash invalid)');
    } catch (error) {
      if (error instanceof GASdfError) {
        // Expected - transaction validation or RPC will fail
        console.log(`  Expected error: ${error.code}`);
      } else {
        throw error;
      }
    }
  });

  // Test 11: Stats endpoint
  await test('Get burn stats', async () => {
    const stats = await gasdf.stats();
    if (typeof stats.totalBurned !== 'number') throw new Error('No totalBurned');
    if (typeof stats.totalTransactions !== 'number') throw new Error('No totalTransactions');
    console.log(`  Total burned: ${stats.burnedFormatted}`);
    console.log(`  Total transactions: ${stats.totalTransactions}`);
  });

  // Test 12: Wrap convenience method
  await test('Wrap transaction convenience method', async () => {
    const tx = new Transaction();
    tx.feePayer = userKeypair.publicKey; // Will be overwritten
    tx.add(
      SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1000,
      })
    );

    const { quote: newQuote, transaction } = await gasdf.wrap(tx, USDC_MINT);

    if (!newQuote.quoteId) throw new Error('No quote returned');
    if (!transaction.feePayer?.equals(new PublicKey(newQuote.feePayer))) {
      throw new Error('Fee payer not set by wrap()');
    }

    console.log(`  New quote: ${newQuote.quoteId.slice(0, 8)}...`);
    console.log(`  Fee payer updated: ${transaction.feePayer.toBase58().slice(0, 8)}...`);
  });

  // Summary
  console.log('\n────────────────────────────────────');
  console.log(process.exitCode ? '❌ Some tests failed' : '✅ All tests passed');
  console.log('────────────────────────────────────\n');
}

main().catch(console.error);
