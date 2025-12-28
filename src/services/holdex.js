/**
 * HolDex Integration Service
 * Verifies community tokens via HolDex API
 *
 * Only HolDex-verified communities can use GASdf services.
 * This ensures quality control and prevents spam/abuse.
 */
const config = require('../utils/config');
const { logger } = require('../utils/logger');
const { fetchWithTimeout } = require('../utils/fetch-timeout');

// Verification cache: mint -> { verified: boolean, timestamp: number, data: object }
const verificationCache = new Map();

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
 */
function requireVerified(req, res, next) {
  const paymentToken = req.body?.paymentToken;

  if (!paymentToken) {
    return res.status(400).json({
      success: false,
      error: 'Missing paymentToken',
    });
  }

  // Skip verification for SOL payments (always allowed)
  if (paymentToken === config.WSOL_MINT) {
    return next();
  }

  // Skip verification for $ASDF (native token, always allowed)
  if (paymentToken === config.ASDF_MINT) {
    return next();
  }

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
};
