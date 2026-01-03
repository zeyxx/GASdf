/**
 * Pyth Oracle Service
 * On-chain price feeds for trustless pricing
 *
 * Philosophy: "On-chain is truth"
 * - No off-chain API dependency for pricing
 * - Decentralized oracle network
 * - Same RPC infrastructure as rest of app
 *
 * Uses PriceUpdateV2 format from Pyth Solana Receiver (rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ)
 * Sponsored feeds are on shard 0, updated with 1 minute heartbeat, 0.5% deviation
 */

const { PublicKey } = require('@solana/web3.js');
const rpc = require('../utils/rpc');
const logger = require('../utils/logger');
const config = require('../utils/config');

// =============================================================================
// Pyth Sponsored Price Feeds on Solana Mainnet (PriceUpdateV2 format)
// Source: https://docs.pyth.network/price-feeds/core/push-feeds/solana
// These are PDAs derived from feed IDs on shard 0
// Owner: rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ (Pyth Solana Receiver)
// =============================================================================
const PYTH_FEEDS = {
  // Major pairs
  'SOL/USD': new PublicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'),
  'BTC/USD': new PublicKey('4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo'),
  'ETH/USD': new PublicKey('42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC'),

  // Stables (PDA-derived addresses for shard 0)
  'USDC/USD': new PublicKey('Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX'),
  'USDT/USD': new PublicKey('HT2PLQBcG5EiCcNSaMHAjSgd9F98ecpATbk4Sk5oYuM'),
};

// Price status constants (replacing @pythnetwork/client dependency)
const PriceStatus = {
  Unknown: 0,
  Trading: 1,
  Halted: 2,
  Auction: 3,
};

// Token mint → Pyth feed mapping
const MINT_TO_FEED = {
  // SOL (wrapped)
  So11111111111111111111111111111111111111112: 'SOL/USD',
  // USDC
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC/USD',
  // USDT
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT/USD',
};

// Cache for price data (reduces RPC calls)
const priceCache = new Map();
const CACHE_TTL_MS = 10_000; // 10 seconds (Pyth updates every ~1 min)

// Stats for monitoring
let cacheHits = 0;
let cacheMisses = 0;
let rpcCalls = 0;

/**
 * Parse PriceUpdateV2 account data
 * Account layout (134 bytes):
 * - 8 bytes: Anchor discriminator
 * - 32 bytes: writeAuthority
 * - 1-2 bytes: verificationLevel (enum)
 * - PriceFeedMessage:
 *   - 32 bytes: feedId
 *   - 8 bytes: price (i64)
 *   - 8 bytes: conf (u64)
 *   - 4 bytes: exponent (i32)
 *   - 8 bytes: publishTime (i64)
 *   - 8 bytes: prevPublishTime (i64)
 *   - 8 bytes: emaPrice (i64)
 *   - 8 bytes: emaConf (u64)
 * - 8 bytes: postedSlot (u64)
 */
function parsePriceUpdateV2(data) {
  let offset = 8; // Skip Anchor discriminator

  // Skip writeAuthority (32 bytes)
  offset += 32;

  // verificationLevel enum: 0=Partial (+ 1 byte numSignatures), 1=Full
  const verificationVariant = data[offset];
  offset += 1;
  if (verificationVariant === 0) {
    offset += 1; // Skip numSignatures for Partial
  }

  // PriceFeedMessage
  const feedId = data.slice(offset, offset + 32);
  offset += 32;

  const priceRaw = data.readBigInt64LE(offset);
  offset += 8;

  const confRaw = data.readBigUInt64LE(offset);
  offset += 8;

  const exponent = data.readInt32LE(offset);
  offset += 4;

  const publishTime = data.readBigInt64LE(offset);
  offset += 8;

  // Skip prevPublishTime for now
  offset += 8;

  const emaPriceRaw = data.readBigInt64LE(offset);

  // Convert to decimal prices
  const multiplier = Math.pow(10, exponent);
  const price = Number(priceRaw) * multiplier;
  const confidence = Number(confRaw) * multiplier;
  const emaPrice = Number(emaPriceRaw) * multiplier;

  return {
    feedId: '0x' + feedId.toString('hex'),
    price,
    confidence,
    emaPrice,
    exponent,
    timestamp: Number(publishTime),
    status: PriceStatus.Trading, // Sponsored feeds are always trading
    verificationLevel: verificationVariant === 0 ? 'Partial' : 'Full',
  };
}

/**
 * Get price from Pyth oracle
 * Returns { price, confidence, status, timestamp, cached }
 */
async function getPrice(feedName) {
  const feedAccount = PYTH_FEEDS[feedName];
  if (!feedAccount) {
    throw new Error(`Unknown Pyth feed: ${feedName}`);
  }

  // Check cache
  const cached = priceCache.get(feedName);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    cacheHits++;
    return { ...cached, cached: true };
  }
  cacheMisses++;

  try {
    const connection = rpc.getConnection();
    rpcCalls++;

    const accountInfo = await connection.getAccountInfo(feedAccount);
    if (!accountInfo) {
      throw new Error(`Pyth account not found: ${feedName}`);
    }

    // Validate it's a PriceUpdateV2 account (owner = Pyth Solana Receiver)
    const PYTH_RECEIVER = 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ';
    if (accountInfo.owner.toBase58() !== PYTH_RECEIVER) {
      throw new Error(
        `Invalid account owner for ${feedName}: expected ${PYTH_RECEIVER}, got ${accountInfo.owner.toBase58()}`
      );
    }

    const priceData = parsePriceUpdateV2(accountInfo.data);

    // Check if price is stale (older than 2 minutes)
    const ageSeconds = Math.floor(Date.now() / 1000) - priceData.timestamp;
    if (ageSeconds > 120) {
      logger.warn('PYTH', 'Price feed is stale', {
        feed: feedName,
        ageSeconds,
      });
    }

    const result = {
      feed: feedName,
      price: priceData.price,
      confidence: priceData.confidence,
      emaPrice: priceData.emaPrice,
      status: 'Trading',
      exponent: priceData.exponent,
      timestamp: priceData.timestamp,
      verificationLevel: priceData.verificationLevel,
      fetchedAt: Date.now(),
    };

    // Cache the result
    priceCache.set(feedName, result);

    return { ...result, cached: false };
  } catch (error) {
    logger.error('PYTH', 'Failed to fetch price', {
      feed: feedName,
      error: error.message,
    });

    // Return stale cache if available
    if (cached) {
      logger.warn('PYTH', 'Using stale cache', {
        feed: feedName,
        age: Date.now() - cached.fetchedAt,
      });
      return { ...cached, cached: true, stale: true };
    }

    throw error;
  }
}

/**
 * Get SOL price in USD
 */
async function getSolPriceUsd() {
  const data = await getPrice('SOL/USD');
  return data.price;
}

/**
 * Get token price in USD (if Pyth feed available)
 * Returns null if no feed available
 */
async function getTokenPriceUsd(mint) {
  const feedName = MINT_TO_FEED[mint];
  if (!feedName) {
    return null; // No Pyth feed for this token
  }

  const data = await getPrice(feedName);
  return data.price;
}

/**
 * Convert SOL amount to token amount
 * Used for: "How much USDC = X lamports?"
 *
 * @param {string} tokenMint - Token mint address
 * @param {number} solAmountLamports - Amount in lamports
 * @returns {object} { inputAmount, outputAmount, symbol, decimals, source }
 */
async function getFeeInToken(tokenMint, solAmountLamports) {
  // If paying in SOL, no conversion needed
  if (tokenMint === config.WSOL_MINT) {
    return {
      inputAmount: solAmountLamports,
      outputAmount: solAmountLamports,
      priceImpactPct: 0,
      symbol: 'SOL',
      decimals: 9,
      source: 'native',
    };
  }

  // Check if we have a feed for this token BEFORE making RPC calls
  const isUsdc = tokenMint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const isUsdt = tokenMint === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
  const feedName = MINT_TO_FEED[tokenMint];

  // No Pyth support for this token - return null to signal fallback needed
  if (!isUsdc && !isUsdt && !feedName) {
    return null;
  }

  // Get SOL price
  const solPrice = await getSolPriceUsd();
  const solAmountUsd = (solAmountLamports / 1e9) * solPrice;

  // For stablecoins, assume 1:1 with USD
  if (isUsdc) {
    // USDC - 6 decimals
    const inputAmount = Math.ceil(solAmountUsd * 1e6);
    return {
      inputAmount,
      outputAmount: solAmountLamports,
      priceImpactPct: 0,
      symbol: 'USDC',
      decimals: 6,
      source: 'pyth',
      solPriceUsd: solPrice,
    };
  }

  if (isUsdt) {
    // USDT - 6 decimals
    const inputAmount = Math.ceil(solAmountUsd * 1e6);
    return {
      inputAmount,
      outputAmount: solAmountLamports,
      priceImpactPct: 0,
      symbol: 'USDT',
      decimals: 6,
      source: 'pyth',
      solPriceUsd: solPrice,
    };
  }

  // For other tokens with Pyth feed
  const tokenPrice = await getTokenPriceUsd(tokenMint);
  if (tokenPrice && tokenPrice > 0) {
    // Generic calculation: (SOL amount in USD) / (token price in USD)
    const tokenAmount = solAmountUsd / tokenPrice;
    // Assume 6 decimals for unknown tokens (most common)
    const decimals = 6;
    const inputAmount = Math.ceil(tokenAmount * Math.pow(10, decimals));

    return {
      inputAmount,
      outputAmount: solAmountLamports,
      priceImpactPct: 0,
      symbol: 'UNKNOWN',
      decimals,
      source: 'pyth',
      solPriceUsd: solPrice,
      tokenPriceUsd: tokenPrice,
    };
  }

  // No Pyth feed available - return null to signal fallback needed
  return null;
}

/**
 * Check if token has Pyth price feed
 */
function hasPythFeed(mint) {
  return MINT_TO_FEED[mint] !== undefined;
}

/**
 * Get oracle status for health endpoint
 */
function getStatus() {
  return {
    type: 'pyth',
    feeds: Object.keys(PYTH_FEEDS).length,
    cache: {
      size: priceCache.size,
      ttlMs: CACHE_TTL_MS,
      hits: cacheHits,
      misses: cacheMisses,
      hitRate:
        cacheHits + cacheMisses > 0
          ? ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(1) + '%'
          : 'N/A',
    },
    rpcCalls,
  };
}

/**
 * Warm up cache with SOL price
 */
async function warmCache() {
  try {
    await getPrice('SOL/USD');
    logger.info('PYTH', 'Cache warmed', { feed: 'SOL/USD' });
  } catch (error) {
    logger.warn('PYTH', 'Cache warm failed', { error: error.message });
  }
}

module.exports = {
  getPrice,
  getSolPriceUsd,
  getTokenPriceUsd,
  getFeeInToken,
  hasPythFeed,
  getStatus,
  warmCache,
  PYTH_FEEDS,
  MINT_TO_FEED,
};
