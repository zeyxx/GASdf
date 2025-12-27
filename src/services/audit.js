const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');

// =============================================================================
// Audit Event Types
// =============================================================================

const AUDIT_EVENTS = {
  // Quote events
  QUOTE_CREATED: 'quote.created',
  QUOTE_EXPIRED: 'quote.expired',
  QUOTE_REJECTED: 'quote.rejected',

  // Submit events
  SUBMIT_SUCCESS: 'submit.success',
  SUBMIT_FAILED: 'submit.failed',
  SUBMIT_REJECTED: 'submit.rejected',

  // Security events
  REPLAY_ATTACK_DETECTED: 'security.replay_attack',
  BLOCKHASH_EXPIRED: 'security.blockhash_expired',
  SIMULATION_FAILED: 'security.simulation_failed',
  FEE_PAYER_MISMATCH: 'security.fee_payer_mismatch',
  VALIDATION_FAILED: 'security.validation_failed',

  // Rate limiting events
  IP_RATE_LIMITED: 'ratelimit.ip',
  WALLET_RATE_LIMITED: 'ratelimit.wallet',

  // Circuit breaker events
  CIRCUIT_OPENED: 'circuit.opened',
  CIRCUIT_CLOSED: 'circuit.closed',

  // Fee payer events
  PAYER_RESERVATION_FAILED: 'payer.reservation_failed',
  PAYER_BALANCE_LOW: 'payer.balance_low',
  PAYER_MARKED_UNHEALTHY: 'payer.marked_unhealthy',
};

// =============================================================================
// Audit Log Storage
// =============================================================================

// In-memory buffer for high-frequency events (flushed to Redis periodically)
const auditBuffer = [];
const MAX_BUFFER_SIZE = 100;
const FLUSH_INTERVAL_MS = 10_000; // 10 seconds

// Redis key for audit logs
const AUDIT_KEY = 'audit:log';
const AUDIT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days retention

// Stats tracking
const eventCounts = new Map();
const eventCountsWindow = new Map(); // Last 5 minutes

// =============================================================================
// Audit Service
// =============================================================================

class AuditService {
  constructor() {
    this.enabled = true;
    this.flushInterval = null;
  }

  /**
   * Start the audit service
   */
  start() {
    if (this.flushInterval) return;

    this.flushInterval = setInterval(() => {
      this.flush().catch(err => {
        logger.error('AUDIT', 'Failed to flush audit buffer', { error: err.message });
      });
    }, FLUSH_INTERVAL_MS);

    // Clean up old window stats every minute
    setInterval(() => this.cleanupWindowStats(), 60_000);

    logger.info('AUDIT', 'Audit service started');
  }

  /**
   * Stop the audit service
   */
  async stop() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush
    await this.flush();
    logger.info('AUDIT', 'Audit service stopped');
  }

  /**
   * Log an audit event
   */
  log(eventType, data = {}) {
    const event = {
      type: eventType,
      timestamp: Date.now(),
      environment: config.ENV,
      network: config.NETWORK,
      ...data,
    };

    // Add to buffer
    auditBuffer.push(event);

    // Update stats
    this.updateStats(eventType);

    // Log to console in dev
    if (config.IS_DEV) {
      logger.debug('AUDIT', eventType, data);
    }

    // Flush if buffer is full
    if (auditBuffer.length >= MAX_BUFFER_SIZE) {
      this.flush().catch(() => {});
    }

    return event;
  }

  /**
   * Update event statistics
   */
  updateStats(eventType) {
    // Total counts
    eventCounts.set(eventType, (eventCounts.get(eventType) || 0) + 1);

    // Window counts (for rate detection)
    const now = Date.now();
    const windowKey = `${eventType}:${Math.floor(now / 60_000)}`; // Per-minute buckets
    eventCountsWindow.set(windowKey, (eventCountsWindow.get(windowKey) || 0) + 1);
  }

  /**
   * Clean up old window stats
   */
  cleanupWindowStats() {
    const now = Date.now();
    const cutoff = Math.floor(now / 60_000) - 5; // Keep last 5 minutes

    for (const key of eventCountsWindow.keys()) {
      const [, minute] = key.split(':');
      if (parseInt(minute) < cutoff) {
        eventCountsWindow.delete(key);
      }
    }
  }

  /**
   * Flush buffer to Redis
   */
  async flush() {
    if (auditBuffer.length === 0) return;

    const events = auditBuffer.splice(0, auditBuffer.length);

    try {
      await redis.appendAuditLog(events);
    } catch (error) {
      // Re-add events to buffer on failure
      auditBuffer.unshift(...events);
      throw error;
    }
  }

  /**
   * Get event counts for a time window
   */
  getEventCounts(eventType, minutes = 5) {
    const now = Date.now();
    let count = 0;

    for (let i = 0; i < minutes; i++) {
      const windowKey = `${eventType}:${Math.floor(now / 60_000) - i}`;
      count += eventCountsWindow.get(windowKey) || 0;
    }

    return count;
  }

  /**
   * Get all event counts for the last N minutes
   */
  getAllEventCounts(minutes = 5) {
    const counts = {};

    for (const eventType of Object.values(AUDIT_EVENTS)) {
      counts[eventType] = this.getEventCounts(eventType, minutes);
    }

    return counts;
  }

  /**
   * Get total event counts since startup
   */
  getTotalCounts() {
    return Object.fromEntries(eventCounts);
  }

  /**
   * Get security event summary
   */
  getSecuritySummary(minutes = 5) {
    return {
      replayAttacks: this.getEventCounts(AUDIT_EVENTS.REPLAY_ATTACK_DETECTED, minutes),
      blockhashExpired: this.getEventCounts(AUDIT_EVENTS.BLOCKHASH_EXPIRED, minutes),
      simulationFailed: this.getEventCounts(AUDIT_EVENTS.SIMULATION_FAILED, minutes),
      feePayerMismatch: this.getEventCounts(AUDIT_EVENTS.FEE_PAYER_MISMATCH, minutes),
      validationFailed: this.getEventCounts(AUDIT_EVENTS.VALIDATION_FAILED, minutes),
      ipRateLimited: this.getEventCounts(AUDIT_EVENTS.IP_RATE_LIMITED, minutes),
      walletRateLimited: this.getEventCounts(AUDIT_EVENTS.WALLET_RATE_LIMITED, minutes),
    };
  }
}

// Singleton instance
const auditService = new AuditService();

// =============================================================================
// Convenience Functions
// =============================================================================

function logQuoteCreated(data) {
  return auditService.log(AUDIT_EVENTS.QUOTE_CREATED, {
    quoteId: data.quoteId,
    userPubkey: data.userPubkey?.slice(0, 12),
    feePayer: data.feePayer?.slice(0, 12),
    paymentToken: data.paymentToken?.slice(0, 12),
    feeAmountLamports: data.feeAmountLamports,
    kTier: data.kTier,
    ip: data.ip,
  });
}

function logQuoteRejected(data) {
  return auditService.log(AUDIT_EVENTS.QUOTE_REJECTED, {
    reason: data.reason,
    code: data.code,
    userPubkey: data.userPubkey?.slice(0, 12),
    ip: data.ip,
  });
}

function logSubmitSuccess(data) {
  return auditService.log(AUDIT_EVENTS.SUBMIT_SUCCESS, {
    quoteId: data.quoteId,
    signature: data.signature,
    userPubkey: data.userPubkey?.slice(0, 12),
    feePayer: data.feePayer?.slice(0, 12),
    feeAmountLamports: data.feeAmountLamports,
    attempts: data.attempts,
    ip: data.ip,
  });
}

function logSubmitRejected(data) {
  return auditService.log(AUDIT_EVENTS.SUBMIT_REJECTED, {
    quoteId: data.quoteId,
    reason: data.reason,
    code: data.code,
    userPubkey: data.userPubkey?.slice(0, 12),
    ip: data.ip,
  });
}

function logSecurityEvent(eventType, data) {
  return auditService.log(eventType, {
    ...data,
    userPubkey: data.userPubkey?.slice(0, 12),
    ip: data.ip,
  });
}

function logRateLimited(type, data) {
  const eventType = type === 'wallet' ? AUDIT_EVENTS.WALLET_RATE_LIMITED : AUDIT_EVENTS.IP_RATE_LIMITED;
  return auditService.log(eventType, {
    wallet: data.wallet?.slice(0, 12),
    ip: data.ip,
    count: data.count,
    limit: data.limit,
  });
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  auditService,
  AUDIT_EVENTS,

  // Convenience functions
  logQuoteCreated,
  logQuoteRejected,
  logSubmitSuccess,
  logSubmitRejected,
  logSecurityEvent,
  logRateLimited,
};
