/**
 * HolDex Integration Service
 * Verifies community tokens via HolDex API
 *
 * Major tokens (SOL, USDC, USDT, $ASDF) are always allowed.
 * Community tokens require HolDex verification (hasCommunityUpdate = true).
 */
const config = require('../utils/config');
const { logger } = require('../utils/logger');
const { fetchWithTimeout } = require('../utils/fetch-timeout');

// Major tokens always allowed without verification
const ALLOWED_TOKENS = {
  // Wrapped SOL
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', reason: 'Native token' },
  // USDC (mainnet)
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', reason: 'Major stablecoin' },
  // USDT (mainnet)
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', reason: 'Major stablecoin' },
  // mSOL (Marinade staked SOL)
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', reason: 'Liquid staking' },
  // jitoSOL (Jito staked SOL)
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { symbol: 'jitoSOL', reason: 'Liquid staking' },
};

// Verification cache: mint -> { verified: boolean, timestamp: number, data: object }
const verificationCache = new Map();

/**
 * Check if a token is in the always-allowed list
 * @param {string} mint - Token mint address
 * @returns {boolean}
 */
function isAlwaysAllowed(mint) {
  return (
    mint === config.WSOL_MINT ||
    mint === config.ASDF_MINT ||
    ALLOWED_TOKENS[mint] !== undefined
  );
}

/**
 * Get info about an always-allowed token
 * @param {string} mint - Token mint address
 * @returns {Object|null}
 */
function getAllowedTokenInfo(mint) {
  if (mint === config.WSOL_MINT) {
    return { symbol: 'SOL', reason: 'Native token' };
  }
  if (mint === config.ASDF_MINT) {
    return { symbol: '$ASDF', reason: 'Ecosystem token' };
  }
  return ALLOWED_TOKENS[mint] || null;
}

/**
 * Check if a token is verified on HolDex
 * @param {string} mint - Token mint address
 * @returns {Promise<{verified: boolean, token: object|null, error: string|null}>}
 */
async function isVerified(mint) {
  if (!mint) {
    return { verified: false, token: null, error: 'Missing mint address' };
  }

  // Check cache first
  const cached = verificationCache.get(mint);
  if (cached && Date.now() - cached.timestamp < config.HOLDEX_CACHE_TTL) {
    return { verified: cached.verified, token: cached.data, error: null };
  }

  try {
    const response = await fetchWithTimeout(
      `${config.HOLDEX_API_URL}/api/token/${mint}`,
      { headers: { 'Accept': 'application/json' } },
      5000 // 5 second timeout
    );

    if (!response.ok) {
      if (response.status === 404) {
        // Token not found on HolDex
        verificationCache.set(mint, { verified: false, timestamp: Date.now(), data: null });
        return { verified: false, token: null, error: 'Token not listed on HolDex' };
      }
      throw new Error(`HolDex API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success || !data.token) {
      verificationCache.set(mint, { verified: false, timestamp: Date.now(), data: null });
      return { verified: false, token: null, error: 'Invalid response from HolDex' };
    }

    const token = data.token;
    const verified = token.hasCommunityUpdate === true || token.hascommunityupdate === true;

    // Cache the result
    verificationCache.set(mint, {
      verified,
      timestamp: Date.now(),
      data: {
        mint: token.mint,
        name: token.name,
        ticker: token.ticker,
        kScore: token.k_score || token.kScore || 0,
        hasCommunityUpdate: verified,
      },
    });

    logger.debug('[HOLDEX] Verification check', {
      mint: mint.substring(0, 8) + '...',
      verified,
      kScore: token.k_score || 0,
    });

    return {
      verified,
      token: verificationCache.get(mint).data,
      error: verified ? null : 'Community not verified on HolDex',
    };
  } catch (error) {
    logger.warn('[HOLDEX] Verification check failed', {
      mint: mint.substring(0, 8) + '...',
      error: error.message,
    });

    // In dev mode, allow bypass for testing
    if (config.IS_DEV) {
      logger.warn('[HOLDEX] Dev mode: bypassing verification');
      return { verified: true, token: null, error: null };
    }

    return { verified: false, token: null, error: `HolDex unavailable: ${error.message}` };
  }
}

/**
 * Express middleware to require HolDex verification
 * Checks the paymentToken in request body
 *
 * Always allowed: SOL, USDC, USDT, mSOL, jitoSOL, $ASDF
 * Community tokens: require HolDex verification
 */
function requireVerified(req, res, next) {
  const paymentToken = req.body?.paymentToken;

  if (!paymentToken) {
    return res.status(400).json({
      success: false,
      error: 'Missing paymentToken',
    });
  }

  // Skip verification for always-allowed tokens (SOL, USDC, USDT, $ASDF, etc.)
  if (isAlwaysAllowed(paymentToken)) {
    const tokenInfo = getAllowedTokenInfo(paymentToken);
    logger.debug('[HOLDEX] Token always allowed', {
      mint: paymentToken.slice(0, 8) + '...',
      symbol: tokenInfo?.symbol,
    });
    return next();
  }

  // Community tokens require HolDex verification
  isVerified(paymentToken).then((result) => {
    if (result.verified) {
      req.holdexToken = result.token;
      return next();
    }

    logger.info('[HOLDEX] Verification rejected', {
      mint: paymentToken.substring(0, 8) + '...',
      reason: result.error,
    });

    return res.status(403).json({
      success: false,
      error: result.error || 'Token not verified on HolDex',
      code: 'HOLDEX_NOT_VERIFIED',
    });
  }).catch((error) => {
    logger.error('[HOLDEX] Middleware error', { error: error.message });
    return res.status(503).json({
      success: false,
      error: 'HolDex verification unavailable',
    });
  });
}

/**
 * Clear verification cache (for testing)
 */
function clearCache() {
  verificationCache.clear();
}

module.exports = {
  isVerified,
  requireVerified,
  clearCache,
  isAlwaysAllowed,
  getAllowedTokenInfo,
  ALLOWED_TOKENS,
};
