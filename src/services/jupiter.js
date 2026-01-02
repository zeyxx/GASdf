const config = require('../utils/config');
const { jupiterBreaker } = require('../utils/circuit-breaker');
const { safeProportion, safeCeil, clamp } = require('../utils/safe-math');
const { fetchWithTimeout, JUPITER_TIMEOUT } = require('../utils/fetch-timeout');
const redis = require('../utils/redis');
const logger = require('../utils/logger');

// =============================================================================
// Jupiter v6 API Configuration
// lite-api DEPRECATED January 31, 2026 - API key now required
// Get API key at: https://portal.jup.ag
// Free tier: 60 requests/minute, Paid tiers available
// =============================================================================
const JUPITER_V6_API = 'https://api.jup.ag/swap/v1';

// SECURITY: No fallback to deprecated lite-api - require proper API key
const JUPITER_API = JUPITER_V6_API;

// Validate API key is configured (config.js enforces this in production)
if (!config.JUPITER_API_KEY && !config.IS_DEV) {
  logger.error('JUPITER', 'JUPITER_API_KEY not configured - quotes will fail');
}

/**
 * Get headers for Jupiter API requests
 * Includes API key for v6 API if configured
 */
function getJupiterHeaders(contentType = false) {
  const headers = {};
  if (config.JUPITER_API_KEY) {
    headers['x-api-key'] = config.JUPITER_API_KEY;
  }
  if (contentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

// Common token info (avoid extra API calls)
const TOKEN_INFO = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9 },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6 },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', decimals: 6 },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', decimals: 9 },
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { symbol: 'jitoSOL', decimals: 9 },
  '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump': { symbol: '$ASDF', decimals: 6 },
};

// Cache hit/miss counters for monitoring
let cacheHits = 0;
let cacheMisses = 0;

async function getQuote(inputMint, outputMint, amount, slippageBps = 50) {
  // ==========================================================================
  // CACHE CHECK: Reduce Jupiter API calls by ~80%
  // ==========================================================================
  const cached = await redis.getCachedJupiterQuote(inputMint, outputMint, amount);
  if (cached) {
    cacheHits++;
    return cached;
  }
  cacheMisses++;

  return jupiterBreaker.execute(async () => {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString(),
    });

    // ==========================================================================
    // TIMEOUT PROTECTION: Prevents hanging on slow/unresponsive Jupiter API
    // ==========================================================================
    const response = await fetchWithTimeout(
      `${JUPITER_API}/quote?${params}`,
      { headers: getJupiterHeaders() },
      JUPITER_TIMEOUT
    );

    if (!response.ok) {
      throw new Error(`Jupiter quote failed: ${response.statusText}`);
    }

    const quote = await response.json();

    // Cache the result for future requests
    await redis.cacheJupiterQuote(inputMint, outputMint, amount, quote);

    return quote;
  });
}

async function getSwapTransaction(quoteResponse, userPublicKey) {
  return jupiterBreaker.execute(async () => {
    // ==========================================================================
    // TIMEOUT PROTECTION: Prevents hanging on slow/unresponsive Jupiter API
    // ==========================================================================
    const response = await fetchWithTimeout(
      `${JUPITER_API}/swap`,
      {
        method: 'POST',
        headers: getJupiterHeaders(true), // Include Content-Type
        body: JSON.stringify({
          quoteResponse,
          userPublicKey,
          wrapAndUnwrapSol: true,
        }),
      },
      JUPITER_TIMEOUT
    );

    if (!response.ok) {
      throw new Error(`Jupiter swap failed: ${response.statusText}`);
    }

    return response.json();
  });
}

// Get how much of inputToken equals the SOL fee amount
// Priority: Pyth (on-chain) → Jupiter (off-chain API) → Fallback
async function getFeeInToken(inputMint, solAmountLamports) {
  const tokenInfo = TOKEN_INFO[inputMint] || { symbol: 'UNKNOWN', decimals: 6 };

  // If paying in SOL, just return the amount
  if (inputMint === config.WSOL_MINT) {
    return {
      inputAmount: solAmountLamports,
      outputAmount: solAmountLamports,
      priceImpactPct: 0,
      symbol: 'SOL',
      decimals: 9,
      source: 'native',
    };
  }

  // ==========================================================================
  // PYTH FIRST: On-chain oracle (trustless, no rate limits)
  // ==========================================================================
  try {
    const pyth = require('./pyth');
    const pythResult = await pyth.getFeeInToken(inputMint, solAmountLamports);

    if (pythResult) {
      logger.debug('JUPITER', 'Using Pyth price', {
        mint: inputMint.slice(0, 8),
        source: 'pyth',
      });
      return {
        ...pythResult,
        symbol: tokenInfo.symbol || pythResult.symbol,
        decimals: tokenInfo.decimals || pythResult.decimals,
      };
    }
  } catch (pythError) {
    logger.debug('JUPITER', 'Pyth fallback to Jupiter', {
      mint: inputMint.slice(0, 8),
      error: pythError.message,
    });
  }

  // ==========================================================================
  // JUPITER FALLBACK: Off-chain API (for tokens without Pyth feed)
  // ==========================================================================
  try {
    // Get quote: how much input token for X SOL
    const quote = await getQuote(
      inputMint,
      config.WSOL_MINT,
      solAmountLamports * 2, // Get quote for 2x to find rate, we'll calculate actual
      100
    );

    // Numeric precision: Safe proportional calculation with zero-division check
    const inAmount = parseInt(quote.inAmount) || 0;
    const outAmount = parseInt(quote.outAmount) || 0;

    // Check for zero output (would cause division by zero)
    if (outAmount === 0) {
      throw new Error('Jupiter returned zero output amount');
    }

    // Safe proportional calculation: (inAmount * solAmountLamports) / outAmount
    const inputAmountRaw = safeProportion(inAmount, solAmountLamports, outAmount);

    if (inputAmountRaw === null) {
      throw new Error('Fee calculation overflow or invalid');
    }

    const inputAmount = safeCeil(inputAmountRaw);

    if (inputAmount === null || inputAmount <= 0) {
      throw new Error('Invalid input amount calculated');
    }

    return {
      inputAmount,
      outputAmount: solAmountLamports,
      priceImpactPct: parseFloat(quote.priceImpactPct) || 0,
      symbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals,
      route: quote,
      source: 'jupiter',
    };
  } catch (error) {
    // ==========================================================================
    // FINAL FALLBACK: Fixed rates (dev only)
    // ==========================================================================
    if (config.IS_DEV) {
      let inputAmount;
      if (tokenInfo.symbol === 'USDC' || tokenInfo.symbol === 'USDT') {
        // ~$200/SOL rate, convert lamports to token units
        inputAmount = Math.ceil((solAmountLamports / 1e9) * 200 * Math.pow(10, tokenInfo.decimals));
      } else {
        // For other tokens, assume 1:1 with SOL as fallback
        inputAmount = Math.ceil(solAmountLamports * Math.pow(10, tokenInfo.decimals) / 1e9);
      }

      return {
        inputAmount,
        outputAmount: solAmountLamports,
        priceImpactPct: 0,
        symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals,
        source: 'fallback',
      };
    }
    throw error;
  }
}

// Swap accumulated fees to ASDF for burning
async function swapToAsdf(solAmount) {
  const quote = await getQuote(
    config.WSOL_MINT,
    config.ASDF_MINT,
    solAmount,
    100 // 1% slippage for internal swaps
  );

  return quote;
}

/**
 * Get quote for swapping any token to SOL
 * Used by burn worker to convert collected fees to SOL
 */
async function getTokenToSolQuote(tokenMint, tokenAmount, slippageBps = 100) {
  // If already SOL, no swap needed
  if (tokenMint === config.WSOL_MINT) {
    return {
      inputMint: tokenMint,
      outputMint: config.WSOL_MINT,
      inAmount: tokenAmount.toString(),
      outAmount: tokenAmount.toString(),
      noSwapNeeded: true,
    };
  }

  return getQuote(tokenMint, config.WSOL_MINT, tokenAmount, slippageBps);
}

/**
 * Get quote for swapping any token directly to ASDF
 * More efficient than Token → SOL → ASDF (single swap)
 */
async function getTokenToAsdfQuote(tokenMint, tokenAmount, slippageBps = 100) {
  // If already ASDF, no swap needed
  if (tokenMint === config.ASDF_MINT) {
    return {
      inputMint: tokenMint,
      outputMint: config.ASDF_MINT,
      inAmount: tokenAmount.toString(),
      outAmount: tokenAmount.toString(),
      noSwapNeeded: true,
    };
  }

  return getQuote(tokenMint, config.ASDF_MINT, tokenAmount, slippageBps);
}

module.exports = {
  getQuote,
  getSwapTransaction,
  getFeeInToken,
  swapToAsdf,
  getTokenToSolQuote,
  getTokenToAsdfQuote,
  TOKEN_INFO,
  // Export for health checks / monitoring
  getApiInfo: () => ({
    endpoint: JUPITER_API,
    usingV6: true, // Always v6 now (lite-api deprecated Jan 31, 2026)
    hasApiKey: !!config.JUPITER_API_KEY,
    cache: {
      hits: cacheHits,
      misses: cacheMisses,
      hitRate: cacheHits + cacheMisses > 0
        ? ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(1) + '%'
        : 'N/A',
      ...redis.getJupiterCacheStats(),
    },
  }),
};
