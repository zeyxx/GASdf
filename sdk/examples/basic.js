/**
 * GASdf SDK - Basic Usage Example
 *
 * This example demonstrates:
 * 1. Getting a gasless quote
 * 2. Building and signing a transaction
 * 3. Submitting the transaction
 * 4. Verifying burn proofs
 */

const { GASdf, GASdfError } = require('@gasdf/sdk');
const { Connection, Keypair, Transaction, SystemProgram, PublicKey } = require('@solana/web3.js');

// Initialize SDK
const gasdf = new GASdf({
  baseUrl: 'https://api.gasdf.io', // or http://localhost:3000 for local dev
});

// Your wallet (in production, use a secure wallet adapter)
const DEMO_PRIVATE_KEY = 'your-base58-private-key';

async function main() {
  try {
    // 1. Check service health
    console.log('Checking service health...');
    const health = await gasdf.health();
    console.log(`Service status: ${health.status}`);

    if (health.status === 'unhealthy') {
      throw new Error('Service is currently unavailable');
    }

    // 2. Get a gasless quote
    console.log('\nGetting quote...');
    const paymentToken = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
    const userPubkey = 'YourWalletPublicKey111111111111111111111111';

    const quote = await gasdf.quote(paymentToken, userPubkey);

    console.log(`Quote ID: ${quote.quoteId}`);
    console.log(`Fee: ${quote.feeAmountFormatted}`);
    console.log(`K-Score: ${quote.kScore.score} (${quote.kScore.tier})`);
    console.log(`Fee Payer: ${quote.feePayer}`);
    console.log(`Expires: ${quote.expiresAt}`);

    // 3. Build your transaction
    console.log('\nBuilding transaction...');

    // Example: Simple SOL transfer (replace with your actual transaction)
    const connection = new Connection('https://api.devnet.solana.com');
    const fromKeypair = Keypair.generate(); // In production, use your actual keypair

    const transaction = new Transaction({
      feePayer: new PublicKey(quote.feePayer), // GASdf pays the fee
      recentBlockhash: quote.blockhash,
    });

    // Add your instructions here
    // transaction.add(yourInstruction);

    // 4. Sign the transaction (user signs, fee payer signature added by GASdf)
    // transaction.partialSign(fromKeypair);

    // 5. Submit the transaction
    console.log('\nSubmitting transaction...');
    // const signedTx = transaction.serialize({ requireAllSignatures: false });
    // const result = await gasdf.submit(quote.quoteId, signedTx.toString('base64'));
    // console.log(`Transaction signature: ${result.signature}`);
    // console.log(`Explorer: ${result.explorerUrl}`);

    // 6. View burn statistics
    console.log('\nBurn statistics:');
    const stats = await gasdf.stats();
    console.log(`Total burned: ${stats.burnedFormatted}`);
    console.log(`Total transactions: ${stats.totalTransactions}`);
    console.log(`Treasury model: ${stats.treasury.model}`);

    // 7. View recent burn proofs
    console.log('\nRecent burns (verifiable on-chain):');
    const burnProofs = await gasdf.burnProofs(5);
    console.log(`Total burns: ${burnProofs.totalBurns}`);

    for (const burn of burnProofs.burns) {
      console.log(`  - ${burn.amountFormatted} via ${burn.method} (${burn.age})`);
      console.log(`    Verify: ${burn.explorerUrl}`);
    }

  } catch (error) {
    if (error instanceof GASdfError) {
      console.error(`GASdf Error: ${error.message}`);
      console.error(`Code: ${error.code}, Status: ${error.status}`);
    } else {
      console.error('Unexpected error:', error);
    }
  }
}

main();
