const { createClient } = require('redis');
const config = require('./config');
const logger = require('./logger');

let client = null;
let useMemory = false;
let connectionState = 'disconnected'; // disconnected, connecting, connected, error

// In-memory fallback for local development ONLY
// Includes periodic cleanup to prevent memory leaks
const memoryStore = {
  data: new Map(),
  lastCleanup: 0,
  cleanupIntervalMs: 10000, // Clean up every 10 seconds

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
    // Trigger cleanup periodically on writes
    this._maybeCleanup();
  },

  del(key) {
    this.data.delete(key);
  },

  clear() {
    this.data.clear();
  },

  // Periodic cleanup of expired entries to prevent memory leak
  _maybeCleanup() {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupIntervalMs) return;

    this.lastCleanup = now;
    let deleted = 0;

    for (const [key, item] of this.data) {
      if (item.expiry && now > item.expiry) {
        this.data.delete(key);
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.debug('REDIS', `Memory store cleanup: removed ${deleted} expired entries, ${this.data.size} remaining`);
    }
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
 * @deprecated Use claimTransactionSlot for atomic check-and-mark
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
 * @deprecated Use claimTransactionSlot for atomic check-and-mark
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

/**
 * ATOMIC: Claim a transaction slot (SET NX) - prevents race conditions
 * Returns { claimed: true } if this is a new transaction (slot claimed)
 * Returns { claimed: false } if transaction was already submitted (replay)
 *
 * This is the secure replacement for hasTransactionHash + markTransactionHash
 * The atomic SET NX ensures no race condition between check and mark.
 */
async function claimTransactionSlot(txHash) {
  const key = `txhash:${txHash}`;

  return withRedis(
    async (redis) => {
      // SET key value NX EX ttl - atomic set-if-not-exists with expiry
      // Returns 'OK' if set, null if key already exists
      const result = await redis.set(key, Date.now().toString(), {
        NX: true,
        EX: TX_HASH_TTL_SECONDS
      });
      return { claimed: result === 'OK' };
    },
    () => {
      // Memory fallback with atomic-like behavior
      const existing = memoryStore.get(key);
      if (existing !== null) {
        return { claimed: false };
      }
      memoryStore.set(key, Date.now().toString(), TX_HASH_TTL_SECONDS);
      return { claimed: true };
    }
  );
}

/**
 * Release a transaction slot (if we claimed it but transaction failed)
 * Only call this if you claimed the slot and need to allow retry
 */
async function releaseTransactionSlot(txHash) {
  const key = `txhash:${txHash}`;

  return withRedis(
    async (redis) => {
      await redis.del(key);
    },
    () => {
      memoryStore.del(key);
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
// Burn Proofs (Verifiable On-Chain)
// =============================================================================

/**
 * Record a burn proof with verifiable on-chain signatures
 */
async function recordBurnProof(proof) {
  const entry = {
    burnSignature: proof.burnSignature,
    swapSignature: proof.swapSignature,
    amountBurned: proof.amountBurned,
    solAmount: proof.solAmount,
    treasuryAmount: proof.treasuryAmount,
    method: proof.method, // jupiter
    timestamp: Date.now(),
    network: proof.network || 'mainnet-beta',
    explorerUrl: `https://solscan.io/tx/${proof.burnSignature}`,
  };

  return withRedis(
    async (redis) => {
      const multi = redis.multi();
      // Store proof by burn signature for lookup
      multi.set(`burn:proof:${proof.burnSignature}`, JSON.stringify(entry));
      // Add to chronological list (newest first)
      multi.lPush('burn:proofs', JSON.stringify(entry));
      // Keep last 1000 proofs
      multi.lTrim('burn:proofs', 0, 999);
      // Track total verified burns
      multi.incr('burn:proof:count');
      await multi.exec();
      return entry;
    },
    () => {
      // Memory fallback
      const proofs = JSON.parse(memoryStore.get('burn:proofs') || '[]');
      proofs.unshift(entry);
      if (proofs.length > 100) proofs.pop();
      memoryStore.set('burn:proofs', JSON.stringify(proofs));
      memoryStore.set(`burn:proof:${proof.burnSignature}`, JSON.stringify(entry));
      return entry;
    }
  );
}

/**
 * Get recent burn proofs
 */
async function getBurnProofs(limit = 50) {
  return withRedis(
    async (redis) => {
      const [proofs, totalCount] = await Promise.all([
        redis.lRange('burn:proofs', 0, limit - 1),
        redis.get('burn:proof:count'),
      ]);
      return {
        proofs: proofs.map(p => JSON.parse(p)),
        totalCount: parseInt(totalCount) || 0,
      };
    },
    () => {
      const proofs = JSON.parse(memoryStore.get('burn:proofs') || '[]');
      return {
        proofs: proofs.slice(0, limit),
        totalCount: proofs.length,
      };
    }
  );
}

/**
 * Get a specific burn proof by signature
 */
async function getBurnProofBySignature(signature) {
  return withRedis(
    async (redis) => {
      const proof = await redis.get(`burn:proof:${signature}`);
      return proof ? JSON.parse(proof) : null;
    },
    () => {
      const proof = memoryStore.get(`burn:proof:${signature}`);
      return proof ? JSON.parse(proof) : null;
    }
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

// =============================================================================
// Distributed Locking (Race Condition Prevention)
// =============================================================================

// In-memory locks for fallback
const memoryLocks = new Map();

/**
 * Acquire a distributed lock using Redis SETNX
 * @param {string} lockName - Unique name for the lock
 * @param {number} ttlSeconds - Lock expiration time (prevents deadlocks)
 * @returns {Promise<string|null>} - Lock token if acquired, null if lock held by another
 */
async function acquireLock(lockName, ttlSeconds = 30) {
  const key = `lock:${lockName}`;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return withRedis(
    async (redis) => {
      // SET key value NX EX ttl - atomic set-if-not-exists with expiry
      const result = await redis.set(key, token, { NX: true, EX: ttlSeconds });
      if (result === 'OK') {
        return token;
      }
      return null;
    },
    () => {
      // Memory fallback
      const existing = memoryLocks.get(key);
      if (existing && Date.now() < existing.expiresAt) {
        return null; // Lock held
      }
      memoryLocks.set(key, {
        token,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return token;
    }
  );
}

/**
 * Release a distributed lock
 * @param {string} lockName - Lock name
 * @param {string} token - Token received from acquireLock (ensures only owner releases)
 * @returns {Promise<boolean>} - True if released, false if lock not held or wrong token
 */
async function releaseLock(lockName, token) {
  const key = `lock:${lockName}`;

  return withRedis(
    async (redis) => {
      // Lua script for atomic check-and-delete (only delete if token matches)
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      const result = await redis.eval(script, { keys: [key], arguments: [token] });
      return result === 1;
    },
    () => {
      // Memory fallback
      const existing = memoryLocks.get(key);
      if (existing && existing.token === token) {
        memoryLocks.delete(key);
        return true;
      }
      return false;
    }
  );
}

/**
 * Check if a lock is currently held
 * @param {string} lockName - Lock name
 * @returns {Promise<boolean>} - True if lock is held
 */
async function isLockHeld(lockName) {
  const key = `lock:${lockName}`;

  return withRedis(
    async (redis) => {
      const value = await redis.get(key);
      return value !== null;
    },
    () => {
      const existing = memoryLocks.get(key);
      return !!(existing && Date.now() < existing.expiresAt);
    }
  );
}

/**
 * Execute a function with a distributed lock
 * Automatically acquires and releases the lock
 * @param {string} lockName - Lock name
 * @param {Function} fn - Async function to execute while holding lock
 * @param {number} ttlSeconds - Lock TTL
 * @returns {Promise<{success: boolean, result?: any, error?: string}>}
 */
async function withLock(lockName, fn, ttlSeconds = 60) {
  const token = await acquireLock(lockName, ttlSeconds);

  if (!token) {
    return { success: false, error: 'LOCK_HELD', message: `Lock ${lockName} is held by another process` };
  }

  try {
    const result = await fn();
    return { success: true, result };
  } catch (error) {
    return { success: false, error: 'EXECUTION_ERROR', message: error.message };
  } finally {
    await releaseLock(lockName, token);
  }
}

// =============================================================================
// Velocity Tracking (Behavioral Proof for Treasury Refill)
// =============================================================================
// Instead of fixed thresholds (0.1 SOL), we track actual tx velocity and costs
// to dynamically calculate how much SOL buffer is needed.
//
// Formula: requiredBuffer = (txPerHour × avgCostPerTx) × bufferHours
// This is "behavioral proof" - adapts to actual usage, not promises.
// =============================================================================

const VELOCITY_WINDOW_SECONDS = 3600; // 1 hour rolling window
const VELOCITY_BUCKET_SECONDS = 60; // 1 minute buckets for granularity

/**
 * Record a transaction for velocity tracking
 * Called after each successful transaction submission
 * @param {number} costLamports - Actual transaction cost in lamports
 */
async function recordTransactionVelocity(costLamports) {
  const now = Date.now();
  const bucket = Math.floor(now / (VELOCITY_BUCKET_SECONDS * 1000));
  const keyCount = `velocity:count:${bucket}`;
  const keyCost = `velocity:cost:${bucket}`;

  return withRedis(
    async (redis) => {
      const multi = redis.multi();
      multi.incr(keyCount);
      multi.expire(keyCount, VELOCITY_WINDOW_SECONDS + 60);
      multi.incrBy(keyCost, costLamports);
      multi.expire(keyCost, VELOCITY_WINDOW_SECONDS + 60);
      await multi.exec();
    },
    () => {
      // Memory fallback
      const currentCount = parseInt(memoryStore.get(keyCount)) || 0;
      const currentCost = parseInt(memoryStore.get(keyCost)) || 0;
      memoryStore.set(keyCount, String(currentCount + 1), VELOCITY_WINDOW_SECONDS + 60);
      memoryStore.set(keyCost, String(currentCost + costLamports), VELOCITY_WINDOW_SECONDS + 60);
    }
  );
}

/**
 * Get velocity metrics over the rolling window
 * @returns {Promise<{txCount: number, totalCost: number, avgCost: number, txPerHour: number, hoursOfData: number}>}
 */
async function getVelocityMetrics() {
  const now = Date.now();
  const currentBucket = Math.floor(now / (VELOCITY_BUCKET_SECONDS * 1000));
  const bucketsToCheck = Math.ceil(VELOCITY_WINDOW_SECONDS / VELOCITY_BUCKET_SECONDS);

  return withRedis(
    async (redis) => {
      // Build keys for all buckets in the window
      const countKeys = [];
      const costKeys = [];
      for (let i = 0; i < bucketsToCheck; i++) {
        const bucket = currentBucket - i;
        countKeys.push(`velocity:count:${bucket}`);
        costKeys.push(`velocity:cost:${bucket}`);
      }

      // Batch fetch all values
      const [countValues, costValues] = await Promise.all([
        redis.mGet(countKeys),
        redis.mGet(costKeys),
      ]);

      let totalTx = 0;
      let totalCost = 0;
      let bucketsWithData = 0;

      for (let i = 0; i < bucketsToCheck; i++) {
        const count = parseInt(countValues[i]) || 0;
        const cost = parseInt(costValues[i]) || 0;
        if (count > 0) {
          totalTx += count;
          totalCost += cost;
          bucketsWithData++;
        }
      }

      const hoursOfData = (bucketsWithData * VELOCITY_BUCKET_SECONDS) / 3600;
      const txPerHour = hoursOfData > 0 ? totalTx / hoursOfData : 0;
      const avgCost = totalTx > 0 ? totalCost / totalTx : 5000; // Default to base fee

      return {
        txCount: totalTx,
        totalCost,
        avgCost: Math.round(avgCost),
        txPerHour: Math.round(txPerHour * 100) / 100,
        hoursOfData: Math.round(hoursOfData * 100) / 100,
      };
    },
    () => {
      // Memory fallback - simplified
      let totalTx = 0;
      let totalCost = 0;
      for (let i = 0; i < bucketsToCheck; i++) {
        const bucket = currentBucket - i;
        const count = parseInt(memoryStore.get(`velocity:count:${bucket}`)) || 0;
        const cost = parseInt(memoryStore.get(`velocity:cost:${bucket}`)) || 0;
        totalTx += count;
        totalCost += cost;
      }
      return {
        txCount: totalTx,
        totalCost,
        avgCost: totalTx > 0 ? Math.round(totalCost / totalTx) : 5000,
        txPerHour: totalTx, // Simplified: assume 1 hour window
        hoursOfData: 1,
      };
    }
  );
}

/**
 * Calculate required SOL buffer based on velocity (behavioral proof)
 * @param {number} bufferHours - How many hours of runway to maintain (default: 2)
 * @param {number} minBufferLamports - Absolute minimum buffer (default: 50,000,000 = 0.05 SOL)
 * @returns {Promise<{required: number, target: number, velocity: object, explanation: string}>}
 */
async function calculateVelocityBasedBuffer(bufferHours = 2, minBufferLamports = 50_000_000) {
  const velocity = await getVelocityMetrics();

  // If no data, return minimum with 100× target
  if (velocity.txCount === 0 || velocity.hoursOfData < 0.1) {
    return {
      required: minBufferLamports,
      target: minBufferLamports * 100,
      velocity,
      explanation: 'No velocity data, using minimum buffer',
    };
  }

  // Calculate required buffer: (txPerHour × avgCost) × bufferHours
  const hourlyBurn = velocity.txPerHour * velocity.avgCost;
  const requiredBuffer = Math.max(
    minBufferLamports,
    Math.ceil(hourlyBurn * bufferHours)
  );

  // Target is 100x the required buffer (~1 week runway at steady state)
  // Minimizes refill frequency → less gas wasted on refill tx
  const targetBuffer = Math.ceil(requiredBuffer * 100);

  return {
    required: requiredBuffer,
    target: targetBuffer,
    velocity,
    explanation: `${velocity.txPerHour.toFixed(1)} tx/hr × ${(velocity.avgCost / 1000).toFixed(1)}k lamports × ${bufferHours}h = ${(requiredBuffer / 1_000_000_000).toFixed(4)} SOL`,
  };
}

// =============================================================================
// Jupiter Quote Caching (reduces API calls by ~80%)
// =============================================================================
const JUPITER_CACHE_TTL = 10; // seconds - prices change quickly
const JUPITER_CACHE_PREFIX = 'jup:quote:';

/**
 * Get amount bucket for cache key (avoids infinite cache entries)
 * Buckets: <10K, <100K, <1M, <10M, <100M, <1B, >=1B
 */
function getAmountBucket(amount) {
  const num = parseInt(amount);
  if (num < 10_000) return '0';
  if (num < 100_000) return '1';
  if (num < 1_000_000) return '2';
  if (num < 10_000_000) return '3';
  if (num < 100_000_000) return '4';
  if (num < 1_000_000_000) return '5';
  return '6';
}

/**
 * Cache a Jupiter quote
 */
async function cacheJupiterQuote(inputMint, outputMint, amount, quote) {
  const bucket = getAmountBucket(amount);
  const key = `${JUPITER_CACHE_PREFIX}${inputMint}:${outputMint}:${bucket}`;

  try {
    if (useMemory) {
      memoryStore.set(key, JSON.stringify(quote), JUPITER_CACHE_TTL);
      return true;
    }

    if (client && client.isOpen) {
      await client.setEx(key, JUPITER_CACHE_TTL, JSON.stringify(quote));
      return true;
    }
    return false;
  } catch (error) {
    logger.warn('Jupiter cache set failed', { error: error.message });
    return false;
  }
}

/**
 * Get cached Jupiter quote (if exists and not expired)
 * Returns null if no cache hit
 */
async function getCachedJupiterQuote(inputMint, outputMint, amount) {
  const bucket = getAmountBucket(amount);
  const key = `${JUPITER_CACHE_PREFIX}${inputMint}:${outputMint}:${bucket}`;

  try {
    let cached;
    if (useMemory) {
      cached = memoryStore.get(key);
    } else if (client && client.isOpen) {
      cached = await client.get(key);
    }

    if (cached) {
      const quote = JSON.parse(cached);
      // Adjust amounts proportionally for the actual requested amount
      const cachedAmount = parseInt(quote.inAmount);
      const ratio = parseInt(amount) / cachedAmount;

      return {
        ...quote,
        inAmount: amount.toString(),
        outAmount: Math.floor(parseInt(quote.outAmount) * ratio).toString(),
        cached: true,
        cacheRatio: ratio,
      };
    }
    return null;
  } catch (error) {
    logger.warn('Jupiter cache get failed', { error: error.message });
    return null;
  }
}

/**
 * Get Jupiter cache stats for monitoring
 */
function getJupiterCacheStats() {
  return {
    ttlSeconds: JUPITER_CACHE_TTL,
    prefix: JUPITER_CACHE_PREFIX,
  };
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
  // Anti-Replay Protection (atomic)
  claimTransactionSlot,
  releaseTransactionSlot,
  // Deprecated (non-atomic, kept for backward compatibility)
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
  // Burn Proofs
  recordBurnProof,
  getBurnProofs,
  getBurnProofBySignature,
  // Distributed Locking
  acquireLock,
  releaseLock,
  isLockHeld,
  withLock,
  // Velocity Tracking (Behavioral Refill)
  recordTransactionVelocity,
  getVelocityMetrics,
  calculateVelocityBasedBuffer,
  VELOCITY_WINDOW_SECONDS,
  // Jupiter Quote Caching
  cacheJupiterQuote,
  getCachedJupiterQuote,
  getJupiterCacheStats,
};
