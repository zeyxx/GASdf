/**
 * Jupiter v6 API — Quote, swap, and price oracle
 * lite-api DEPRECATED Jan 31 2026 — API key required
 */

const config = require('../utils/config');
const redis = require('../utils/redis');
const logger = require('../utils/logger');
const { TOKEN_INFO } = require('../constants');

const JUPITER_API = 'https://api.jup.ag/swap/v1';
const FETCH_TIMEOUT = 10_000; // 10s

if (!config.JUPITER_API_KEY && !config.IS_DEV) {
  logger.error('JUPITER', 'JUPITER_API_KEY not configured — quotes will fail');
}

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

// Cache stats
let cacheHits = 0;
let cacheMisses = 0;

async function getQuote(inputMint, outputMint, amount, slippageBps = 50) {
  // Check cache first
  const cached = await redis.getCachedJupiterQuote(inputMint, outputMint, amount);
  if (cached) {
    cacheHits++;
    return cached;
  }
  cacheMisses++;

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
    maxAccounts: '15',
    onlyDirectRoutes: 'true',
  });

  const response = await fetch(`${JUPITER_API}/quote?${params}`, {
    headers: getJupiterHeaders(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`Jupiter quote failed: ${response.statusText}`);
  }

  const quote = await response.json();
  await redis.cacheJupiterQuote(inputMint, outputMint, amount, quote);
  return quote;
}

async function getSwapTransaction(quoteResponse, userPublicKey) {
  const response = await fetch(`${JUPITER_API}/swap`, {
    method: 'POST',
    headers: getJupiterHeaders(true),
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`Jupiter swap failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get how much of inputToken equals the SOL fee amount.
 * Jupiter is the sole price source (Phase 0).
 */
async function getFeeInToken(inputMint, solAmountLamports) {
  const tokenInfo = TOKEN_INFO[inputMint] || { symbol: 'UNKNOWN', decimals: 6 };

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

  try {
    // Get quote: how much input token for 2x SOL (better rate estimate)
    const quote = await getQuote(inputMint, config.WSOL_MINT, solAmountLamports * 2, 100);

    const inAmount = parseInt(quote.inAmount) || 0;
    const outAmount = parseInt(quote.outAmount) || 0;

    if (outAmount === 0) {
      throw new Error('Jupiter returned zero output amount');
    }

    const inputAmount = Math.ceil((inAmount * solAmountLamports) / outAmount);

    if (inputAmount <= 0) {
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
    // Dev fallback with fixed rates
    if (config.IS_DEV) {
      let inputAmount;
      if (tokenInfo.symbol === 'USDC' || tokenInfo.symbol === 'USDT' || tokenInfo.symbol === 'PYUSD') {
        inputAmount = Math.ceil((solAmountLamports / 1e9) * 200 * Math.pow(10, tokenInfo.decimals));
      } else {
        inputAmount = Math.ceil((solAmountLamports * Math.pow(10, tokenInfo.decimals)) / 1e9);
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

async function swapToAsdf(solAmount) {
  return getQuote(config.WSOL_MINT, config.ASDF_MINT, solAmount, 100);
}

async function getTokenToSolQuote(tokenMint, tokenAmount, slippageBps = 100) {
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

async function getTokenToAsdfQuote(tokenMint, tokenAmount, slippageBps = 100) {
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
  getApiInfo: () => ({
    endpoint: JUPITER_API,
    hasApiKey: !!config.JUPITER_API_KEY,
    cache: {
      hits: cacheHits,
      misses: cacheMisses,
      hitRate:
        cacheHits + cacheMisses > 0
          ? ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(1) + '%'
          : 'N/A',
      ...redis.getJupiterCacheStats(),
    },
  }),
};
