const { Keypair } = require('@solana/web3.js');
const fs = require('fs');

// Use Solana's built-in bs58 encoding
// Keypair has .secretKey which is Uint8Array
// We need to encode it to base58

// Generate new keypair
const keypair = Keypair.generate();
const pubkey = keypair.publicKey.toString();

// For base58, use Solana's internal utility or just show as array
const secretKey = Array.from(keypair.secretKey);
const secretKeyJson = JSON.stringify(secretKey);

console.log('\n🔑 NEW FEE PAYER WALLET GENERATED\n');
console.log('PUBLIC KEY (send SOL here):');
console.log(`  ${pubkey}\n`);
console.log('PRIVATE KEY (JSON array - use with Solana CLI):');
console.log(`  ${secretKeyJson}\n`);
console.log('⚠️  SAVE THIS SECURELY.\n');

// Save to secure file
const secureFile = `./.fee-payer-secure`;
fs.writeFileSync(secureFile, JSON.stringify({
  publicKey: pubkey,
  privateKeyArray: secretKey,
  generatedAt: new Date().toISOString(),
  notes: 'NEVER commit this file. Delete after adding to Render.'
}, null, 2));

console.log(`✅ Keys saved to: ${secureFile}`);
console.log('   (This file is in .gitignore)\n');
