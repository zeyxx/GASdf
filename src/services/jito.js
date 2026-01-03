/**
 * Jito Bundle Service
 *
 * MEV protection via Jito Block Engine bundles
 * - Bundles are atomic (all-or-nothing)
 * - Protected from sandwich attacks
 * - Up to 5 transactions per bundle
 *
 * Philosophy: "Bundle swaps to protect burn economics"
 */

const { PublicKey, SystemProgram, TransactionInstruction } = require('@solana/web3.js');
const logger = require('../utils/logger');
const config = require('../utils/config');

// =============================================================================
// Jito Block Engine Configuration
// =============================================================================
const JITO_ENDPOINTS = {
  mainnet: 'https://mainnet.block-engine.jito.wtf',
  // Regional endpoints for lower latency
  ny: 'https://ny.mainnet.block-engine.jito.wtf',
  amsterdam: 'https://amsterdam.mainnet.block-engine.jito.wtf',
  frankfurt: 'https://frankfurt.mainnet.block-engine.jito.wtf',
  tokyo: 'https://tokyo.mainnet.block-engine.jito.wtf',
};

// Jito tip accounts (fixed, from getTipAccounts)
const TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

// Sandwich protection account prefix
const DONT_FRONT_PREFIX = 'jitodontfront';

// Default tip amount (lamports) - minimum is 1000
const DEFAULT_TIP_LAMPORTS = 10_000; // 0.00001 SOL
const MIN_TIP_LAMPORTS = 1_000;

// Stats tracking
let bundlesSent = 0;
let bundlesLanded = 0;
let bundlesFailed = 0;
let totalTipsPaid = 0;

/**
 * Get Jito endpoint based on config or region
 */
function getEndpoint() {
  // Allow override via env
  if (process.env.JITO_ENDPOINT) {
    return process.env.JITO_ENDPOINT;
  }

  // Use region-specific endpoint if configured
  const region = process.env.JITO_REGION || 'mainnet';
  return JITO_ENDPOINTS[region] || JITO_ENDPOINTS.mainnet;
}

/**
 * Get a random tip account (reduces contention)
 */
function getRandomTipAccount() {
  const index = Math.floor(Math.random() * TIP_ACCOUNTS.length);
  return new PublicKey(TIP_ACCOUNTS[index]);
}

/**
 * Create a tip instruction to pay Jito validators
 *
 * @param {PublicKey} payer - Fee payer public key
 * @param {number} tipLamports - Tip amount in lamports
 * @returns {TransactionInstruction}
 */
function createTipInstruction(payer, tipLamports = DEFAULT_TIP_LAMPORTS) {
  const tipAccount = getRandomTipAccount();

  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: tipAccount,
    lamports: Math.max(tipLamports, MIN_TIP_LAMPORTS),
  });
}

/**
 * Create sandwich protection account reference
 * Adding this account to a transaction prevents frontrunning
 *
 * @returns {TransactionInstruction} - Memo-like instruction with protection account
 */
function createSandwichProtection() {
  // Use a deterministic but unique protection account
  const protectionAccount = new PublicKey(`${DONT_FRONT_PREFIX}111111111111111111111111111111`);

  // Return as account key to add to transaction (read-only)
  return {
    pubkey: protectionAccount,
    isSigner: false,
    isWritable: false,
  };
}

/**
 * Send a bundle to Jito Block Engine
 *
 * @param {Transaction[]} transactions - Array of signed transactions (max 5)
 * @param {object} options - Options { tipLamports, timeout }
 * @returns {Promise<{ bundleId: string, success: boolean }>}
 */
async function sendBundle(transactions, options = {}) {
  const { tipLamports = DEFAULT_TIP_LAMPORTS, timeout = 30000 } = options;

  if (!transactions || transactions.length === 0) {
    throw new Error('No transactions provided');
  }

  if (transactions.length > 5) {
    throw new Error('Bundle cannot exceed 5 transactions');
  }

  // Skip on devnet (Jito is mainnet-only)
  if (config.NETWORK !== 'mainnet-beta') {
    logger.debug('JITO', 'Skipping bundle on non-mainnet', { network: config.NETWORK });
    return { bundleId: null, success: false, fallback: true };
  }

  const endpoint = getEndpoint();
  const bundleUrl = `${endpoint}/api/v1/bundles`;

  // Serialize transactions to base64
  const serializedTxs = transactions.map((tx) => {
    const serialized = tx.serialize();
    return Buffer.from(serialized).toString('base64');
  });

  const requestBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [serializedTxs, { encoding: 'base64' }],
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    bundlesSent++;
    totalTipsPaid += tipLamports;

    const response = await fetch(bundleUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const result = await response.json();

    if (result.error) {
      bundlesFailed++;
      logger.warn('JITO', 'Bundle rejected', {
        error: result.error.message || result.error,
        code: result.error.code,
      });
      return { bundleId: null, success: false, error: result.error };
    }

    const bundleId = result.result;
    logger.info('JITO', 'Bundle sent', { bundleId, txCount: transactions.length, tipLamports });

    return { bundleId, success: true };
  } catch (error) {
    bundlesFailed++;

    if (error.name === 'AbortError') {
      logger.warn('JITO', 'Bundle request timeout', { timeout });
      return { bundleId: null, success: false, error: 'timeout' };
    }

    logger.error('JITO', 'Bundle send failed', { error: error.message });
    return { bundleId: null, success: false, error: error.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Send a single transaction via Jito (with MEV protection)
 *
 * @param {Transaction} transaction - Signed transaction
 * @param {object} options - Options { bundleOnly, timeout }
 * @returns {Promise<{ signature: string, success: boolean }>}
 */
async function sendTransaction(transaction, options = {}) {
  const { bundleOnly = true, timeout = 30000 } = options;

  // Skip on devnet
  if (config.NETWORK !== 'mainnet-beta') {
    logger.debug('JITO', 'Skipping Jito sendTransaction on non-mainnet');
    return { signature: null, success: false, fallback: true };
  }

  const endpoint = getEndpoint();
  const txUrl = `${endpoint}/api/v1/transactions`;
  const queryParams = bundleOnly ? '?bundleOnly=true' : '';

  const serialized = transaction.serialize();
  const base64Tx = Buffer.from(serialized).toString('base64');

  const requestBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendTransaction',
    params: [base64Tx, { encoding: 'base64' }],
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${txUrl}${queryParams}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const result = await response.json();

    if (result.error) {
      logger.warn('JITO', 'Transaction rejected', { error: result.error });
      return { signature: null, success: false, error: result.error };
    }

    const signature = result.result;
    logger.info('JITO', 'Transaction sent via Jito', { signature });

    return { signature, success: true };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { signature: null, success: false, error: 'timeout' };
    }

    logger.error('JITO', 'Transaction send failed', { error: error.message });
    return { signature: null, success: false, error: error.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check bundle status
 *
 * @param {string} bundleId - Bundle ID to check
 * @returns {Promise<object>} - Bundle status
 */
async function getBundleStatus(bundleId) {
  if (!bundleId) {
    return { status: 'unknown', error: 'No bundle ID' };
  }

  const endpoint = getEndpoint();
  const statusUrl = `${endpoint}/api/v1/bundles`;

  const requestBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getBundleStatuses',
    params: [[bundleId]],
  };

  try {
    const response = await fetch(statusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const result = await response.json();

    if (result.error) {
      return { status: 'error', error: result.error };
    }

    const statuses = result.result?.value || [];
    const bundleStatus = statuses.find((s) => s.bundle_id === bundleId);

    if (!bundleStatus) {
      return { status: 'not_found', bundleId };
    }

    // Track landed bundles
    if (
      bundleStatus.confirmation_status === 'confirmed' ||
      bundleStatus.confirmation_status === 'finalized'
    ) {
      bundlesLanded++;
    }

    return {
      status: bundleStatus.confirmation_status || 'pending',
      slot: bundleStatus.slot,
      transactions: bundleStatus.transactions,
      bundleId,
    };
  } catch (error) {
    logger.error('JITO', 'Failed to get bundle status', { error: error.message, bundleId });
    return { status: 'error', error: error.message };
  }
}

/**
 * Check in-flight bundle status (within last 5 minutes)
 *
 * @param {string} bundleId - Bundle ID to check
 * @returns {Promise<object>} - In-flight status
 */
async function getInflightBundleStatus(bundleId) {
  if (!bundleId) {
    return { status: 'unknown' };
  }

  const endpoint = getEndpoint();

  const requestBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getInflightBundleStatuses',
    params: [[bundleId]],
  };

  try {
    const response = await fetch(`${endpoint}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const result = await response.json();

    if (result.error) {
      return { status: 'error', error: result.error };
    }

    const statuses = result.result?.value || [];
    const bundleStatus = statuses.find((s) => s.bundle_id === bundleId);

    if (!bundleStatus) {
      return { status: 'not_found', bundleId };
    }

    return {
      status: bundleStatus.status?.toLowerCase() || 'unknown',
      landedSlot: bundleStatus.landed_slot,
      bundleId,
    };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

/**
 * Get current tip floor from Jito
 * Useful for dynamic tip adjustment
 *
 * @returns {Promise<object>} - Tip floor info
 */
async function getTipFloor() {
  try {
    const response = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
    const data = await response.json();

    if (Array.isArray(data) && data.length > 0) {
      const tipInfo = data[0];
      return {
        p50: Math.floor((tipInfo.landed_tips_50th_percentile || 0) * 1e9), // Convert SOL to lamports
        p75: Math.floor((tipInfo.landed_tips_75th_percentile || 0) * 1e9),
        p95: Math.floor((tipInfo.landed_tips_95th_percentile || 0) * 1e9),
        ema: Math.floor((tipInfo.ema_landed_tips_50th_percentile || 0) * 1e9),
        timestamp: tipInfo.time,
      };
    }

    return { p50: DEFAULT_TIP_LAMPORTS, p75: DEFAULT_TIP_LAMPORTS * 2 };
  } catch (error) {
    logger.warn('JITO', 'Failed to get tip floor', { error: error.message });
    return { p50: DEFAULT_TIP_LAMPORTS, p75: DEFAULT_TIP_LAMPORTS * 2, error: error.message };
  }
}

/**
 * Calculate recommended tip based on current network conditions
 *
 * @param {string} priority - 'low' | 'medium' | 'high'
 * @returns {Promise<number>} - Recommended tip in lamports
 */
async function getRecommendedTip(priority = 'medium') {
  const tipFloor = await getTipFloor();

  switch (priority) {
    case 'low':
      return Math.max(tipFloor.p50 || DEFAULT_TIP_LAMPORTS, MIN_TIP_LAMPORTS);
    case 'high':
      return Math.max(tipFloor.p95 || DEFAULT_TIP_LAMPORTS * 10, MIN_TIP_LAMPORTS * 10);
    case 'medium':
    default:
      return Math.max(tipFloor.p75 || DEFAULT_TIP_LAMPORTS * 2, MIN_TIP_LAMPORTS * 2);
  }
}

/**
 * Check if Jito is enabled and available
 */
function isEnabled() {
  // Jito is mainnet-only
  if (config.NETWORK !== 'mainnet-beta') {
    return false;
  }

  // Can be disabled via env
  if (process.env.JITO_DISABLED === 'true') {
    return false;
  }

  return true;
}

/**
 * Get service status for health endpoint
 */
function getStatus() {
  return {
    enabled: isEnabled(),
    network: config.NETWORK,
    endpoint: isEnabled() ? getEndpoint() : null,
    stats: {
      bundlesSent,
      bundlesLanded,
      bundlesFailed,
      successRate: bundlesSent > 0 ? ((bundlesLanded / bundlesSent) * 100).toFixed(1) + '%' : 'N/A',
      totalTipsPaid: totalTipsPaid / 1e9, // In SOL
    },
    tipAccounts: TIP_ACCOUNTS.length,
  };
}

module.exports = {
  // Core functions
  sendBundle,
  sendTransaction,
  getBundleStatus,
  getInflightBundleStatus,

  // Helpers
  createTipInstruction,
  createSandwichProtection,
  getRandomTipAccount,
  getTipFloor,
  getRecommendedTip,

  // Status
  isEnabled,
  getStatus,

  // Constants
  TIP_ACCOUNTS,
  DEFAULT_TIP_LAMPORTS,
  MIN_TIP_LAMPORTS,
};
