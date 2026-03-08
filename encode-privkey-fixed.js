const bs58 = require('bs58').default;
const fs = require('fs');

const secure = JSON.parse(fs.readFileSync('./.fee-payer-secure', 'utf-8'));
const secretKeyBuffer = Buffer.from(secure.privateKeyArray);

// Encode to base58
const encoded = bs58.encode(secretKeyBuffer);

console.log('\n✅ FEE PAYER WALLET READY\n');
console.log('PUBLIC KEY (send SOL to this address):');
console.log(`  ${secure.publicKey}\n`);
console.log('PRIVATE KEY (base58 - for FEE_PAYER_PRIVATE_KEY):');
console.log(`  ${encoded}\n`);
console.log('READY FOR DEPLOYMENT');
