const fs = require('fs');

// Read the secure file
const secure = JSON.parse(fs.readFileSync('./.fee-payer-secure', 'utf-8'));
const secretKeyArray = secure.privateKeyArray;

// Manual base58 encoding (copy-paste from web3.js source)
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = {};
for (let s = 0; s < ALPHABET.length; s++) {
  ALPHABET_MAP[ALPHABET.charAt(s)] = s;
}

function encode(buffer) {
  if (buffer.length === 0) return '';
  
  let i = 0;
  let j = 0;
  let bitcoinpos = 0;
  const digits = [0];
  
  for (i = 0; i < buffer.length; ++i) {
    j = 0;
    bitcoinpos = 0;
    
    while (bitcoinpos < digits.length) {
      digits[bitcoinpos] = digits[bitcoinpos] << 8;
      bitcoinpos++;
    }
    
    digits[0] += buffer[i];
    j = 0;
    
    while (j < digits.length) {
      digits[j + 1] += digits[j] / 58 | 0;
      digits[j] %= 58;
      ++j;
    }
  }
  
  let output = '';
  i = digits.length - 1;
  
  while (i >= 0) {
    output += ALPHABET[digits[i]];
    i--;
  }
  
  i = 0;
  while (i < buffer.length && buffer[i] === 0) {
    output = ALPHABET[0] + output;
    i++;
  }
  
  return output;
}

const buffer = Buffer.from(secretKeyArray);
const base58 = encode(buffer);

console.log('\nBASE58 ENCODED PRIVATE KEY:');
console.log(base58);
console.log('\n✅ Ready for FEE_PAYER_PRIVATE_KEY env var\n');
