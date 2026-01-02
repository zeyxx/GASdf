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

let pool = null;
let isInitialized = false;

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
      ssl: isRender ? {
        rejectUnauthorized: false,
        // Explicitly request SSL
        require: true
      } : false,
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
  if (!pool) return null;

  const query = `
    INSERT INTO burns (signature, swap_signature, amount_burned, sol_equivalent, treasury_amount, method, wallet)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (signature) DO NOTHING
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [
      burn.signature,
      burn.swapSignature || null,
      burn.amountBurned,
      burn.solEquivalent || null,
      burn.treasuryAmount || null,
      burn.method || 'jupiter',
      burn.wallet || null,
    ]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('DB', 'Failed to record burn', { error: error.message });
    return null;
  }
}

/**
 * Get burn history with pagination
 */
async function getBurnHistory(limit = 50, offset = 0) {
  if (!pool) return { burns: [], total: 0 };

  try {
    const [burns, countResult] = await Promise.all([
      pool.query(
        'SELECT * FROM burns ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      ),
      pool.query('SELECT COUNT(*) FROM burns'),
    ]);

    return {
      burns: burns.rows,
      total: parseInt(countResult.rows[0].count),
    };
  } catch (error) {
    logger.error('DB', 'Failed to get burn history', { error: error.message });
    return { burns: [], total: 0 };
  }
}

/**
 * Get burn statistics
 */
async function getBurnStats() {
  if (!pool) return null;

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

  try {
    const result = await pool.query(query);
    return result.rows[0];
  } catch (error) {
    logger.error('DB', 'Failed to get burn stats', { error: error.message });
    return null;
  }
}

/**
 * Get burns by wallet
 */
async function getBurnsByWallet(wallet, limit = 50) {
  if (!pool) return [];

  try {
    const result = await pool.query(
      'SELECT * FROM burns WHERE wallet = $1 ORDER BY created_at DESC LIMIT $2',
      [wallet, limit]
    );
    return result.rows;
  } catch (error) {
    logger.error('DB', 'Failed to get burns by wallet', { error: error.message });
    return [];
  }
}

// =============================================================================
// Transactions
// =============================================================================

/**
 * Record a transaction
 */
async function recordTransaction(tx) {
  if (!pool) return null;

  const query = `
    INSERT INTO transactions (quote_id, signature, user_wallet, payment_token, fee_amount, fee_sol_equivalent, status, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (quote_id) DO UPDATE SET
      signature = EXCLUDED.signature,
      status = EXCLUDED.status,
      completed_at = CASE WHEN EXCLUDED.status IN ('confirmed', 'failed') THEN NOW() ELSE transactions.completed_at END
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [
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
  } catch (error) {
    logger.error('DB', 'Failed to record transaction', { error: error.message });
    return null;
  }
}

/**
 * Update transaction status
 */
async function updateTransactionStatus(quoteId, status, signature = null, errorMessage = null) {
  if (!pool) return null;

  const query = `
    UPDATE transactions
    SET status = $2,
        signature = COALESCE($3, signature),
        error_message = $4,
        completed_at = CASE WHEN $2 IN ('confirmed', 'failed') THEN NOW() ELSE completed_at END
    WHERE quote_id = $1
    RETURNING *
  `;

  try {
    const result = await pool.query(query, [quoteId, status, signature, errorMessage]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('DB', 'Failed to update transaction', { error: error.message });
    return null;
  }
}

/**
 * Get transaction history
 */
async function getTransactionHistory(limit = 50, offset = 0, status = null) {
  if (!pool) return { transactions: [], total: 0 };

  try {
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
      pool.query(query, params),
      pool.query(countQuery, status ? [status] : []),
    ]);

    return {
      transactions: txs.rows,
      total: parseInt(countResult.rows[0].count),
    };
  } catch (error) {
    logger.error('DB', 'Failed to get transactions', { error: error.message });
    return { transactions: [], total: 0 };
  }
}

// =============================================================================
// Token Stats
// =============================================================================

/**
 * Update token statistics
 */
async function updateTokenStats(mint, stats) {
  if (!pool) return null;

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

  try {
    const result = await pool.query(query, [
      mint,
      stats.symbol || null,
      stats.name || null,
      stats.feeAmount || 0,
      stats.kScore || 'UNKNOWN',
    ]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('DB', 'Failed to update token stats', { error: error.message });
    return null;
  }
}

/**
 * Get token leaderboard
 */
async function getTokenLeaderboard(limit = 20) {
  if (!pool) return [];

  try {
    const result = await pool.query(
      'SELECT * FROM token_stats ORDER BY total_transactions DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  } catch (error) {
    logger.error('DB', 'Failed to get token leaderboard', { error: error.message });
    return [];
  }
}

// =============================================================================
// Audit Log
// =============================================================================

/**
 * Add audit log entry
 */
async function addAuditLog(event) {
  if (!pool) return null;

  const query = `
    INSERT INTO audit_log (event_type, event_data, wallet, ip_address, severity)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `;

  try {
    const result = await pool.query(query, [
      event.type,
      JSON.stringify(event.data || {}),
      event.wallet || null,
      event.ipAddress || null,
      event.severity || 'INFO',
    ]);
    return result.rows[0]?.id || null;
  } catch (error) {
    logger.error('DB', 'Failed to add audit log', { error: error.message });
    return null;
  }
}

/**
 * Get audit logs
 */
async function getAuditLogs(limit = 100, offset = 0, eventType = null) {
  if (!pool) return { logs: [], total: 0 };

  try {
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
      pool.query(query, params),
      pool.query(countQuery, eventType ? [eventType] : []),
    ]);

    return {
      logs: logs.rows,
      total: parseInt(countResult.rows[0].count),
    };
  } catch (error) {
    logger.error('DB', 'Failed to get audit logs', { error: error.message });
    return { logs: [], total: 0 };
  }
}

// =============================================================================
// Daily Stats
// =============================================================================

/**
 * Update or create daily stats
 */
async function updateDailyStats(stats) {
  if (!pool) return null;

  const today = new Date().toISOString().split('T')[0];

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

  try {
    const result = await pool.query(query, [
      today,
      stats.burns || 0,
      stats.transactions || 0,
      stats.uniqueWallets || 0,
      stats.feesSol || 0,
      stats.treasuryBalance || 0,
    ]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('DB', 'Failed to update daily stats', { error: error.message });
    return null;
  }
}

/**
 * Get daily stats for chart
 */
async function getDailyStatsHistory(days = 30) {
  if (!pool) return [];

  try {
    const result = await pool.query(
      'SELECT * FROM daily_stats ORDER BY date DESC LIMIT $1',
      [days]
    );
    return result.rows.reverse(); // Oldest first for charts
  } catch (error) {
    logger.error('DB', 'Failed to get daily stats', { error: error.message });
    return [];
  }
}

// =============================================================================
// Analytics Queries
// =============================================================================

/**
 * Get comprehensive analytics
 */
async function getAnalytics() {
  if (!pool) return null;

  try {
    const [burns, txs, tokens, dailyStats] = await Promise.all([
      getBurnStats(),
      pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
          COUNT(*) FILTER (WHERE status = 'failed') as failed,
          COUNT(*) FILTER (WHERE status = 'pending') as pending
        FROM transactions
      `),
      pool.query('SELECT COUNT(*) FROM token_stats'),
      pool.query('SELECT * FROM daily_stats ORDER BY date DESC LIMIT 7'),
    ]);

    return {
      burns,
      transactions: txs.rows[0],
      uniqueTokens: parseInt(tokens.rows[0].count),
      weeklyStats: dailyStats.rows,
    };
  } catch (error) {
    logger.error('DB', 'Failed to get analytics', { error: error.message });
    return null;
  }
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
}

module.exports = {
  initialize,
  getPool,
  isConnected,
  ping,
  disconnect,
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
