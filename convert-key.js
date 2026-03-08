const fs = require('fs');
const path = require('path');

// Read the secure file
const secure = JSON.parse(fs.readFileSync('./.fee-payer-secure', 'utf-8'));
const secretKeyArray = secure.privateKeyArray;

// Use tweetnacl's encoding if available, or export for CLI
try {
  const nacl = require('tweetnacl');
  const secretKey = new Uint8Array(secretKeyArray);
  // Try to use nacl encoding
  const encoded = nacl.util.encodeBase64(secretKey);
  console.log('Base64:', encoded);
} catch (e) {
  console.log('tweetnacl not available, exporting for Solana CLI');
}

// For Solana CLI: save as JSON array (which is the standard format)
console.log('\n📋 FEE PAYER WALLET SETUP:\n');
console.log('1. PUBLIC KEY (send SOL to this address):');
console.log(`   ${secure.publicKey}\n`);

console.log('2. PRIVATE KEY (keep secure):');
console.log(`   JSON Array: [${secretKeyArray.join(',')}]\n`);

console.log('3. Alternative: Save as Solana keypair file');
const keypairPath = path.join(process.env.HOME || process.env.USERPROFILE, '.solana', 'fee-payer.json');
console.log(`   Path: ${keypairPath}`);
console.log(`   Content: ${JSON.stringify(secretKeyArray)}\n`);

console.log('4. For GASdf Render deployment:');
console.log(`   Use the JSON array as base64 or contact Solana for conversion.\n`);
