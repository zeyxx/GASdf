const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../utils/config');
const redis = require('../utils/redis');
const logger = require('../utils/logger');

// Security headers
const securityHeaders = helmet({
  contentSecurityPolicy: config.IS_DEV ? false : undefined,
  crossOriginEmbedderPolicy: false,
});

// Normalize IPv6 addresses to prevent bypass attacks
// Maps ::ffff:127.0.0.1 (IPv6-mapped IPv4) to 127.0.0.1
function normalizeIp(ip) {
  if (!ip) return 'unknown';
  // Handle IPv6-mapped IPv4 addresses
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

// Common rate limiter options
const commonOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  // Disable validation warnings - we handle IPv6 normalization ourselves
  validate: {
    xForwardedForHeader: false,
    trustProxy: false,
    // Disable IPv6 key generator warning - we normalize IPs in our keyGenerator
    default: false,
  },
  keyGenerator: (req) => normalizeIp(req.ip),
};

// Rate limiters
const globalLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 1000, // 1 minute
  max: config.IS_DEV ? 1000 : 100, // 100 req/min in prod
  message: { error: 'Too many requests, slow down' },
});

const quoteLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 1000,
  max: config.IS_DEV ? 100 : 30, // 30 quotes/min per IP
  message: { error: 'Quote rate limit exceeded' },
});

const submitLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 1000,
  max: config.IS_DEV ? 50 : 10, // 10 submits/min per IP
  message: { error: 'Submit rate limit exceeded' },
});

// Stricter limit for token score lookups (potential oracle abuse vector)
const scoreLimiter = rateLimit({
  ...commonOptions,
  windowMs: 60 * 1000,
  max: config.IS_DEV ? 100 : 20, // 20 score lookups/min per IP
  message: { error: 'Score lookup rate limit exceeded' },
});

// =============================================================================
// Per-Wallet Rate Limiting (in addition to IP-based)
// =============================================================================

/**
 * Middleware factory for wallet-based rate limiting
 * Applies AFTER IP-based rate limiting for defense in depth
 */
function createWalletLimiter(type, limit) {
  return async (req, res, next) => {
    const wallet = req.body?.userPubkey;

    // Skip if no wallet in request (will fail validation anyway)
    if (!wallet) {
      return next();
    }

    try {
      const count = await redis.incrWalletRateLimit(wallet, type);

      // Add rate limit headers for transparency
      res.setHeader('X-Wallet-RateLimit-Limit', limit);
      res.setHeader('X-Wallet-RateLimit-Remaining', Math.max(0, limit - count));

      if (count > limit) {
        logger.warn('SECURITY', 'Wallet rate limit exceeded', {
          wallet: wallet.slice(0, 8) + '...',
          type,
          count,
          limit,
          ip: normalizeIp(req.ip),
        });

        return res.status(429).json({
          error: `Wallet rate limit exceeded (${limit}/${type === 'quote' ? 'quotes' : 'submits'} per minute)`,
          code: 'WALLET_RATE_LIMITED',
          retryAfter: 60,
        });
      }

      next();
    } catch (error) {
      // On Redis error, log but allow request (fail open for availability)
      // IP-based rate limiting still provides protection
      logger.error('SECURITY', 'Wallet rate limit check failed', {
        error: error.message,
        wallet: wallet.slice(0, 8) + '...',
      });
      next();
    }
  };
}

// Create wallet limiters with configured limits
const walletQuoteLimiter = createWalletLimiter('quote', config.WALLET_QUOTE_LIMIT);
const walletSubmitLimiter = createWalletLimiter('submit', config.WALLET_SUBMIT_LIMIT);

module.exports = {
  securityHeaders,
  globalLimiter,
  quoteLimiter,
  submitLimiter,
  scoreLimiter,
  // Wallet-based rate limiting
  walletQuoteLimiter,
  walletSubmitLimiter,
};
