/**
 * Validation — pure domain logic.
 *
 * Pure functions returning booleans. No I/O, no side effects.
 * Value objects (SolanaAddress, Base64String, Uuid) provide the
 * strict (throwing) variants.
 */

const { PublicKey } = require('@solana/web3.js');

function isValidSolanaAddress(address) {
  if (!address || typeof address !== 'string') return false;
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function isValidBase64(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    return Buffer.from(str, 'base64').toString('base64') === str;
  } catch {
    return false;
  }
}

function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

module.exports = { isValidSolanaAddress, isValidBase64, isValidUUID };