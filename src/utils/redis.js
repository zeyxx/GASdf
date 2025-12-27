const { createClient } = require('redis');
const config = require('./config');
const logger = require('./logger');

let client = null;
let useMemory = false;
let connectionState = 'disconnected'; // disconnected, connecting, connected, error

// In-memory fallback for local development ONLY
const memoryStore = {
  data: new Map(),
  get(key) {
    const item = this.data.get(key);
    if (!item) return null;
    if (item.expiry && Date.now() > item.expiry) {
      this.data.delete(key);
      return null;
    }
    return item.value;
  },
  set(key, value, ttlSeconds = null) {
    this.data.set(key, {
      value,
      expiry: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  },
  del(key) {
    this.data.delete(key);
  },
  clear() {
    this.data.clear();
  },
};

/**
 * Initialize Redis client with proper reconnection strategy
 */
async function initializeClient() {
  if (client && client.isOpen) {
    return client;
  }

  connectionState = 'connecting';

  try {
    client = createClient({
      url: config.REDIS_URL,
      socket: {
        connectTimeout: 5000,
        // Staging/Production: aggressive reconnect
        // Development: limited retries then fallback
        reconnectStrategy: (retries) => {
          if (config.IS_STAGING || config.IS_PROD) {
            // Staging/Production: always reconnect with exponential backoff (max 30s)
            const delay = Math.min(retries * 100, 30000);
            logger.warn('REDIS', `Reconnecting in ${delay}ms (attempt ${retries})`);
            return delay;
          } else {
            // Development: try 3 times then give up
            if (retries >= 3) {
              logger.warn('REDIS', 'Max retries reached, using in-memory fallback');
              return false; // Stop retrying
            }
            return Math.min(retries * 100, 3000);
          }
        },
      },
    });

    client.on('error', (err) => {
      connectionState = 'error';
      if (config.IS_STAGING || config.IS_PROD) {
        // Staging/Production: log error, reconnection will be handled by strategy
        logger.error('REDIS', 'Redis connection error', { error: err.message });
      } else if (!useMemory) {
        // Development: fallback to memory
        logger.warn('REDIS', 'Redis unavailable, using in-memory store');
        useMemory = true;
      }
    });

    client.on('connect', () => {
      connectionState = 'connecting';
      logger.info('REDIS', 'Redis connecting...');
    });

    client.on('ready', () => {
      connectionState = 'connected';
      useMemory = false; // Switch back to Redis if we were using memory
      logger.info('REDIS', 'Redis connected and ready');
    });

    client.on('end', () => {
      connectionState = 'disconnected';
      logger.warn('REDIS', 'Redis connection closed');
    });

    client.on('reconnecting', () => {
      connectionState = 'connecting';
      logger.info('REDIS', 'Redis reconnecting...');
    });

    await client.connect();
    connectionState = 'connected';
    return client;
  } catch (err) {
    connectionState = 'error';

    if (config.IS_STAGING || config.IS_PROD) {
      // Staging/Production: Redis is REQUIRED - throw error
      logger.error('REDIS', 'Redis connection failed - REQUIRED in staging/production', {
        error: err.message,
        url: config.REDIS_URL?.replace(/\/\/.*@/, '//***@'), // Mask credentials
      });
      throw new Error('Redis connection required in staging/production');
    }

    // Development only: fallback to in-memory
    logger.warn('REDIS', 'Redis unavailable, using in-memory store (dev only)');
    useMemory = true;
    return null;
  }
}

/**
 * Get Redis client, initializing if needed
 */
async function getClient() {
  if (useMemory) return null;

  if (client && client.isOpen) {
    return client;
  }

  return initializeClient();
}

/**
 * Check if Redis is connected
 */
function isConnected() {
  if (useMemory && config.IS_DEV) {
    return true; // In-memory is "connected" in dev
  }
  return client && client.isOpen && connectionState === 'connected';
}

/**
 * Get connection state for health checks
 */
function getConnectionState() {
  return {
    state: connectionState,
    isMemoryFallback: useMemory,
    isHealthy: isConnected(),
  };
}

/**
 * Ping Redis to verify connection
 */
async function ping() {
  if (useMemory) {
    return config.IS_DEV ? 'PONG (memory)' : null;
  }

  try {
    const redis = await getClient();
    if (redis) {
      return await redis.ping();
    }
    return null;
  } catch {
    return null;
  }
}

// Helper to safely execute Redis operations with fallback
async function withRedis(operation, fallbackOperation) {
  if (useMemory) {
    return fallbackOperation();
  }

  try {
    const redis = await getClient();
    if (redis) {
      return await operation(redis);
    }

    // No Redis available
    if (config.IS_STAGING || config.IS_PROD) {
      throw new Error('Redis connection required in staging/production');
    }
    return fallbackOperation();
  } catch (err) {
    if (config.IS_STAGING || config.IS_PROD) {
      throw err; // Re-throw in staging/production
    }
    // Development fallback
    logger.warn('REDIS', 'Operation failed, using fallback', { error: err.message });
    return fallbackOperation();
  }
}

async function setQuote(quoteId, data, ttlSeconds = config.QUOTE_TTL_SECONDS) {
  return withRedis(
    async (redis) => {
      await redis.setEx(`quote:${quoteId}`, ttlSeconds, JSON.stringify(data));
    },
    () => {
      memoryStore.set(`quote:${quoteId}`, JSON.stringify(data), ttlSeconds);
    }
  );
}

async function getQuote(quoteId) {
  return withRedis(
    async (redis) => {
      const data = await redis.get(`quote:${quoteId}`);
      return data ? JSON.parse(data) : null;
    },
    () => {
      const data = memoryStore.get(`quote:${quoteId}`);
      return data ? JSON.parse(data) : null;
    }
  );
}

async function deleteQuote(quoteId) {
  return withRedis(
    async (redis) => {
      await redis.del(`quote:${quoteId}`);
    },
    () => {
      memoryStore.del(`quote:${quoteId}`);
    }
  );
}

async function incrBurnTotal(amount) {
  return withRedis(
    async (redis) => {
      return redis.incrByFloat('stats:burn_total', amount);
    },
    () => {
      const current = parseFloat(memoryStore.get('stats:burn_total')) || 0;
      memoryStore.set('stats:burn_total', String(current + amount));
      return current + amount;
    }
  );
}

async function incrTxCount() {
  return withRedis(
    async (redis) => {
      return redis.incr('stats:tx_count');
    },
    () => {
      const current = parseInt(memoryStore.get('stats:tx_count')) || 0;
      memoryStore.set('stats:tx_count', String(current + 1));
      return current + 1;
    }
  );
}

async function getStats() {
  return withRedis(
    async (redis) => {
      const [burnTotal, txCount] = await Promise.all([
        redis.get('stats:burn_total'),
        redis.get('stats:tx_count'),
      ]);
      return {
        burnTotal: parseFloat(burnTotal) || 0,
        txCount: parseInt(txCount) || 0,
      };
    },
    () => ({
      burnTotal: parseFloat(memoryStore.get('stats:burn_total')) || 0,
      txCount: parseInt(memoryStore.get('stats:tx_count')) || 0,
    })
  );
}

async function addPendingSwap(amount) {
  return withRedis(
    async (redis) => {
      return redis.incrByFloat('pending:swap_amount', amount);
    },
    () => {
      const current = parseFloat(memoryStore.get('pending:swap_amount')) || 0;
      memoryStore.set('pending:swap_amount', String(current + amount));
      return current + amount;
    }
  );
}

async function getPendingSwapAmount() {
  return withRedis(
    async (redis) => {
      const amount = await redis.get('pending:swap_amount');
      return parseFloat(amount) || 0;
    },
    () => parseFloat(memoryStore.get('pending:swap_amount')) || 0
  );
}

async function resetPendingSwap() {
  return withRedis(
    async (redis) => {
      return redis.set('pending:swap_amount', '0');
    },
    () => {
      memoryStore.set('pending:swap_amount', '0');
    }
  );
}

// =============================================================================
// Treasury (80/20 model)
// =============================================================================

async function incrTreasuryTotal(amount) {
  return withRedis(
    async (redis) => {
      return redis.incrByFloat('stats:treasury_total', amount);
    },
    () => {
      const current = parseFloat(memoryStore.get('stats:treasury_total')) || 0;
      memoryStore.set('stats:treasury_total', String(current + amount));
      return current + amount;
    }
  );
}

async function getTreasuryBalance() {
  return withRedis(
    async (redis) => {
      const amount = await redis.get('stats:treasury_total');
      return parseFloat(amount) || 0;
    },
    () => parseFloat(memoryStore.get('stats:treasury_total')) || 0
  );
}

async function recordTreasuryEvent(event) {
  const entry = {
    ...event,
    timestamp: Date.now(),
  };

  return withRedis(
    async (redis) => {
      // Keep last 100 treasury events
      await redis.lPush('treasury:history', JSON.stringify(entry));
      await redis.lTrim('treasury:history', 0, 99);
    },
    () => {
      // In-memory: just log
    }
  );
}

async function getTreasuryHistory(limit = 20) {
  return withRedis(
    async (redis) => {
      const history = await redis.lRange('treasury:history', 0, limit - 1);
      return history.map(h => JSON.parse(h));
    },
    () => []
  );
}

/**
 * Graceful shutdown
 */
async function disconnect() {
  if (client && client.isOpen) {
    await client.quit();
    logger.info('REDIS', 'Redis disconnected gracefully');
  }
  connectionState = 'disconnected';
}

// =============================================================================
// Anti-Replay Protection
// =============================================================================

// TTL for transaction hashes: ~90 seconds (blockhash validity window)
const TX_HASH_TTL_SECONDS = 90;

/**
 * Check if a transaction hash has been seen before (anti-replay)
 * Returns true if hash exists (transaction already submitted)
 */
async function hasTransactionHash(txHash) {
  return withRedis(
    async (redis) => {
      const exists = await redis.exists(`txhash:${txHash}`);
      return exists === 1;
    },
    () => {
      return memoryStore.get(`txhash:${txHash}`) !== null;
    }
  );
}

/**
 * Mark a transaction hash as submitted (anti-replay)
 */
async function markTransactionHash(txHash) {
  return withRedis(
    async (redis) => {
      await redis.setEx(`txhash:${txHash}`, TX_HASH_TTL_SECONDS, '1');
    },
    () => {
      memoryStore.set(`txhash:${txHash}`, '1', TX_HASH_TTL_SECONDS);
    }
  );
}

// =============================================================================
// Per-Wallet Rate Limiting
// =============================================================================

const WALLET_RATE_WINDOW_SECONDS = 60; // 1 minute window

/**
 * Increment and get wallet request count for rate limiting
 * Returns current count after increment
 */
async function incrWalletRateLimit(wallet, type = 'quote') {
  const key = `ratelimit:wallet:${type}:${wallet}`;

  return withRedis(
    async (redis) => {
      const multi = redis.multi();
      multi.incr(key);
      multi.expire(key, WALLET_RATE_WINDOW_SECONDS);
      const results = await multi.exec();
      return results[0]; // incr result
    },
    () => {
      const current = parseInt(memoryStore.get(key)) || 0;
      memoryStore.set(key, String(current + 1), WALLET_RATE_WINDOW_SECONDS);
      return current + 1;
    }
  );
}

/**
 * Get current wallet rate limit count
 */
async function getWalletRateLimit(wallet, type = 'quote') {
  const key = `ratelimit:wallet:${type}:${wallet}`;

  return withRedis(
    async (redis) => {
      const count = await redis.get(key);
      return parseInt(count) || 0;
    },
    () => {
      return parseInt(memoryStore.get(key)) || 0;
    }
  );
}

// =============================================================================
// Audit Logging
// =============================================================================

const AUDIT_KEY = 'audit:log';
const AUDIT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days retention
const MAX_AUDIT_ENTRIES = 10000;

/**
 * Append audit events to the log
 */
async function appendAuditLog(events) {
  if (!events || events.length === 0) return;

  return withRedis(
    async (redis) => {
      const serialized = events.map(e => JSON.stringify(e));
      await redis.lPush(AUDIT_KEY, ...serialized);
      await redis.lTrim(AUDIT_KEY, 0, MAX_AUDIT_ENTRIES - 1);
      await redis.expire(AUDIT_KEY, AUDIT_TTL_SECONDS);
    },
    () => {
      // In-memory: just log (no persistence)
    }
  );
}

/**
 * Get recent audit log entries
 */
async function getAuditLog(limit = 100, offset = 0) {
  return withRedis(
    async (redis) => {
      const entries = await redis.lRange(AUDIT_KEY, offset, offset + limit - 1);
      return entries.map(e => JSON.parse(e));
    },
    () => []
  );
}

/**
 * Search audit log by event type
 */
async function searchAuditLog(eventType, limit = 100) {
  return withRedis(
    async (redis) => {
      // Get all entries and filter (not efficient for large logs, but simple)
      const entries = await redis.lRange(AUDIT_KEY, 0, 999);
      return entries
        .map(e => JSON.parse(e))
        .filter(e => e.type === eventType)
        .slice(0, limit);
    },
    () => []
  );
}

// =============================================================================
// Wallet Burn Tracking (CCM-aligned)
// =============================================================================

/**
 * Increment wallet's lifetime burn contribution
 */
async function incrWalletBurn(wallet, amount) {
  return withRedis(
    async (redis) => {
      const multi = redis.multi();
      // Increment wallet's total burn
      multi.incrByFloat(`burn:wallet:${wallet}`, amount);
      // Increment wallet's tx count
      multi.incr(`burn:wallet:txcount:${wallet}`);
      // Add to sorted set for leaderboard (score = total burned)
      multi.zIncrBy('burn:leaderboard', amount, wallet);
      const results = await multi.exec();
      return {
        totalBurned: results[0],
        txCount: results[1],
      };
    },
    () => {
      const current = parseFloat(memoryStore.get(`burn:wallet:${wallet}`)) || 0;
      const txCount = parseInt(memoryStore.get(`burn:wallet:txcount:${wallet}`)) || 0;
      memoryStore.set(`burn:wallet:${wallet}`, String(current + amount));
      memoryStore.set(`burn:wallet:txcount:${wallet}`, String(txCount + 1));
      return { totalBurned: current + amount, txCount: txCount + 1 };
    }
  );
}

/**
 * Get wallet's burn statistics
 */
async function getWalletBurnStats(wallet) {
  return withRedis(
    async (redis) => {
      const [totalBurned, txCount, rank] = await Promise.all([
        redis.get(`burn:wallet:${wallet}`),
        redis.get(`burn:wallet:txcount:${wallet}`),
        redis.zRevRank('burn:leaderboard', wallet),
      ]);
      return {
        wallet,
        totalBurned: parseFloat(totalBurned) || 0,
        txCount: parseInt(txCount) || 0,
        rank: rank !== null ? rank + 1 : null, // 1-indexed
      };
    },
    () => ({
      wallet,
      totalBurned: parseFloat(memoryStore.get(`burn:wallet:${wallet}`)) || 0,
      txCount: parseInt(memoryStore.get(`burn:wallet:txcount:${wallet}`)) || 0,
      rank: null,
    })
  );
}

/**
 * Get burn leaderboard (top contributors)
 */
async function getBurnLeaderboard(limit = 50) {
  return withRedis(
    async (redis) => {
      // Get top wallets with scores
      const results = await redis.zRangeWithScores('burn:leaderboard', 0, limit - 1, { REV: true });
      return results.map((entry, index) => ({
        rank: index + 1,
        wallet: entry.value,
        totalBurned: entry.score,
      }));
    },
    () => []
  );
}

/**
 * Get total unique burners count
 */
async function getBurnerCount() {
  return withRedis(
    async (redis) => {
      return redis.zCard('burn:leaderboard');
    },
    () => 0
  );
}

// =============================================================================
// Anomaly Detection State
// =============================================================================

const ANOMALY_WINDOW_SECONDS = 300; // 5 minutes

/**
 * Track wallet activity for anomaly detection
 */
async function trackWalletActivity(wallet, activityType) {
  const key = `anomaly:wallet:${activityType}:${wallet}`;

  return withRedis(
    async (redis) => {
      const multi = redis.multi();
      multi.incr(key);
      multi.expire(key, ANOMALY_WINDOW_SECONDS);
      const results = await multi.exec();
      return results[0];
    },
    () => {
      const current = parseInt(memoryStore.get(key)) || 0;
      memoryStore.set(key, String(current + 1), ANOMALY_WINDOW_SECONDS);
      return current + 1;
    }
  );
}

/**
 * Get wallet activity count
 */
async function getWalletActivity(wallet, activityType) {
  const key = `anomaly:wallet:${activityType}:${wallet}`;

  return withRedis(
    async (redis) => {
      const count = await redis.get(key);
      return parseInt(count) || 0;
    },
    () => parseInt(memoryStore.get(key)) || 0
  );
}

/**
 * Track IP activity for anomaly detection
 */
async function trackIpActivity(ip, activityType) {
  const key = `anomaly:ip:${activityType}:${ip}`;

  return withRedis(
    async (redis) => {
      const multi = redis.multi();
      multi.incr(key);
      multi.expire(key, ANOMALY_WINDOW_SECONDS);
      const results = await multi.exec();
      return results[0];
    },
    () => {
      const current = parseInt(memoryStore.get(key)) || 0;
      memoryStore.set(key, String(current + 1), ANOMALY_WINDOW_SECONDS);
      return current + 1;
    }
  );
}

module.exports = {
  initializeClient,
  getClient,
  isConnected,
  getConnectionState,
  ping,
  disconnect,
  setQuote,
  getQuote,
  deleteQuote,
  incrBurnTotal,
  incrTxCount,
  getStats,
  addPendingSwap,
  getPendingSwapAmount,
  resetPendingSwap,
  // Treasury (80/20 model)
  incrTreasuryTotal,
  getTreasuryBalance,
  recordTreasuryEvent,
  getTreasuryHistory,
  // Anti-Replay Protection
  hasTransactionHash,
  markTransactionHash,
  // Per-Wallet Rate Limiting
  incrWalletRateLimit,
  getWalletRateLimit,
  // Audit Logging
  appendAuditLog,
  getAuditLog,
  searchAuditLog,
  // Anomaly Detection
  trackWalletActivity,
  getWalletActivity,
  trackIpActivity,
  // Wallet Burn Tracking
  incrWalletBurn,
  getWalletBurnStats,
  getBurnLeaderboard,
  getBurnerCount,
};
