#!/usr/bin/env node
/**
 * Setup script for GASdf development
 * Generates a new wallet and requests devnet airdrop
 */

const { Keypair, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const fs = require('fs');
const path = require('path');

const DEVNET_URL = 'https://api.devnet.solana.com';
const ENV_PATH = path.join(__dirname, '../.env');

async function main() {
  console.log('\n🔧 GASdf Wallet Setup\n');

  // Check if .env already exists
  if (fs.existsSync(ENV_PATH)) {
    const existing = fs.readFileSync(ENV_PATH, 'utf8');
    if (existing.includes('FEE_PAYER_PRIVATE_KEY=') && !existing.includes('FEE_PAYER_PRIVATE_KEY=\n')) {
      console.log('⚠️  .env already exists with a wallet configured.');
      console.log('   Delete .env to generate a new wallet.\n');

      // Extract and show public key
      const match = existing.match(/FEE_PAYER_PRIVATE_KEY=(.+)/);
      if (match) {
        try {
          const secretKey = bs58.decode(match[1].trim());
          const kp = Keypair.fromSecretKey(secretKey);
          console.log(`   Existing wallet: ${kp.publicKey.toBase58()}\n`);
        } catch (e) {
          console.log('   (Could not parse existing key)\n');
        }
      }
      return;
    }
  }

  // Generate new keypair
  console.log('1. Generating new devnet wallet...');
  const keypair = Keypair.generate();
  const privateKeyB58 = bs58.encode(keypair.secretKey);
  const publicKey = keypair.publicKey.toBase58();

  console.log(`   Public Key:  ${publicKey}`);
  console.log(`   Private Key: ${privateKeyB58.slice(0, 10)}...${privateKeyB58.slice(-10)}`);

  // Write .env
  console.log('\n2. Writing .env file...');
  const envContent = `# GASdf Environment Configuration
# Generated: ${new Date().toISOString()}
# Network: devnet (for development)

NODE_ENV=development

# Fee payer wallet (devnet only - DO NOT use mainnet keys here!)
FEE_PAYER_PRIVATE_KEY=${privateKeyB58}

# Optional: Helius API key for better RPC
# HELIUS_API_KEY=

# Token configuration
# ASDF_MINT=

# Redis (optional in dev, uses in-memory fallback)
# REDIS_URL=redis://localhost:6379
`;

  fs.writeFileSync(ENV_PATH, envContent);
  console.log('   ✓ .env created');

  // Request airdrop
  console.log('\n3. Requesting devnet airdrop (2 SOL)...');
  try {
    const connection = new Connection(DEVNET_URL, 'confirmed');
    const sig = await connection.requestAirdrop(keypair.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');

    const balance = await connection.getBalance(keypair.publicKey);
    console.log(`   ✓ Airdrop successful!`);
    console.log(`   Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);
  } catch (error) {
    console.log(`   ⚠️  Airdrop failed: ${error.message}`);
    console.log('   You can manually airdrop at: https://faucet.solana.com\n');
  }

  // Summary
  console.log('━'.repeat(50));
  console.log('\n✅ Setup complete!\n');
  console.log('Next steps:');
  console.log('  1. Run: npm run dev');
  console.log('  2. Test: curl http://localhost:3000/health');
  console.log('  3. Get quote: curl -X POST http://localhost:3000/quote \\');
  console.log('       -H "Content-Type: application/json" \\');
  console.log('       -d \'{"paymentMint": "So11111111111111111111111111111111111111112"}\'\n');

  console.log('⚠️  SECURITY REMINDER:');
  console.log('   - .env is in .gitignore (never commit it)');
  console.log('   - This wallet is for DEVNET only');
  console.log('   - Generate a new wallet for mainnet\n');
}

main().catch(console.error);
