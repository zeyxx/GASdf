// Multi-RPC failover for reliability
// Design: Primary → Secondary → Fallback with circuit breakers per endpoint

const { Connection } = require('@solana/web3.js');
const config = require('./config');
const logger = require('./logger');
const { CircuitBreaker } = require('./circuit-breaker');
const { withTimeout } = require('./fetch-timeout');

// RPC operation timeouts (prevents hanging on slow/unresponsive RPC)
const RPC_SIMULATION_TIMEOUT = 30_000;  // 30 seconds for simulation
const RPC_SEND_TIMEOUT = 15_000;        // 15 seconds for send
const RPC_QUERY_TIMEOUT = 10_000;       // 10 seconds for queries

// =============================================================================
// Rate Limit Tracking (Proactive backoff before 429)
// =============================================================================

class RateLimitTracker {
  constructor(endpointName) {
    this.endpointName = endpointName;
    this.limit = null;           // x-ratelimit-limit-requests
    this.remaining = null;       // x-ratelimit-remaining-requests
    this.resetAt = null;         // When limit resets (timestamp)
    this.lastUpdated = 0;

    // Thresholds for proactive backoff
    this.warningThreshold = 0.2;  // Start slowing at 20% remaining
    this.criticalThreshold = 0.05; // Heavy backoff at 5% remaining

    // 429 tracking (fallback when headers aren't available)
    this.recent429s = [];         // Timestamps of recent 429 errors
    this.consecutive429s = 0;     // Count of consecutive 429s
    this.last429At = null;        // Last 429 timestamp
    this.backoffUntil = null;     // Don't make requests until this time
    this.requestsSince429 = 0;    // Successful requests since last 429

    // 429 backoff configuration
    this.baseBackoffMs = 1000;    // Start with 1 second
    this.maxBackoffMs = 30000;    // Cap at 30 seconds
    this.recoveryWindow = 60000; // Forget 429s after 60 seconds of success
  }

  /**
   * Record a 429 error - triggers exponential backoff
   */
  record429() {
    const now = Date.now();
    this.recent429s.push(now);
    this.consecutive429s++;
    this.last429At = now;
    this.requestsSince429 = 0;

    // Clean old 429s (keep last 60 seconds)
    this.recent429s = this.recent429s.filter(t => now - t < this.recoveryWindow);

    // Calculate exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
    const backoffMs = Math.min(
      this.baseBackoffMs * Math.pow(2, this.consecutive429s - 1),
      this.maxBackoffMs
    );

    // Add jitter (0-20% of backoff)
    const jitter = Math.floor(Math.random() * backoffMs * 0.2);
    this.backoffUntil = now + backoffMs + jitter;

    logger.warn('RATE_LIMIT', `429 received from ${this.endpointName}`, {
      consecutive429s: this.consecutive429s,
      recent429sCount: this.recent429s.length,
      backoffMs: backoffMs + jitter,
      backoffUntil: new Date(this.backoffUntil).toISOString(),
    });
  }

  /**
   * Record a successful request - helps recovery from 429 state
   */
  recordSuccess() {
    this.requestsSince429++;

    // After enough successful requests, start recovering
    if (this.requestsSince429 >= 10 && this.consecutive429s > 0) {
      this.consecutive429s = Math.max(0, this.consecutive429s - 1);
      this.requestsSince429 = 0;

      if (this.consecutive429s === 0) {
        logger.info('RATE_LIMIT', `${this.endpointName} recovered from rate limiting`);
      }
    }

    // Clear backoff if we're past the backoff window
    if (this.backoffUntil && Date.now() > this.backoffUntil) {
      this.backoffUntil = null;
    }
  }

  update(headers) {
    // Helius rate limit headers (may not be present)
    const limit = headers.get('x-ratelimit-limit-requests') ||
                  headers.get('x-ratelimit-limit');
    const remaining = headers.get('x-ratelimit-remaining-requests') ||
                      headers.get('x-ratelimit-remaining');
    const resetSeconds = headers.get('x-ratelimit-reset-requests') ||
                         headers.get('x-ratelimit-reset');

    if (limit) this.limit = parseInt(limit, 10);
    if (remaining) this.remaining = parseInt(remaining, 10);
    if (resetSeconds) {
      const resetValue = parseFloat(resetSeconds);
      this.resetAt = resetValue > 1e9 ? resetValue * 1000 : Date.now() + (resetValue * 1000);
    }

    this.lastUpdated = Date.now();

    // Log when approaching limits (only if headers are present)
    if (this.limit && this.shouldWarn()) {
      logger.warn('RATE_LIMIT', `${this.endpointName} approaching limit`, {
        remaining: this.remaining,
        limit: this.limit,
        percentRemaining: this.getPercentRemaining(),
        resetIn: this.getResetInMs(),
      });
    }
  }

  getPercentRemaining() {
    if (!this.limit || this.remaining === null) return 1;
    return this.remaining / this.limit;
  }

  shouldWarn() {
    return this.getPercentRemaining() <= this.warningThreshold;
  }

  shouldBackoff() {
    return this.getPercentRemaining() <= this.criticalThreshold;
  }

  getResetInMs() {
    if (!this.resetAt) return 0;
    return Math.max(0, this.resetAt - Date.now());
  }

  /**
   * Check if we're in 429 backoff mode
   */
  isIn429Backoff() {
    return this.backoffUntil && Date.now() < this.backoffUntil;
  }

  /**
   * Get remaining backoff time from 429
   */
  get429BackoffRemaining() {
    if (!this.backoffUntil) return 0;
    return Math.max(0, this.backoffUntil - Date.now());
  }

  /**
   * Get recommended delay before next request
   * Now includes 429-based backoff as fallback
   */
  getBackoffDelay() {
    // Priority 1: Active 429 backoff (most important)
    const backoff429 = this.get429BackoffRemaining();
    if (backoff429 > 0) {
      return backoff429;
    }

    // Priority 2: Header-based rate limit (if available)
    const percentRemaining = this.getPercentRemaining();

    if (percentRemaining <= this.warningThreshold) {
      if (percentRemaining <= this.criticalThreshold) {
        const resetIn = this.getResetInMs();
        if (resetIn > 0 && resetIn < 5000) {
          return resetIn + 100;
        }
        return 1000;
      }

      const backoffFactor = 1 - (percentRemaining / this.warningThreshold);
      return Math.floor(100 + (backoffFactor * 400));
    }

    // Priority 3: Preventive slowdown if we've had recent 429s
    if (this.recent429s.length > 0 && this.consecutive429s > 0) {
      // Gradual slowdown: 50ms per recent 429
      return Math.min(this.recent429s.length * 50, 500);
    }

    return 0;
  }

  getStatus() {
    return {
      // Header-based tracking
      limit: this.limit,
      remaining: this.remaining,
      percentRemaining: Math.round(this.getPercentRemaining() * 100),
      resetInMs: this.getResetInMs(),
      // 429-based tracking
      consecutive429s: this.consecutive429s,
      recent429sCount: this.recent429s.length,
      isIn429Backoff: this.isIn429Backoff(),
      backoff429RemainingMs: this.get429BackoffRemaining(),
      requestsSince429: this.requestsSince429,
      // Combined
      backoffDelay: this.getBackoffDelay(),
      lastUpdated: this.lastUpdated,
    };
  }
}

// Global rate limit trackers per endpoint
const rateLimitTrackers = new Map();

function getRateLimitTracker(endpointName) {
  if (!rateLimitTrackers.has(endpointName)) {
    rateLimitTrackers.set(endpointName, new RateLimitTracker(endpointName));
  }
  return rateLimitTrackers.get(endpointName);
}

/**
 * Create a fetch wrapper that extracts rate limit headers and tracks 429s
 */
function createRateLimitAwareFetch(endpointName) {
  const tracker = getRateLimitTracker(endpointName);

  return async (url, options) => {
    // Check if we should proactively back off
    const backoffDelay = tracker.getBackoffDelay();
    if (backoffDelay > 0) {
      logger.debug('RATE_LIMIT', `Backoff for ${endpointName}`, {
        delay: backoffDelay,
        isIn429Backoff: tracker.isIn429Backoff(),
        consecutive429s: tracker.consecutive429s,
      });
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }

    // Make the actual request
    const response = await fetch(url, options);

    // Track 429 errors (fallback rate limiting)
    if (response.status === 429) {
      tracker.record429();
    } else if (response.ok) {
      tracker.recordSuccess();
    }

    // Extract and track rate limit headers (if present)
    tracker.update(response.headers);

    return response;
  };
}

// =============================================================================
// RPC Endpoint Pool
// =============================================================================

class RpcEndpoint {
  constructor(name, url, priority = 100) {
    this.name = name;
    this.url = url;
    this.priority = priority; // Lower = higher priority
    this.connection = null;

    // Health tracking
    this.health = {
      totalRequests: 0,
      successfulRequests: 0,
      lastSuccess: null,
      lastError: null,
      latencySamples: [],
      avgLatencyMs: 0,
    };

    // Circuit breaker per endpoint
    this.breaker = new CircuitBreaker({
      name: `rpc:${name}`,
      failureThreshold: 3,
      resetTimeout: 15000, // 15 seconds
      isFailure: (error) => {
        const msg = error.message?.toLowerCase() || '';
        return msg.includes('timeout') ||
               msg.includes('econnrefused') ||
               msg.includes('enotfound') ||
               msg.includes('service unavailable') ||
               msg.includes('429') ||
               msg.includes('too many requests') ||
               msg.includes('failed to fetch');
      },
    });
  }

  getConnection() {
    if (!this.connection) {
      // Use rate-limit-aware fetch for Helius endpoints
      const isHelius = this.url.includes('helius');
      const fetchFn = isHelius ? createRateLimitAwareFetch(this.name) : undefined;

      this.connection = new Connection(this.url, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 30000,
        fetch: fetchFn,
      });

      // Store tracker reference for status reporting
      if (isHelius) {
        this.rateLimitTracker = getRateLimitTracker(this.name);
      }
    }
    return this.connection;
  }

  getRateLimitStatus() {
    return this.rateLimitTracker?.getStatus() || null;
  }

  async execute(operation) {
    const startTime = Date.now();
    this.health.totalRequests++;

    try {
      const result = await this.breaker.execute(async () => {
        return await operation(this.getConnection());
      });

      // Track success
      const latency = Date.now() - startTime;
      this.trackLatency(latency);
      this.health.successfulRequests++;
      this.health.lastSuccess = Date.now();

      return result;
    } catch (error) {
      this.health.lastError = { time: Date.now(), message: error.message };
      throw error;
    }
  }

  trackLatency(latencyMs) {
    this.health.latencySamples.push(latencyMs);
    if (this.health.latencySamples.length > 50) {
      this.health.latencySamples.shift();
    }
    this.health.avgLatencyMs = Math.round(
      this.health.latencySamples.reduce((a, b) => a + b, 0) / this.health.latencySamples.length
    );
  }

  isHealthy() {
    return this.breaker.canExecute();
  }

  getStatus() {
    const successRate = this.health.totalRequests > 0
      ? ((this.health.successfulRequests / this.health.totalRequests) * 100).toFixed(1)
      : 0;

    const status = {
      name: this.name,
      url: this.url.replace(/api-key=[^&]+/, 'api-key=***'),
      priority: this.priority,
      healthy: this.isHealthy(),
      circuitState: this.breaker.state,
      successRate: `${successRate}%`,
      avgLatencyMs: this.health.avgLatencyMs,
      lastSuccess: this.health.lastSuccess,
      lastError: this.health.lastError,
    };

    // Add rate limit info for Helius endpoints
    const rateLimitStatus = this.getRateLimitStatus();
    if (rateLimitStatus) {
      status.rateLimit = rateLimitStatus;
    }

    return status;
  }
}

// =============================================================================
// RPC Pool Manager
// =============================================================================

class RpcPool {
  constructor() {
    this.endpoints = [];
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;

    // Detect mainnet from config or explicit RPC_URL
    const isMainnet = config.NETWORK === 'mainnet' ||
                      config.USE_MAINNET ||
                      (config.RPC_URL && config.RPC_URL.includes('mainnet'));
    const heliusKey = config.HELIUS_API_KEY;

    // Build endpoint list based on available config
    const endpointConfigs = [];

    // Primary: Helius (if configured)
    if (heliusKey) {
      const heliusUrl = isMainnet
        ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
        : `https://devnet.helius-rpc.com/?api-key=${heliusKey}`;
      endpointConfigs.push({ name: 'helius', url: heliusUrl, priority: 1 });
    }

    // Secondary: Custom RPC (if different from Helius)
    if (config.RPC_URL && !config.RPC_URL.includes('helius')) {
      endpointConfigs.push({ name: 'custom', url: config.RPC_URL, priority: 2 });
    }

    // Tertiary: Triton (if configured)
    if (process.env.TRITON_API_KEY) {
      const tritonUrl = isMainnet
        ? `https://mainnet.triton.one/?api-key=${process.env.TRITON_API_KEY}`
        : `https://devnet.triton.one/?api-key=${process.env.TRITON_API_KEY}`;
      endpointConfigs.push({ name: 'triton', url: tritonUrl, priority: 3 });
    }

    // Fallback: Public RPCs (always available, lowest priority)
    const publicUrl = isMainnet
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com';
    endpointConfigs.push({ name: 'public', url: publicUrl, priority: 100 });

    // Create endpoints
    for (const cfg of endpointConfigs) {
      this.endpoints.push(new RpcEndpoint(cfg.name, cfg.url, cfg.priority));
    }

    // Sort by priority
    this.endpoints.sort((a, b) => a.priority - b.priority);

    logger.info('RPC_POOL', 'Initialized', {
      endpoints: this.endpoints.map(e => e.name),
      primary: this.endpoints[0]?.name,
    });

    this.initialized = true;
  }

  getHealthyEndpoints() {
    return this.endpoints.filter(e => e.isHealthy());
  }

  getPrimaryEndpoint() {
    const healthy = this.getHealthyEndpoints();
    if (healthy.length === 0) {
      // All circuits open - force try primary anyway
      logger.warn('RPC_POOL', 'All endpoints unhealthy, forcing primary');
      return this.endpoints[0];
    }
    return healthy[0];
  }

  async executeWithFailover(operation, operationName = 'rpc_call') {
    this.initialize();

    const tried = new Set();
    let lastError = null;

    // Try endpoints in priority order
    for (const endpoint of this.endpoints) {
      if (tried.has(endpoint.name)) continue;
      if (!endpoint.isHealthy() && tried.size < this.endpoints.length - 1) {
        // Skip unhealthy unless it's our last option
        continue;
      }

      tried.add(endpoint.name);

      try {
        const result = await endpoint.execute(operation);

        if (tried.size > 1) {
          logger.info('RPC_POOL', 'Failover succeeded', {
            operation: operationName,
            endpoint: endpoint.name,
            attemptNumber: tried.size,
          });
        }

        return result;
      } catch (error) {
        lastError = error;

        logger.warn('RPC_POOL', 'Endpoint failed', {
          operation: operationName,
          endpoint: endpoint.name,
          error: error.message,
          willRetry: tried.size < this.endpoints.length,
        });

        // Continue to next endpoint
      }
    }

    // All endpoints failed
    logger.error('RPC_POOL', 'All endpoints failed', {
      operation: operationName,
      tried: Array.from(tried),
      lastError: lastError?.message,
    });

    throw lastError || new Error('All RPC endpoints failed');
  }

  getStatus() {
    this.initialize();

    const healthyCount = this.getHealthyEndpoints().length;
    const primary = this.getPrimaryEndpoint();

    return {
      status: healthyCount === 0 ? 'CRITICAL' : healthyCount < this.endpoints.length ? 'DEGRADED' : 'HEALTHY',
      totalEndpoints: this.endpoints.length,
      healthyEndpoints: healthyCount,
      primary: primary?.name,
      endpoints: this.endpoints.map(e => e.getStatus()),
    };
  }

  // Direct connection access for specific use cases
  getConnection() {
    this.initialize();
    return this.getPrimaryEndpoint().getConnection();
  }
}

// Singleton pool
const pool = new RpcPool();

// =============================================================================
// Blockhash Cache (reduces RPC calls during submit retries)
// =============================================================================

const blockhashCache = {
  data: null,        // { blockhash, lastValidBlockHeight }
  fetchedAt: 0,      // Timestamp when fetched
  ttlMs: 30_000,     // 30s TTL (blockhash valid ~60s, so 30s is safe)

  isValid() {
    return this.data && (Date.now() - this.fetchedAt) < this.ttlMs;
  },

  set(blockhashInfo) {
    this.data = blockhashInfo;
    this.fetchedAt = Date.now();
  },

  get() {
    return this.isValid() ? this.data : null;
  },

  invalidate() {
    this.data = null;
    this.fetchedAt = 0;
  },
};

// =============================================================================
// Exported Functions (backwards compatible API)
// =============================================================================

function getConnection() {
  return pool.getConnection();
}

/**
 * Get latest blockhash with 30s cache
 * Blockhash is valid for ~60s (150 slots), so 30s cache is safe
 * Reduces RPC calls significantly during submit retries
 *
 * @param {boolean} forceRefresh - Force fetch from RPC, bypassing cache
 * @returns {Promise<{blockhash: string, lastValidBlockHeight: number}>}
 */
async function getLatestBlockhash(forceRefresh = false) {
  // Return cached if valid and not forcing refresh
  if (!forceRefresh) {
    const cached = blockhashCache.get();
    if (cached) {
      logger.debug('RPC', 'Using cached blockhash', {
        age: Date.now() - blockhashCache.fetchedAt,
        blockhash: cached.blockhash.slice(0, 8),
      });
      return cached;
    }
  }

  // Fetch fresh blockhash
  const result = await pool.executeWithFailover(
    async (conn) => conn.getLatestBlockhash('confirmed'),
    'getLatestBlockhash'
  );

  // Cache it
  blockhashCache.set(result);

  return result;
}

/**
 * Invalidate blockhash cache (call after tx failure due to expired blockhash)
 */
function invalidateBlockhashCache() {
  blockhashCache.invalidate();
}

async function sendTransaction(signedTx) {
  return pool.executeWithFailover(
    async (conn) => {
      const signature = await conn.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });
      return signature;
    },
    'sendTransaction'
  );
}

async function confirmTransaction(signature, blockhash, lastValidBlockHeight) {
  return pool.executeWithFailover(
    async (conn) => {
      const result = await conn.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed'
      );
      return result;
    },
    'confirmTransaction'
  );
}

/**
 * Check if a transaction signature has been confirmed
 * Uses getSignatureStatus which doesn't require blockhash
 * This is useful for verifying tx landed after "block height exceeded" errors
 *
 * @param {string} signature - Transaction signature
 * @param {number} maxRetries - Maximum retries (default: 3)
 * @param {number} retryDelayMs - Delay between retries (default: 1000)
 * @returns {Promise<{confirmed: boolean, slot?: number, err?: any}>}
 */
async function checkSignatureStatus(signature, maxRetries = 3, retryDelayMs = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await pool.executeWithFailover(
        async (conn) => conn.getSignatureStatus(signature, { searchTransactionHistory: true }),
        'getSignatureStatus'
      );

      if (result.value) {
        // Transaction found
        const status = result.value;
        return {
          confirmed: status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized',
          slot: status.slot,
          err: status.err,
          confirmationStatus: status.confirmationStatus,
        };
      }

      // Not found yet, retry
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    } catch (error) {
      logger.debug('RPC', 'Signature status check failed', {
        signature: signature.slice(0, 12),
        attempt,
        error: error.message,
      });

      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  return { confirmed: false };
}

async function getBalance(pubkey) {
  return pool.executeWithFailover(
    async (conn) => conn.getBalance(pubkey),
    'getBalance'
  );
}

/**
 * Batch fetch balances for multiple pubkeys in a single RPC call
 * Reduces RPC calls from N to 1 for fee payer balance refresh
 *
 * @param {PublicKey[]} pubkeys - Array of public keys to fetch balances for
 * @returns {Promise<Map<string, number>>} Map of pubkey string -> balance in lamports
 */
async function getMultipleBalances(pubkeys) {
  if (!pubkeys || pubkeys.length === 0) {
    return new Map();
  }

  // Single pubkey - use regular getBalance
  if (pubkeys.length === 1) {
    const balance = await getBalance(pubkeys[0]);
    return new Map([[pubkeys[0].toBase58(), balance]]);
  }

  return pool.executeWithFailover(
    async (conn) => {
      // Build batch RPC request using getMultipleAccounts
      // This is more efficient than individual getBalance calls
      const accounts = await conn.getMultipleAccountsInfo(pubkeys, 'confirmed');

      const results = new Map();
      for (let i = 0; i < pubkeys.length; i++) {
        const pubkey = pubkeys[i].toBase58();
        const account = accounts[i];
        // Account exists: return lamports. Account doesn't exist: 0
        results.set(pubkey, account ? account.lamports : 0);
      }

      return results;
    },
    'getMultipleBalances'
  );
}

async function getTokenBalance(pubkey, mint) {
  return pool.executeWithFailover(
    async (conn) => {
      const tokenAccounts = await conn.getTokenAccountsByOwner(pubkey, { mint });
      if (tokenAccounts.value.length === 0) return 0;

      const balance = await conn.getTokenAccountBalance(tokenAccounts.value[0].pubkey);
      return parseInt(balance.value.amount);
    },
    'getTokenBalance'
  );
}

async function isBlockhashValid(blockhash) {
  try {
    const result = await pool.executeWithFailover(
      async (conn) => conn.isBlockhashValid(blockhash, { commitment: 'confirmed' }),
      'isBlockhashValid'
    );
    return result.value;
  } catch (error) {
    // If RPC fails, we can't determine validity - reject for safety
    return false;
  }
}

async function simulateTransaction(signedTx) {
  try {
    // Wrap simulation with timeout to prevent hanging on slow/unresponsive RPC
    const result = await withTimeout(
      pool.executeWithFailover(
        async (conn) => {
          return conn.simulateTransaction(signedTx, {
            sigVerify: true,
            commitment: 'confirmed',
          });
        },
        'simulateTransaction'
      ),
      RPC_SIMULATION_TIMEOUT,
      'simulateTransaction'
    );

    if (result.value.err) {
      return {
        success: false,
        error: JSON.stringify(result.value.err),
        logs: result.value.logs || [],
        unitsConsumed: result.value.unitsConsumed,
      };
    }

    return {
      success: true,
      logs: result.value.logs || [],
      unitsConsumed: result.value.unitsConsumed,
    };
  } catch (error) {
    return {
      success: false,
      error: error.code === 'TIMEOUT' ? 'Simulation timeout' : error.message,
      logs: [],
    };
  }
}

/**
 * Simulate transaction with balance change analysis (CPI Protection)
 *
 * This function detects if the fee payer's SOL or token balances change
 * unexpectedly during simulation, which could indicate:
 * - CPI attacks (malicious program calling System/Token programs)
 * - Hidden drain instructions
 * - Unauthorized transfers
 *
 * OPTIMIZED: Uses cached pre-balance from fee-payer-pool instead of separate RPC call.
 * The simulation already returns post-tx account state, so we only need 1 RPC call total.
 *
 * @param {VersionedTransaction|Transaction} signedTx - The signed transaction
 * @param {string} feePayerPubkey - The fee payer's public key
 * @param {number} expectedMaxSolChange - Maximum expected SOL decrease (tx fee, usually ~5000-10000 lamports)
 * @returns {Promise<{success: boolean, error?: string, balanceChanges?: object}>}
 */
async function simulateWithBalanceCheck(signedTx, feePayerPubkey, expectedMaxSolChange = 50000) {
  try {
    // Get cached pre-balance from fee-payer-pool (refreshed every 30s)
    // This eliminates a separate RPC call - simulation returns post-balance
    const feePayerPool = require('../services/fee-payer-pool');
    const preBalance = feePayerPool.pool.balances.get(feePayerPubkey) || 0;

    // Simulate the transaction with timeout protection
    // Prevents hanging on slow/unresponsive RPC endpoints
    const result = await withTimeout(
      pool.executeWithFailover(
        async (c) => {
          return c.simulateTransaction(signedTx, {
            sigVerify: true,
            commitment: 'confirmed',
            accounts: {
              encoding: 'base64',
              addresses: [feePayerPubkey],
            },
          });
        },
        'simulateWithBalanceCheck'
      ),
      RPC_SIMULATION_TIMEOUT,
      'simulateWithBalanceCheck'
    );

    if (result.value.err) {
      return {
        success: false,
        error: JSON.stringify(result.value.err),
        logs: result.value.logs || [],
        unitsConsumed: result.value.unitsConsumed,
      };
    }

    // Analyze balance changes from simulation
    const accounts = result.value.accounts || [];
    let postBalance = preBalance; // Default to no change if not returned

    if (accounts.length > 0 && accounts[0]) {
      const accountData = accounts[0];
      // Account data includes lamports field
      if (accountData.lamports !== undefined) {
        postBalance = accountData.lamports;
      }
    }

    const solChange = preBalance - postBalance;

    // Check if SOL decreased more than expected (transaction fee)
    // Normal tx fee is ~5000 lamports, allow some buffer
    if (solChange > expectedMaxSolChange) {
      logger.warn('RPC', 'CPI drain detected in simulation', {
        feePayerPubkey: feePayerPubkey.slice(0, 8),
        preBalance,
        postBalance,
        solChange,
        expectedMaxChange: expectedMaxSolChange,
      });

      return {
        success: false,
        error: `Suspicious SOL drain detected: ${solChange} lamports (expected max ${expectedMaxSolChange})`,
        logs: result.value.logs || [],
        unitsConsumed: result.value.unitsConsumed,
        balanceChanges: {
          sol: {
            pre: preBalance,
            post: postBalance,
            change: -solChange,
          },
        },
        securityViolation: 'CPI_DRAIN_DETECTED',
      };
    }

    return {
      success: true,
      logs: result.value.logs || [],
      unitsConsumed: result.value.unitsConsumed,
      balanceChanges: {
        sol: {
          pre: preBalance,
          post: postBalance,
          change: -solChange,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error.code === 'TIMEOUT' ? 'Simulation timeout' : error.message,
      logs: [],
    };
  }
}

// Health check for /health endpoint
function getRpcHealth() {
  return pool.getStatus();
}

/**
 * Get rate limit status for all tracked endpoints
 */
function getRateLimitStatus() {
  const status = {};
  for (const [name, tracker] of rateLimitTrackers) {
    status[name] = tracker.getStatus();
  }
  return status;
}

module.exports = {
  getConnection,
  getLatestBlockhash,
  invalidateBlockhashCache,
  sendTransaction,
  confirmTransaction,
  checkSignatureStatus,
  getBalance,
  getMultipleBalances,
  getTokenBalance,
  isBlockhashValid,
  simulateTransaction,
  simulateWithBalanceCheck,
  getRpcHealth,
  getRateLimitStatus,

  // Expose pool for advanced use cases
  pool,
};
