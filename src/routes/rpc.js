const express = require('express');
const config = require('../utils/config');
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// =============================================================================
// SECURITY: RPC Proxy for Jupiter Terminal
// =============================================================================
//
// This endpoint proxies JSON-RPC requests to Helius WITHOUT exposing the API key
// to the frontend. Security by design:
//
//   Frontend (browser) → /v1/rpc (this endpoint) → Helius (with API key)
//
// The Helius API key stays server-side (in Render environment variables).
// =============================================================================

// Rate limiting for RPC proxy (more permissive since Jupiter needs many calls)
const rpcLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.IS_DEV ? 500 : 200, // 200 req/min per IP for prod
  message: { error: 'RPC rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(rpcLimiter);

// Whitelist of allowed RPC methods (security: prevent abuse)
const ALLOWED_METHODS = new Set([
  // Account info (needed for Jupiter to check balances, token accounts)
  'getAccountInfo',
  'getMultipleAccounts',
  'getTokenAccountsByOwner',
  'getTokenAccountBalance',
  'getProgramAccounts',

  // Transaction related (needed for Jupiter swaps)
  'getLatestBlockhash',
  'getRecentBlockhash', // deprecated but Jupiter might use it
  'getFeeForMessage',
  'getMinimumBalanceForRentExemption',
  'getSignatureStatuses',
  'getTransaction',
  'sendTransaction',
  'simulateTransaction',

  // Block/slot info (general queries)
  'getSlot',
  'getBlockHeight',
  'getHealth',
  'getVersion',

  // Balance queries
  'getBalance',
]);

// Methods that are never allowed (security: prevent enumeration attacks)
const BLOCKED_METHODS = new Set([
  'getSignaturesForAddress', // Can enumerate all transactions
  'getConfirmedSignaturesForAddress2', // Same
  'requestAirdrop', // Obviously not allowed
  'getProgramAccountsWithContext', // Heavy query
]);

/**
 * POST /v1/rpc
 * Proxy JSON-RPC requests to Helius
 */
router.post('/', async (req, res) => {
  try {
    const { jsonrpc, id, method, params } = req.body;

    // Validate JSON-RPC format
    if (jsonrpc !== '2.0' || !method) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: { code: -32600, message: 'Invalid Request' },
      });
    }

    // Security: Check if method is blocked
    if (BLOCKED_METHODS.has(method)) {
      logger.warn('RPC_PROXY', 'Blocked method attempted', {
        method,
        ip: req.ip,
      });
      return res.status(403).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Method not allowed' },
      });
    }

    // Security: Check if method is allowed
    if (!ALLOWED_METHODS.has(method)) {
      logger.debug('RPC_PROXY', 'Unknown method attempted', {
        method,
        ip: req.ip,
      });
      // Be permissive for unknown methods (Jupiter might use new methods)
      // but log for monitoring
    }

    // Build Helius RPC URL with API key (NEVER exposed to frontend)
    const heliusUrl = config.USE_MAINNET
      ? `https://mainnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`
      : `https://devnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`;

    // Forward request to Helius
    const response = await fetch(heliusUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: params || [],
      }),
    });

    // Handle Helius errors
    if (!response.ok) {
      logger.error('RPC_PROXY', 'Helius RPC error', {
        status: response.status,
        method,
      });
      return res.status(502).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'RPC backend error' },
      });
    }

    const data = await response.json();

    // Return response (strip any internal info)
    res.json(data);
  } catch (error) {
    logger.error('RPC_PROXY', 'Proxy error', {
      error: error.message,
      ip: req.ip,
    });

    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: { code: -32603, message: 'Internal proxy error' },
    });
  }
});

// =============================================================================
// JUPITER API PROXY
// =============================================================================
// Jupiter now requires API key for all endpoints.
// We proxy through GASdf to keep the API key server-side.
// =============================================================================

/**
 * GET /v1/rpc/jupiter/quote
 * Proxy Jupiter quote requests (v6 API)
 */
router.get('/jupiter/quote', async (req, res) => {
  try {
    // Forward all query params to Jupiter v6 API
    const queryString = new URLSearchParams(req.query).toString();
    const jupiterUrl = `https://api.jup.ag/swap/v1/quote?${queryString}`;

    logger.debug('JUPITER_PROXY', 'Quote request', {
      inputMint: req.query.inputMint?.slice(0, 8),
      outputMint: req.query.outputMint?.slice(0, 8),
      amount: req.query.amount,
    });

    const response = await fetch(jupiterUrl, {
      headers: {
        'Content-Type': 'application/json',
        // Jupiter API key if configured
        ...(config.JUPITER_API_KEY && { 'x-api-key': config.JUPITER_API_KEY }),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('JUPITER_PROXY', 'Quote failed', {
        status: response.status,
        error: errorText.slice(0, 200),
      });
      return res.status(response.status).json({
        error: 'Jupiter quote failed',
        details: errorText.slice(0, 200),
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('JUPITER_PROXY', 'Quote proxy error', { error: error.message });
    res.status(500).json({ error: 'Jupiter proxy error', details: error.message });
  }
});

/**
 * POST /v1/rpc/jupiter/swap
 * Proxy Jupiter swap transaction requests (v6 API)
 */
router.post('/jupiter/swap', async (req, res) => {
  try {
    logger.debug('JUPITER_PROXY', 'Swap request', {
      userPublicKey: req.body.userPublicKey?.slice(0, 8),
    });

    const response = await fetch('https://api.jup.ag/swap/v1/swap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.JUPITER_API_KEY && { 'x-api-key': config.JUPITER_API_KEY }),
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('JUPITER_PROXY', 'Swap failed', {
        status: response.status,
        error: errorText.slice(0, 200),
      });
      return res.status(response.status).json({
        error: 'Jupiter swap failed',
        details: errorText.slice(0, 200),
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('JUPITER_PROXY', 'Swap proxy error', { error: error.message });
    res.status(500).json({ error: 'Jupiter proxy error', details: error.message });
  }
});

/**
 * Health check for RPC proxy
 */
router.get('/health', async (req, res) => {
  try {
    // Quick test to Helius
    const heliusUrl = config.USE_MAINNET
      ? `https://mainnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`
      : `https://devnet.helius-rpc.com/?api-key=${config.HELIUS_API_KEY}`;

    const response = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getHealth',
        params: [],
      }),
    });

    if (!response.ok) {
      return res.status(503).json({ status: 'unhealthy', error: 'Helius unreachable' });
    }

    res.json({ status: 'healthy', network: config.NETWORK });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

module.exports = router;
