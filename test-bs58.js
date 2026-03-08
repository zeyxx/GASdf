const bs58 = require('bs58');
const fs = require('fs');

const secure = JSON.parse(fs.readFileSync('./.fee-payer-secure', 'utf-8'));
const secretKeyArray = Buffer.from(secure.privateKeyArray);

// Encode to base58
const encoded = bs58.encode(secretKeyArray);
console.log('BASE58 PRIVATE KEY:');
console.log(encoded);
