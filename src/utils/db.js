/**
 * PostgreSQL Client for GASdf
 *
 * Handles persistent data that needs ACID compliance:
 * - Burn history (verifiable on-chain)
 * - Transaction logs
 * - Token analytics
 * - Audit trail
 *
 * Redis handles hot data (quotes, rate limits, cache)
 * PostgreSQL handles cold data (history, analytics, audit)
 */

const { Pool } = require('pg');
const config = require('./config');
const logger = require('./logger');
const { CircuitBreaker } = require('./circuit-breaker');

let pool = null;
let isInitialized = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000;

// Circuit breaker for DB operations
const dbCircuit = new CircuitBreaker({
  name: 'postgresql',
  failureThreshold: 3,
  resetTimeout: 30000,         // Try to recover after 30s
  halfOpenMaxRequests: 2,      // Allow 2 test requests in half-open
  isFailure: (error) => {
    // Don't count constraint violations or data errors as circuit failures
    const code = error.code || '';
    return !code.startsWith('23'); // 23xxx = constraint violations
  },
});

/**
 * Initialize PostgreSQL connection pool
 */
async function initialize() {
  if (pool) return pool;

  if (!config.DATABASE_URL) {
    logger.warn('DB', 'DATABASE_URL not set, PostgreSQL disabled');
    return null;
  }

  try {
    // Determine SSL config based on URL and environment
    // Render external connections require SSL
    const isRender = config.DATABASE_URL.includes('render.com');
    const hasSSLMode = config.DATABASE_URL.includes('sslmode=');

    // For Render, strip sslmode from URL and configure SSL separately
    // This avoids conflicts between URL params and Pool config
    let connectionString = config.DATABASE_URL;
    if (hasSSLMode) {
      connectionString = connectionString.replace(/[?&]sslmode=[^&]+/, '');
    }

    pool = new Pool({
      connectionString,
      // Render external requires SSL with self-signed certs
      ssl: isRender ? { rejectUnauthorized: false } : false,
      max: 5, // Reduced for free tier
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 20000, // Increased for cross-region latency
    });

    logger.info('DB', 'Connecting to PostgreSQL...', {
      ssl: isRender,
      host: isRender ? 'render-external' : 'other'
    });

    // Test connection
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();

    logger.info('DB', 'PostgreSQL connected');

    // Run migrations
    await runMigrations();
    isInitialized = true;

    return pool;
  } catch (error) {
    logger.error('DB', 'PostgreSQL connection failed', { error: error.message });
    pool = null;
    return null;
  }
}

/**
 * Run database migrations
 */
async function runMigrations() {
  if (!pool) return;

  const migrations = `
    -- Burns table: verifiable on-chain burn history
    CREATE TABLE IF NOT EXISTS burns (
      id SERIAL PRIMARY KEY,
      signature VARCHAR(100) UNIQUE NOT NULL,
      swap_signature VARCHAR(100),
      amount_burned NUMERIC(20, 6) NOT NULL,
      sol_equivalent NUMERIC(20, 9),
      treasury_amount NUMERIC(20, 9),
      method VARCHAR(20) DEFAULT 'jupiter',
      wallet VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Transactions table: all processed transactions
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      quote_id VARCHAR(50) UNIQUE NOT NULL,
      signature VARCHAR(100),
      user_wallet VARCHAR(50) NOT NULL,
      payment_token VARCHAR(50) NOT NULL,
      fee_amount NUMERIC(20, 6) NOT NULL,
      fee_sol_equivalent NUMERIC(20, 9),
      status VARCHAR(20) DEFAULT 'pending',
      error_message TEXT,
      ip_address VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP
    );

    -- Token stats: analytics per token
    CREATE TABLE IF NOT EXISTS token_stats (
      mint VARCHAR(50) PRIMARY KEY,
      symbol VARCHAR(20),
      name VARCHAR(100),
      total_fees_collected NUMERIC(20, 6) DEFAULT 0,
      total_transactions INT DEFAULT 0,
      last_used TIMESTAMP,
      k_score VARCHAR(20) DEFAULT 'UNKNOWN',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Audit log: comprehensive audit trail
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(50) NOT NULL,
      event_data JSONB NOT NULL,
      wallet VARCHAR(50),
      ip_address VARCHAR(50),
      severity VARCHAR(10) DEFAULT 'INFO',
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Daily stats: aggregated daily statistics
    CREATE TABLE IF NOT EXISTS daily_stats (
      date DATE PRIMARY KEY,
      total_burns NUMERIC(20, 6) DEFAULT 0,
      total_transactions INT DEFAULT 0,
      unique_wallets INT DEFAULT 0,
      total_fees_sol NUMERIC(20, 9) DEFAULT 0,
      treasury_balance NUMERIC(20, 9) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_burns_wallet ON burns(wallet);
    CREATE INDEX IF NOT EXISTS idx_burns_created ON burns(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(user_wallet);
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_wallet ON audit_log(wallet);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
  `;

  try {
    await pool.query(migrations);
    logger.info('DB', 'Migrations complete');
  } catch (error) {
    logger.error('DB', 'Migration failed', { error: error.message });
    throw error;
  }
}

/**
 * Get pool for direct queries
 */
function getPool() {
  return pool;
}

/**
 * Check if database is connected
 */
function isConnected() {
  return pool !== null && isInitialized;
}

/**
 * Check if error is transient and retryable
 */
function isTransientError(error) {
  const transientCodes = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'EAI_AGAIN',
    '57P01',  // admin_shutdown
    '57P02',  // crash_shutdown
    '57P03',  // cannot_connect_now
    '08000',  // connection_exception
    '08003',  // connection_does_not_exist
    '08006',  // connection_failure
    '40001',  // serialization_failure
    '40P01',  // deadlock_detected
  ];

  return transientCodes.includes(error.code) ||
         error.message?.includes('Connection terminated') ||
         error.message?.includes('timeout') ||
         error.message?.includes('ECONNRESET');
}

/**
 * Sleep helper for backoff
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Execute query with retry and circuit breaker protection
 * @param {Function} queryFn - Async function that executes the query
 * @param {Object} options - Options for retry behavior
 * @returns {Promise<any>} Query result or fallback
 */
async function withDb(queryFn, options = {}) {
  const {
    retries = 2,
    fallback = null,
    operation = 'query',
  } = options;

  // Check circuit breaker state
  if (!dbCircuit.canExecute()) {
    logger.debug('DB', `Circuit open, skipping ${operation}`);
    return fallback;
  }

  // No pool available
  if (!pool) {
    return fallback;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await queryFn(pool);
      dbCircuit.onSuccess();
      reconnectAttempts = 0; // Reset on success
      return result;
    } catch (error) {

      // Check if retryable
      if (isTransientError(error) && attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        logger.warn('DB', `Transient error, retry ${attempt + 1}/${retries}`, {
          operation,
          error: error.message,
          delay,
        });
        await sleep(delay);
        continue;
      }

      // Non-retryable or exhausted retries
      dbCircuit.onFailure(error);
      logger.error('DB', `${operation} failed`, { error: error.message });

      // Trigger reconnection for connection errors
      if (isTransientError(error) && error.message?.includes('Connection')) {
        scheduleReconnect();
      }

      break;
    }
  }

  return fallback;
}

/**
 * Schedule a reconnection attempt with exponential backoff
 */
function scheduleReconnect() {
  if (reconnectTimer || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error('DB', 'Max reconnection attempts reached');
    }
    return;
  }

  const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts);
  reconnectAttempts++;

  logger.info('DB', `Scheduling reconnection in ${delay}ms (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    try {
      // Close existing pool if any
      if (pool) {
        await pool.end().catch(() => {});
        pool = null;
        isInitialized = false;
      }

      // Re-initialize
      await initialize();

      if (pool) {
        logger.info('DB', 'Reconnection successful');
        reconnectAttempts = 0;
        dbCircuit.reset();
      } else {
        scheduleReconnect();
      }
    } catch (error) {
      logger.error('DB', 'Reconnection failed', { error: error.message });
      scheduleReconnect();
    }
  }, delay);
}

/**
 * Health check
 */
async function ping() {
  if (!pool) return null;
  try {
    const result = await pool.query('SELECT 1');
    return result.rows[0] ? 'PONG' : null;
  } catch {
    return null;
  }
}

// =============================================================================
// Burns
// =============================================================================

/**
 * Record a burn in the database
 */
async function recordBurn(burn) {
  return withDb(async (p) => {
    const query = `
      INSERT INTO burns (signature, swap_signature, amount_burned, sol_equivalent, treasury_amount, method, wallet)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (signature) DO NOTHING
      RETURNING *
    `;
    const result = await p.query(query, [
      burn.signature,
      burn.swapSignature || null,
      burn.amountBurned,
      burn.solEquivalent || null,
      burn.treasuryAmount || null,
      burn.method || 'jupiter',
      burn.wallet || null,
    ]);
    return result.rows[0] || null;
  }, { operation: 'recordBurn', retries: 3 }); // Burns are critical, more retries
}

/**
 * Get burn history with pagination
 */
async function getBurnHistory(limit = 50, offset = 0) {
  return withDb(async (p) => {
    const [burns, countResult] = await Promise.all([
      p.query(
        'SELECT * FROM burns ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      ),
      p.query('SELECT COUNT(*) FROM burns'),
    ]);
    return {
      burns: burns.rows,
      total: parseInt(countResult.rows[0].count),
    };
  }, { operation: 'getBurnHistory', fallback: { burns: [], total: 0 } });
}

/**
 * Get burn statistics
 */
async function getBurnStats() {
  return withDb(async (p) => {
    const query = `
      SELECT
        COUNT(*) as total_burns,
        COALESCE(SUM(amount_burned), 0) as total_amount,
        COALESCE(SUM(sol_equivalent), 0) as total_sol,
        COALESCE(SUM(treasury_amount), 0) as total_treasury,
        COUNT(DISTINCT wallet) as unique_wallets,
        MAX(created_at) as last_burn
      FROM burns
    `;
    const result = await p.query(query);
    return result.rows[0];
  }, { operation: 'getBurnStats' });
}

/**
 * Get burns by wallet
 */
async function getBurnsByWallet(wallet, limit = 50) {
  return withDb(async (p) => {
    const result = await p.query(
      'SELECT * FROM burns WHERE wallet = $1 ORDER BY created_at DESC LIMIT $2',
      [wallet, limit]
    );
    return result.rows;
  }, { operation: 'getBurnsByWallet', fallback: [] });
}

// =============================================================================
// Transactions
// =============================================================================

/**
 * Record a transaction
 */
async function recordTransaction(tx) {
  return withDb(async (p) => {
    const query = `
      INSERT INTO transactions (quote_id, signature, user_wallet, payment_token, fee_amount, fee_sol_equivalent, status, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (quote_id) DO UPDATE SET
        signature = EXCLUDED.signature,
        status = EXCLUDED.status,
        completed_at = CASE WHEN EXCLUDED.status IN ('confirmed', 'failed') THEN NOW() ELSE transactions.completed_at END
      RETURNING *
    `;
    const result = await p.query(query, [
      tx.quoteId,
      tx.signature || null,
      tx.userWallet,
      tx.paymentToken,
      tx.feeAmount,
      tx.feeSolEquivalent || null,
      tx.status || 'pending',
      tx.ipAddress || null,
    ]);
    return result.rows[0] || null;
  }, { operation: 'recordTransaction', retries: 3 }); // Transactions are critical
}

/**
 * Update transaction status
 */
async function updateTransactionStatus(quoteId, status, signature = null, errorMessage = null) {
  return withDb(async (p) => {
    const query = `
      UPDATE transactions
      SET status = $2,
          signature = COALESCE($3, signature),
          error_message = $4,
          completed_at = CASE WHEN $2 IN ('confirmed', 'failed') THEN NOW() ELSE completed_at END
      WHERE quote_id = $1
      RETURNING *
    `;
    const result = await p.query(query, [quoteId, status, signature, errorMessage]);
    return result.rows[0] || null;
  }, { operation: 'updateTransactionStatus', retries: 3 });
}

/**
 * Get transaction history
 */
async function getTransactionHistory(limit = 50, offset = 0, status = null) {
  return withDb(async (p) => {
    let query = 'SELECT * FROM transactions';
    let countQuery = 'SELECT COUNT(*) FROM transactions';
    const params = [];

    if (status) {
      query += ' WHERE status = $1';
      countQuery += ' WHERE status = $1';
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [txs, countResult] = await Promise.all([
      p.query(query, params),
      p.query(countQuery, status ? [status] : []),
    ]);

    return {
      transactions: txs.rows,
      total: parseInt(countResult.rows[0].count),
    };
  }, { operation: 'getTransactionHistory', fallback: { transactions: [], total: 0 } });
}

// =============================================================================
// Token Stats
// =============================================================================

/**
 * Update token statistics
 */
async function updateTokenStats(mint, stats) {
  return withDb(async (p) => {
    const query = `
      INSERT INTO token_stats (mint, symbol, name, total_fees_collected, total_transactions, last_used, k_score)
      VALUES ($1, $2, $3, $4, 1, NOW(), $5)
      ON CONFLICT (mint) DO UPDATE SET
        symbol = COALESCE(EXCLUDED.symbol, token_stats.symbol),
        name = COALESCE(EXCLUDED.name, token_stats.name),
        total_fees_collected = token_stats.total_fees_collected + EXCLUDED.total_fees_collected,
        total_transactions = token_stats.total_transactions + 1,
        last_used = NOW(),
        k_score = COALESCE(EXCLUDED.k_score, token_stats.k_score),
        updated_at = NOW()
      RETURNING *
    `;
    const result = await p.query(query, [
      mint,
      stats.symbol || null,
      stats.name || null,
      stats.feeAmount || 0,
      stats.kScore || 'UNKNOWN',
    ]);
    return result.rows[0] || null;
  }, { operation: 'updateTokenStats' });
}

/**
 * Get token leaderboard
 */
async function getTokenLeaderboard(limit = 20) {
  return withDb(async (p) => {
    const result = await p.query(
      'SELECT * FROM token_stats ORDER BY total_transactions DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  }, { operation: 'getTokenLeaderboard', fallback: [] });
}

// =============================================================================
// Audit Log
// =============================================================================

/**
 * Add audit log entry
 */
async function addAuditLog(event) {
  return withDb(async (p) => {
    const query = `
      INSERT INTO audit_log (event_type, event_data, wallet, ip_address, severity)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;
    const result = await p.query(query, [
      event.type,
      JSON.stringify(event.data || {}),
      event.wallet || null,
      event.ipAddress || null,
      event.severity || 'INFO',
    ]);
    return result.rows[0]?.id || null;
  }, { operation: 'addAuditLog' }); // Audit logs are nice-to-have, no extra retries
}

/**
 * Get audit logs
 */
async function getAuditLogs(limit = 100, offset = 0, eventType = null) {
  return withDb(async (p) => {
    let query = 'SELECT * FROM audit_log';
    let countQuery = 'SELECT COUNT(*) FROM audit_log';
    const params = [];

    if (eventType) {
      query += ' WHERE event_type = $1';
      countQuery += ' WHERE event_type = $1';
      params.push(eventType);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [logs, countResult] = await Promise.all([
      p.query(query, params),
      p.query(countQuery, eventType ? [eventType] : []),
    ]);

    return {
      logs: logs.rows,
      total: parseInt(countResult.rows[0].count),
    };
  }, { operation: 'getAuditLogs', fallback: { logs: [], total: 0 } });
}

// =============================================================================
// Daily Stats
// =============================================================================

/**
 * Update or create daily stats
 */
async function updateDailyStats(stats) {
  const today = new Date().toISOString().split('T')[0];

  return withDb(async (p) => {
    const query = `
      INSERT INTO daily_stats (date, total_burns, total_transactions, unique_wallets, total_fees_sol, treasury_balance)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (date) DO UPDATE SET
        total_burns = daily_stats.total_burns + EXCLUDED.total_burns,
        total_transactions = daily_stats.total_transactions + EXCLUDED.total_transactions,
        unique_wallets = GREATEST(daily_stats.unique_wallets, EXCLUDED.unique_wallets),
        total_fees_sol = daily_stats.total_fees_sol + EXCLUDED.total_fees_sol,
        treasury_balance = EXCLUDED.treasury_balance
      RETURNING *
    `;
    const result = await p.query(query, [
      today,
      stats.burns || 0,
      stats.transactions || 0,
      stats.uniqueWallets || 0,
      stats.feesSol || 0,
      stats.treasuryBalance || 0,
    ]);
    return result.rows[0] || null;
  }, { operation: 'updateDailyStats' });
}

/**
 * Get daily stats for chart
 */
async function getDailyStatsHistory(days = 30) {
  return withDb(async (p) => {
    const result = await p.query(
      'SELECT * FROM daily_stats ORDER BY date DESC LIMIT $1',
      [days]
    );
    return result.rows.reverse(); // Oldest first for charts
  }, { operation: 'getDailyStatsHistory', fallback: [] });
}

// =============================================================================
// Analytics Queries
// =============================================================================

/**
 * Get comprehensive analytics
 */
async function getAnalytics() {
  return withDb(async (p) => {
    const [burns, txs, tokens, dailyStats] = await Promise.all([
      getBurnStats(),
      p.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
          COUNT(*) FILTER (WHERE status = 'failed') as failed,
          COUNT(*) FILTER (WHERE status = 'pending') as pending
        FROM transactions
      `),
      p.query('SELECT COUNT(*) FROM token_stats'),
      p.query('SELECT * FROM daily_stats ORDER BY date DESC LIMIT 7'),
    ]);

    return {
      burns,
      transactions: txs.rows[0],
      uniqueTokens: parseInt(tokens.rows[0].count),
      weeklyStats: dailyStats.rows,
    };
  }, { operation: 'getAnalytics' });
}

/**
 * Get circuit breaker status for health checks
 */
function getCircuitStatus() {
  return {
    ...dbCircuit.getStatus(),
    stats: dbCircuit.getStats(),
    reconnectAttempts,
    isConnected: isConnected(),
  };
}

/**
 * Graceful shutdown
 */
async function disconnect() {
  if (pool) {
    await pool.end();
    logger.info('DB', 'PostgreSQL disconnected');
    pool = null;
    isInitialized = false;
  }

  // Clear reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

module.exports = {
  initialize,
  getPool,
  isConnected,
  ping,
  disconnect,
  getCircuitStatus,
  // Burns
  recordBurn,
  getBurnHistory,
  getBurnStats,
  getBurnsByWallet,
  // Transactions
  recordTransaction,
  updateTransactionStatus,
  getTransactionHistory,
  // Token Stats
  updateTokenStats,
  getTokenLeaderboard,
  // Audit
  addAuditLog,
  getAuditLogs,
  // Daily Stats
  updateDailyStats,
  getDailyStatsHistory,
  // Analytics
  getAnalytics,
};
