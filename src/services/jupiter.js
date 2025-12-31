const config = require('../utils/config');
const { jupiterBreaker } = require('../utils/circuit-breaker');
const { safeProportion, safeCeil, clamp } = require('../utils/safe-math');
const { fetchWithTimeout, JUPITER_TIMEOUT } = require('../utils/fetch-timeout');

const JUPITER_API = 'https://api.jup.ag/swap/v1';

// Common token info (avoid extra API calls)
const TOKEN_INFO = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9 },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6 },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', decimals: 6 },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', decimals: 9 },
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { symbol: 'jitoSOL', decimals: 9 },
  '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump': { symbol: '$ASDF', decimals: 6 },
};

async function getQuote(inputMint, outputMint, amount, slippageBps = 50) {
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
      {},
      JUPITER_TIMEOUT
    );

    if (!response.ok) {
      throw new Error(`Jupiter quote failed: ${response.statusText}`);
    }

    return response.json();
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
        headers: { 'Content-Type': 'application/json' },
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
    };
  }

  try {
    // Get quote: how much input token for X SOL
    const quote = await getQuote(
      inputMint,
      config.WSOL_MINT,
      solAmountLamports * 2, // Get quote for 2x to find rate, we'll calculate actual
      100
    );

    // ==========================================================================
    // NUMERIC PRECISION: Safe proportional calculation with zero-division check
    // ==========================================================================
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
    };
  } catch (error) {
    // Fallback for devnet or when Jupiter is unavailable
    // Use approximate rates for known stablecoins
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
        simulated: true,
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
};
