/**
 * Data Sync Service
 *
 * Ensures data durability by syncing between layers:
 * - Redis (hot data) → PostgreSQL (cold storage)
 * - Memory fallback → Redis (on reconnection)
 *
 * This prevents data loss when:
 * - Redis is wiped/restarted (stats preserved in PostgreSQL)
 * - Redis connection drops temporarily (memory data synced back)
 */

const logger = require('../utils/logger');
const redis = require('../utils/redis');
const db = require('../utils/db');
const config = require('../utils/config');

// Sync interval: 5 minutes
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

// Track last synced values to detect changes
let lastSyncedStats = {
  burnTotal: 0,
  txCount: 0,
  treasuryTotal: 0,
};

let syncInterval = null;
let isRunning = false;

/**
 * Start the data sync service
 */
function start() {
  if (syncInterval) {
    logger.warn('DATA_SYNC', 'Sync service already running');
    return;
  }

  logger.info('DATA_SYNC', 'Starting data sync service', {
    intervalMs: SYNC_INTERVAL_MS,
  });

  // Initial sync after startup delay (let other services initialize)
  setTimeout(() => {
    syncRedisToPostgres().catch(err => {
      logger.error('DATA_SYNC', 'Initial sync failed', { error: err.message });
    });
  }, 10000);

  // Periodic sync
  syncInterval = setInterval(async () => {
    try {
      await syncRedisToPostgres();
    } catch (error) {
      logger.error('DATA_SYNC', 'Periodic sync failed', { error: error.message });
    }
  }, SYNC_INTERVAL_MS);

  isRunning = true;
}

/**
 * Stop the data sync service
 */
function stop() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    isRunning = false;
    logger.info('DATA_SYNC', 'Data sync service stopped');
  }
}

/**
 * Sync Redis stats to PostgreSQL daily_stats table
 * This ensures stats survive Redis restarts
 */
async function syncRedisToPostgres() {
  if (!db.isConnected()) {
    logger.debug('DATA_SYNC', 'PostgreSQL not available, skipping sync');
    return { synced: false, reason: 'db_unavailable' };
  }

  try {
    // Get current stats from Redis
    const stats = await redis.getStats();
    const treasuryBalance = await redis.getTreasuryBalance();
    const burnerCount = await redis.getBurnerCount();

    // Check if stats have changed since last sync
    const hasChanges =
      stats.burnTotal !== lastSyncedStats.burnTotal ||
      stats.txCount !== lastSyncedStats.txCount ||
      treasuryBalance !== lastSyncedStats.treasuryTotal;

    if (!hasChanges) {
      logger.debug('DATA_SYNC', 'No changes detected, skipping sync');
      return { synced: false, reason: 'no_changes' };
    }

    // Calculate deltas since last sync
    const burnDelta = stats.burnTotal - lastSyncedStats.burnTotal;
    const txDelta = stats.txCount - lastSyncedStats.txCount;

    // Update daily stats with deltas
    await db.updateDailyStats({
      burns: burnDelta > 0 ? burnDelta : 0,
      transactions: txDelta > 0 ? txDelta : 0,
      uniqueWallets: burnerCount,
      feesSol: 0, // Updated by submit flow
      treasuryBalance: treasuryBalance,
    });

    // Update last synced values
    lastSyncedStats = {
      burnTotal: stats.burnTotal,
      txCount: stats.txCount,
      treasuryTotal: treasuryBalance,
    };

    logger.info('DATA_SYNC', 'Redis → PostgreSQL sync complete', {
      burnTotal: stats.burnTotal,
      txCount: stats.txCount,
      treasuryBalance,
      burnDelta,
      txDelta,
    });

    return { synced: true, stats };
  } catch (error) {
    logger.error('DATA_SYNC', 'Sync to PostgreSQL failed', { error: error.message });
    throw error;
  }
}

/**
 * Sync memory fallback data to Redis when connection is restored
 * Called by redis.js when Redis reconnects after using memory fallback
 *
 * @param {Object} memoryData - Data accumulated in memory during outage
 */
async function syncMemoryToRedis(memoryData) {
  if (!memoryData || Object.keys(memoryData).length === 0) {
    logger.debug('DATA_SYNC', 'No memory data to sync');
    return { synced: false, reason: 'no_data' };
  }

  logger.info('DATA_SYNC', 'Syncing memory fallback data to Redis', {
    keys: Object.keys(memoryData).length,
  });

  try {
    const client = await redis.getClient();
    if (!client) {
      logger.warn('DATA_SYNC', 'Redis client not available for sync');
      return { synced: false, reason: 'redis_unavailable' };
    }

    let synced = 0;
    let errors = 0;

    for (const [key, value] of Object.entries(memoryData)) {
      try {
        // Handle different key types
        if (key.startsWith('stats:')) {
          // Stats are cumulative - add to existing
          const existing = await client.get(`gasdf:${key}`);
          const existingVal = parseFloat(existing) || 0;
          const memoryVal = parseFloat(value) || 0;

          if (memoryVal > 0) {
            // Only sync if memory has accumulated value
            await client.set(`gasdf:${key}`, String(existingVal + memoryVal));
            synced++;
            logger.debug('DATA_SYNC', `Synced stat: ${key}`, {
              existing: existingVal,
              memory: memoryVal,
              new: existingVal + memoryVal
            });
          }
        } else if (key.startsWith('pending:')) {
          // Pending amounts should be added
          const existing = await client.get(`gasdf:${key}`);
          const existingVal = parseFloat(existing) || 0;
          const memoryVal = parseFloat(value) || 0;

          if (memoryVal > 0) {
            await client.set(`gasdf:${key}`, String(existingVal + memoryVal));
            synced++;
          }
        } else if (key.startsWith('burn:wallet:')) {
          // Wallet burn stats - add to existing
          const existing = await client.get(`gasdf:${key}`);
          const existingVal = parseFloat(existing) || 0;
          const memoryVal = parseFloat(value) || 0;

          if (memoryVal > 0) {
            await client.set(`gasdf:${key}`, String(existingVal + memoryVal));

            // Also update leaderboard if this is a total burn
            if (!key.includes('txcount')) {
              const wallet = key.replace('burn:wallet:', '');
              await client.zIncrBy('gasdf:burn:leaderboard', memoryVal, wallet);
            }
            synced++;
          }
        }
        // Other keys (quotes, rate limits) are intentionally not synced
        // as they have short TTLs and should expire naturally
      } catch (err) {
        logger.warn('DATA_SYNC', `Failed to sync key: ${key}`, { error: err.message });
        errors++;
      }
    }

    logger.info('DATA_SYNC', 'Memory → Redis sync complete', { synced, errors });
    return { synced: true, keysProcessed: synced, errors };
  } catch (error) {
    logger.error('DATA_SYNC', 'Memory sync failed', { error: error.message });
    throw error;
  }
}

/**
 * Restore stats from PostgreSQL to Redis on startup
 * Called when Redis is empty but PostgreSQL has historical data
 */
async function restoreStatsFromPostgres() {
  if (!db.isConnected()) {
    logger.debug('DATA_SYNC', 'PostgreSQL not available for restore');
    return { restored: false, reason: 'db_unavailable' };
  }

  try {
    // Check if Redis has stats
    const currentStats = await redis.getStats();

    if (currentStats.burnTotal > 0 || currentStats.txCount > 0) {
      logger.debug('DATA_SYNC', 'Redis already has stats, skipping restore');
      return { restored: false, reason: 'redis_has_data' };
    }

    // Get aggregated stats from PostgreSQL
    const burnStats = await db.getBurnStats();

    if (!burnStats || (!burnStats.total_amount && !burnStats.total_burns)) {
      logger.debug('DATA_SYNC', 'No PostgreSQL stats to restore');
      return { restored: false, reason: 'no_postgres_data' };
    }

    // Restore to Redis
    const client = await redis.getClient();
    if (client) {
      if (burnStats.total_amount) {
        await client.set('gasdf:stats:burn_total', String(burnStats.total_amount));
      }
      if (burnStats.total_burns) {
        await client.set('gasdf:stats:tx_count', String(burnStats.total_burns));
      }
      if (burnStats.total_treasury) {
        await client.set('gasdf:stats:treasury_total', String(burnStats.total_treasury));
      }

      logger.info('DATA_SYNC', 'Restored stats from PostgreSQL', {
        burnTotal: burnStats.total_amount,
        txCount: burnStats.total_burns,
        treasury: burnStats.total_treasury,
      });

      return { restored: true, stats: burnStats };
    }

    return { restored: false, reason: 'redis_unavailable' };
  } catch (error) {
    logger.error('DATA_SYNC', 'Stats restore failed', { error: error.message });
    return { restored: false, reason: error.message };
  }
}

/**
 * Force an immediate sync (useful for graceful shutdown)
 */
async function forceSync() {
  logger.info('DATA_SYNC', 'Force sync triggered');
  return syncRedisToPostgres();
}

/**
 * Get sync status for health checks
 */
function getStatus() {
  return {
    running: isRunning,
    lastSyncedStats,
    intervalMs: SYNC_INTERVAL_MS,
  };
}

module.exports = {
  start,
  stop,
  syncRedisToPostgres,
  syncMemoryToRedis,
  restoreStatsFromPostgres,
  forceSync,
  getStatus,
};
