const config = require('../utils/config');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const { alertingService } = require('./alerting');
const { auditService, AUDIT_EVENTS } = require('./audit');

// =============================================================================
// Anomaly Thresholds (configurable via env vars)
// =============================================================================

const THRESHOLDS = {
  // Wallet anomalies
  WALLET_QUOTES_5MIN: parseInt(process.env.ANOMALY_WALLET_QUOTES) || 50,
  WALLET_SUBMITS_5MIN: parseInt(process.env.ANOMALY_WALLET_SUBMITS) || 30,
  WALLET_FAILURES_5MIN: parseInt(process.env.ANOMALY_WALLET_FAILURES) || 10,

  // IP anomalies
  IP_QUOTES_5MIN: parseInt(process.env.ANOMALY_IP_QUOTES) || 100,
  IP_SUBMITS_5MIN: parseInt(process.env.ANOMALY_IP_SUBMITS) || 50,

  // Global anomalies
  GLOBAL_ERROR_RATE_PERCENT: parseInt(process.env.ANOMALY_ERROR_RATE) || 20,
  GLOBAL_SECURITY_EVENTS_5MIN: parseInt(process.env.ANOMALY_SECURITY_EVENTS) || 20,

  // Fee payer anomalies
  PAYER_DRAIN_RATE_LAMPORTS_PER_MIN: parseInt(process.env.ANOMALY_DRAIN_RATE) || 100_000_000, // 0.1 SOL/min
};

// =============================================================================
// Anomaly Types
// =============================================================================

const ANOMALY_TYPES = {
  WALLET_HIGH_QUOTE_VOLUME: 'anomaly.wallet.high_quote_volume',
  WALLET_HIGH_SUBMIT_VOLUME: 'anomaly.wallet.high_submit_volume',
  WALLET_HIGH_FAILURE_RATE: 'anomaly.wallet.high_failure_rate',
  IP_HIGH_QUOTE_VOLUME: 'anomaly.ip.high_quote_volume',
  IP_HIGH_SUBMIT_VOLUME: 'anomaly.ip.high_submit_volume',
  GLOBAL_HIGH_ERROR_RATE: 'anomaly.global.high_error_rate',
  GLOBAL_SECURITY_SPIKE: 'anomaly.global.security_spike',
  PAYER_RAPID_DRAIN: 'anomaly.payer.rapid_drain',
};

// =============================================================================
// Anomaly Detection Service
// =============================================================================

class AnomalyDetector {
  constructor() {
    this.checkInterval = null;
    this.detectedAnomalies = new Map(); // For deduplication
    this.anomalyCooldownMs = 5 * 60 * 1000; // 5 minute cooldown per anomaly
    this.payerBalanceHistory = new Map(); // pubkey -> { balance, timestamp }[]
  }

  /**
   * Start anomaly detection
   */
  start(intervalMs = 30_000) {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.runChecks().catch(err => {
        logger.error('ANOMALY', 'Check failed', { error: err.message });
      });
    }, intervalMs);

    logger.info('ANOMALY', 'Anomaly detection started', { intervalMs });
  }

  /**
   * Stop anomaly detection
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('ANOMALY', 'Anomaly detection stopped');
    }
  }

  /**
   * Run all anomaly checks
   */
  async runChecks() {
    await this.checkGlobalAnomalies();
    await this.checkPayerDrainRate();
  }

  /**
   * Check for global anomalies
   */
  async checkGlobalAnomalies() {
    const securitySummary = auditService.getSecuritySummary(5);

    // Check for security event spike
    const totalSecurityEvents = Object.values(securitySummary).reduce((a, b) => a + b, 0);

    if (totalSecurityEvents >= THRESHOLDS.GLOBAL_SECURITY_EVENTS_5MIN) {
      await this.reportAnomaly(ANOMALY_TYPES.GLOBAL_SECURITY_SPIKE, {
        totalEvents: totalSecurityEvents,
        breakdown: securitySummary,
        threshold: THRESHOLDS.GLOBAL_SECURITY_EVENTS_5MIN,
      });
    }

    // Check error rate
    const allCounts = auditService.getAllEventCounts(5);
    const successCount = allCounts[AUDIT_EVENTS.SUBMIT_SUCCESS] || 0;
    const failureCount = (allCounts[AUDIT_EVENTS.SUBMIT_FAILED] || 0) +
                         (allCounts[AUDIT_EVENTS.SUBMIT_REJECTED] || 0);
    const totalSubmits = successCount + failureCount;

    if (totalSubmits > 10) { // Need minimum sample size
      const errorRate = (failureCount / totalSubmits) * 100;
      if (errorRate >= THRESHOLDS.GLOBAL_ERROR_RATE_PERCENT) {
        await this.reportAnomaly(ANOMALY_TYPES.GLOBAL_HIGH_ERROR_RATE, {
          errorRate: errorRate.toFixed(1),
          successCount,
          failureCount,
          threshold: THRESHOLDS.GLOBAL_ERROR_RATE_PERCENT,
        });
      }
    }
  }

  /**
   * Check for rapid fee payer balance drain
   */
  async checkPayerDrainRate() {
    try {
      const { getPayerBalances } = require('./fee-payer-pool');
      const balances = await getPayerBalances();
      const now = Date.now();

      for (const payer of balances) {
        const history = this.payerBalanceHistory.get(payer.pubkey) || [];

        // Add current balance to history
        history.push({ balance: payer.balance, timestamp: now });

        // Keep only last 5 minutes of history
        const cutoff = now - 5 * 60 * 1000;
        const recentHistory = history.filter(h => h.timestamp >= cutoff);
        this.payerBalanceHistory.set(payer.pubkey, recentHistory);

        // Check drain rate if we have enough history
        if (recentHistory.length >= 2) {
          const oldest = recentHistory[0];
          const newest = recentHistory[recentHistory.length - 1];
          const timeDiffMs = newest.timestamp - oldest.timestamp;
          const balanceDiff = oldest.balance - newest.balance;

          if (timeDiffMs > 60_000 && balanceDiff > 0) {
            // Calculate drain rate per minute
            const drainRatePerMin = (balanceDiff / timeDiffMs) * 60_000;

            if (drainRatePerMin >= THRESHOLDS.PAYER_DRAIN_RATE_LAMPORTS_PER_MIN) {
              await this.reportAnomaly(ANOMALY_TYPES.PAYER_RAPID_DRAIN, {
                pubkey: payer.pubkey.slice(0, 8) + '...',
                drainRatePerMin: Math.round(drainRatePerMin),
                drainRateSolPerMin: (drainRatePerMin / 1e9).toFixed(4),
                currentBalance: payer.balance,
                threshold: THRESHOLDS.PAYER_DRAIN_RATE_LAMPORTS_PER_MIN,
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error('ANOMALY', 'Failed to check payer drain rate', { error: error.message });
    }
  }

  /**
   * Track and check wallet activity
   */
  async trackWallet(wallet, activityType, ip) {
    if (!wallet) return;

    const count = await redis.trackWalletActivity(wallet, activityType);

    // Check thresholds
    if (activityType === 'quote' && count >= THRESHOLDS.WALLET_QUOTES_5MIN) {
      await this.reportAnomaly(ANOMALY_TYPES.WALLET_HIGH_QUOTE_VOLUME, {
        wallet: wallet.slice(0, 12),
        count,
        threshold: THRESHOLDS.WALLET_QUOTES_5MIN,
        ip,
      });
    }

    if (activityType === 'submit' && count >= THRESHOLDS.WALLET_SUBMITS_5MIN) {
      await this.reportAnomaly(ANOMALY_TYPES.WALLET_HIGH_SUBMIT_VOLUME, {
        wallet: wallet.slice(0, 12),
        count,
        threshold: THRESHOLDS.WALLET_SUBMITS_5MIN,
        ip,
      });
    }

    if (activityType === 'failure' && count >= THRESHOLDS.WALLET_FAILURES_5MIN) {
      await this.reportAnomaly(ANOMALY_TYPES.WALLET_HIGH_FAILURE_RATE, {
        wallet: wallet.slice(0, 12),
        count,
        threshold: THRESHOLDS.WALLET_FAILURES_5MIN,
        ip,
      });
    }

    return count;
  }

  /**
   * Track and check IP activity
   */
  async trackIp(ip, activityType) {
    if (!ip) return;

    const count = await redis.trackIpActivity(ip, activityType);

    // Check thresholds
    if (activityType === 'quote' && count >= THRESHOLDS.IP_QUOTES_5MIN) {
      await this.reportAnomaly(ANOMALY_TYPES.IP_HIGH_QUOTE_VOLUME, {
        ip,
        count,
        threshold: THRESHOLDS.IP_QUOTES_5MIN,
      });
    }

    if (activityType === 'submit' && count >= THRESHOLDS.IP_SUBMITS_5MIN) {
      await this.reportAnomaly(ANOMALY_TYPES.IP_HIGH_SUBMIT_VOLUME, {
        ip,
        count,
        threshold: THRESHOLDS.IP_SUBMITS_5MIN,
      });
    }

    return count;
  }

  /**
   * Report an anomaly (with deduplication)
   */
  async reportAnomaly(anomalyType, data) {
    const key = `${anomalyType}:${data.wallet || data.ip || 'global'}`;
    const lastReport = this.detectedAnomalies.get(key);

    // Check cooldown
    if (lastReport && Date.now() - lastReport < this.anomalyCooldownMs) {
      return;
    }

    this.detectedAnomalies.set(key, Date.now());

    // Log the anomaly
    logger.warn('ANOMALY', anomalyType, data);

    // Record in audit log
    auditService.log(anomalyType, data);

    // Send alert
    await alertingService.alert('ANOMALY_DETECTED', {
      type: anomalyType,
      ...data,
    });
  }

  /**
   * Get current anomaly status
   */
  getStatus() {
    const activeAnomalies = [];
    const now = Date.now();

    for (const [key, timestamp] of this.detectedAnomalies) {
      if (now - timestamp < this.anomalyCooldownMs) {
        activeAnomalies.push({
          key,
          detectedAt: new Date(timestamp).toISOString(),
          expiresIn: Math.round((this.anomalyCooldownMs - (now - timestamp)) / 1000),
        });
      }
    }

    return {
      activeAnomalies,
      thresholds: THRESHOLDS,
      securitySummary: auditService.getSecuritySummary(5),
    };
  }
}

// Singleton instance
const anomalyDetector = new AnomalyDetector();

module.exports = {
  anomalyDetector,
  ANOMALY_TYPES,
  THRESHOLDS,
};
