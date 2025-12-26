const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../utils/config');

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

module.exports = {
  securityHeaders,
  globalLimiter,
  quoteLimiter,
  submitLimiter,
  scoreLimiter,
};
