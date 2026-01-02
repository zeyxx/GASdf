/**
 * Address Lookup Table (ALT) Utility
 *
 * Reduces transaction size by storing frequently used addresses in an on-chain table.
 * Instead of 32 bytes per address, only 1-2 bytes (index) are needed.
 *
 * Size savings: ~30 bytes per address in the ALT
 * Use case: Batched burns, multi-instruction transactions
 */

const {
  PublicKey,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
} = require('@solana/web3.js');
const rpc = require('./rpc');
const logger = require('./logger');
const config = require('./config');

// =============================================================================
// Core Program & Token Addresses (candidates for ALT)
// =============================================================================
const CORE_ADDRESSES = {
  // System programs
  SYSTEM_PROGRAM: new PublicKey('11111111111111111111111111111111'),
  TOKEN_PROGRAM: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  TOKEN_2022_PROGRAM: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
  ASSOCIATED_TOKEN_PROGRAM: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  RENT_SYSVAR: new PublicKey('SysvarRent111111111111111111111111111111111'),

  // Jupiter V6
  JUPITER_PROGRAM: new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'),

  // Common tokens
  WSOL_MINT: new PublicKey('So11111111111111111111111111111111111111112'),
  USDC_MINT: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  USDT_MINT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
};

// Cache for fetched ALT
let cachedLookupTable = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Get the configured ALT address
 * Returns null if not configured
 */
function getAltAddress() {
  const altAddress = process.env.ALT_ADDRESS;
  if (!altAddress) return null;

  try {
    return new PublicKey(altAddress);
  } catch {
    logger.warn('ALT', 'Invalid ALT_ADDRESS in config');
    return null;
  }
}

/**
 * Fetch the Address Lookup Table account
 * Returns the AddressLookupTableAccount or null
 */
async function fetchLookupTable() {
  const altAddress = getAltAddress();
  if (!altAddress) return null;

  // Check cache
  if (cachedLookupTable && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedLookupTable;
  }

  try {
    const connection = rpc.getConnection();
    const result = await connection.getAddressLookupTable(altAddress);

    if (result.value) {
      cachedLookupTable = result.value;
      cacheTimestamp = Date.now();
      logger.debug('ALT', 'Fetched lookup table', {
        address: altAddress.toBase58(),
        addresses: result.value.state.addresses.length,
      });
      return result.value;
    }

    logger.warn('ALT', 'Lookup table not found', { address: altAddress.toBase58() });
    return null;
  } catch (error) {
    logger.error('ALT', 'Failed to fetch lookup table', { error: error.message });
    return null;
  }
}

/**
 * Create a VersionedTransaction with Address Lookup Table
 *
 * @param {TransactionInstruction[]} instructions - Instructions to include
 * @param {PublicKey} payer - Fee payer public key
 * @param {string} blockhash - Recent blockhash
 * @returns {Promise<VersionedTransaction|null>} - VersionedTransaction or null if ALT not available
 */
async function createVersionedTransaction(instructions, payer, blockhash) {
  const lookupTable = await fetchLookupTable();

  // Build the message
  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTable ? [lookupTable] : []);

  return new VersionedTransaction(messageV0);
}

/**
 * Create instructions to initialize a new Address Lookup Table
 * Returns instructions and the derived ALT address
 *
 * @param {PublicKey} authority - Authority that can extend/close the table
 * @param {PublicKey} payer - Payer for rent
 * @param {number} recentSlot - Recent slot for derivation
 */
async function createLookupTableInstructions(authority, payer, recentSlot) {
  const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority,
    payer,
    recentSlot,
  });

  return { instruction: createIx, address: lookupTableAddress };
}

/**
 * Create instruction to extend a lookup table with new addresses
 *
 * @param {PublicKey} lookupTableAddress - The ALT to extend
 * @param {PublicKey} authority - Authority of the table
 * @param {PublicKey} payer - Payer for rent
 * @param {PublicKey[]} addresses - Addresses to add
 */
function createExtendInstruction(lookupTableAddress, authority, payer, addresses) {
  return AddressLookupTableProgram.extendLookupTable({
    lookupTable: lookupTableAddress,
    authority,
    payer,
    addresses,
  });
}

/**
 * Get the list of core addresses that should be in an ALT for GASdf
 * Includes ASDF mint and treasury if configured
 */
function getCoreAddressesForAlt() {
  const addresses = [
    CORE_ADDRESSES.SYSTEM_PROGRAM,
    CORE_ADDRESSES.TOKEN_PROGRAM,
    CORE_ADDRESSES.TOKEN_2022_PROGRAM,
    CORE_ADDRESSES.ASSOCIATED_TOKEN_PROGRAM,
    CORE_ADDRESSES.RENT_SYSVAR,
    CORE_ADDRESSES.JUPITER_PROGRAM,
    CORE_ADDRESSES.WSOL_MINT,
    CORE_ADDRESSES.USDC_MINT,
    CORE_ADDRESSES.USDT_MINT,
  ];

  // Add ASDF mint if configured and valid
  if (config.ASDF_MINT && !config.ASDF_MINT.includes('Fake')) {
    try {
      addresses.push(new PublicKey(config.ASDF_MINT));
    } catch {
      // Invalid mint, skip
    }
  }

  // Add treasury if configured
  if (config.TREASURY_ADDRESS) {
    try {
      addresses.push(new PublicKey(config.TREASURY_ADDRESS));
    } catch {
      // Invalid address, skip
    }
  }

  return addresses;
}

/**
 * Calculate transaction size savings with ALT
 *
 * @param {number} addressCount - Number of addresses in transaction
 * @param {number} altHits - How many addresses are in ALT
 * @returns {{ withoutAlt: number, withAlt: number, savings: number }}
 */
function calculateSizeSavings(addressCount, altHits) {
  // Without ALT: 32 bytes per address
  const withoutAlt = addressCount * 32;

  // With ALT: addresses in ALT = 1 byte (index), others = 32 bytes
  const withAlt = (addressCount - altHits) * 32 + altHits * 1;

  return {
    withoutAlt,
    withAlt,
    savings: withoutAlt - withAlt,
    savingsPercent: ((withoutAlt - withAlt) / withoutAlt * 100).toFixed(1),
  };
}

/**
 * Check if ALT is configured and available
 */
function isAltConfigured() {
  return !!getAltAddress();
}

/**
 * Get ALT status for health endpoint
 */
function getStatus() {
  const altAddress = getAltAddress();

  return {
    configured: !!altAddress,
    address: altAddress?.toBase58() || null,
    cached: !!cachedLookupTable,
    cacheAge: cachedLookupTable ? Date.now() - cacheTimestamp : null,
    addressCount: cachedLookupTable?.state?.addresses?.length || 0,
  };
}

/**
 * Clear the cached lookup table (for testing or refresh)
 */
function clearCache() {
  cachedLookupTable = null;
  cacheTimestamp = 0;
}

module.exports = {
  // Core functions
  getAltAddress,
  fetchLookupTable,
  createVersionedTransaction,
  isAltConfigured,

  // ALT management
  createLookupTableInstructions,
  createExtendInstruction,
  getCoreAddressesForAlt,

  // Utilities
  calculateSizeSavings,
  getStatus,
  clearCache,

  // Constants
  CORE_ADDRESSES,
};
