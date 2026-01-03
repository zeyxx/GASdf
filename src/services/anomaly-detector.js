const logger = require('../utils/logger');
const redis = require('../utils/redis');
const { alertingService } = require('./alerting');
const { auditService, AUDIT_EVENTS } = require('./audit');

// =============================================================================
// Anomaly Thresholds (configurable via env vars)
// =============================================================================

// Default thresholds (used until baseline is established)
const DEFAULT_THRESHOLDS = {
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

// Baseline learning configuration
const BASELINE_CONFIG = {
  LEARNING_PERIOD_MS: parseInt(process.env.BASELINE_LEARNING_PERIOD) || 30 * 60 * 1000, // 30 minutes
  MIN_SAMPLES: parseInt(process.env.BASELINE_MIN_SAMPLES) || 10,
  STDDEV_MULTIPLIER: parseFloat(process.env.BASELINE_STDDEV_MULTIPLIER) || 3.0, // mean + 3*stddev
  UPDATE_INTERVAL_MS: parseInt(process.env.BASELINE_UPDATE_INTERVAL) || 5 * 60 * 1000, // 5 minutes
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

    // Baseline learning state
    this.baseline = {
      startedAt: null,
      isLearning: false,
      isReady: false,
      samples: {
        quotesPerWallet: [],
        submitsPerWallet: [],
        quotesPerIP: [],
        submitsPerIP: [],
        errorRate: [],
        securityEvents: [],
        drainRate: [],
      },
      thresholds: { ...DEFAULT_THRESHOLDS },
      lastUpdateAt: null,
    };
  }

  /**
   * Calculate mean of an array
   */
  _mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Calculate standard deviation of an array
   */
  _stddev(arr) {
    if (arr.length < 2) return 0;
    const mean = this._mean(arr);
    const squaredDiffs = arr.map((x) => Math.pow(x - mean, 2));
    return Math.sqrt(this._mean(squaredDiffs));
  }

  /**
   * Calculate dynamic threshold: mean + (stddev * multiplier)
   * Falls back to default if not enough samples
   */
  _calculateThreshold(samples, defaultValue, minFloor = null) {
    if (samples.length < BASELINE_CONFIG.MIN_SAMPLES) {
      return defaultValue;
    }

    const mean = this._mean(samples);
    const stddev = this._stddev(samples);
    let threshold = mean + stddev * BASELINE_CONFIG.STDDEV_MULTIPLIER;

    // Apply minimum floor if specified (prevents threshold from being too low)
    if (minFloor !== null) {
      threshold = Math.max(threshold, minFloor);
    }

    // Never go below the default (for safety)
    return Math.max(threshold, defaultValue * 0.5);
  }

  /**
   * Start baseline learning
   */
  startBaselineLearning() {
    if (this.baseline.isLearning || this.baseline.isReady) {
      return;
    }

    this.baseline.startedAt = Date.now();
    this.baseline.isLearning = true;

    logger.info('ANOMALY', 'Baseline learning started', {
      learningPeriodMs: BASELINE_CONFIG.LEARNING_PERIOD_MS,
      minSamples: BASELINE_CONFIG.MIN_SAMPLES,
    });
  }

  /**
   * Record a sample for baseline learning
   */
  recordSample(metricName, value) {
    if (!this.baseline.isLearning && !this.baseline.isReady) {
      return;
    }

    const samples = this.baseline.samples[metricName];
    if (samples) {
      samples.push(value);

      // Keep only recent samples (last 1000)
      if (samples.length > 1000) {
        samples.shift();
      }
    }
  }

  /**
   * Update thresholds based on collected samples
   */
  updateThresholds() {
    const s = this.baseline.samples;

    this.baseline.thresholds = {
      WALLET_QUOTES_5MIN: this._calculateThreshold(
        s.quotesPerWallet,
        DEFAULT_THRESHOLDS.WALLET_QUOTES_5MIN,
        10 // Minimum 10 quotes threshold
      ),
      WALLET_SUBMITS_5MIN: this._calculateThreshold(
        s.submitsPerWallet,
        DEFAULT_THRESHOLDS.WALLET_SUBMITS_5MIN,
        5 // Minimum 5 submits threshold
      ),
      WALLET_FAILURES_5MIN: this._calculateThreshold(
        s.quotesPerWallet.map(() => 0), // Not directly sampled
        DEFAULT_THRESHOLDS.WALLET_FAILURES_5MIN,
        3
      ),
      IP_QUOTES_5MIN: this._calculateThreshold(
        s.quotesPerIP,
        DEFAULT_THRESHOLDS.IP_QUOTES_5MIN,
        20
      ),
      IP_SUBMITS_5MIN: this._calculateThreshold(
        s.submitsPerIP,
        DEFAULT_THRESHOLDS.IP_SUBMITS_5MIN,
        10
      ),
      GLOBAL_ERROR_RATE_PERCENT: this._calculateThreshold(
        s.errorRate,
        DEFAULT_THRESHOLDS.GLOBAL_ERROR_RATE_PERCENT,
        5 // Minimum 5% error rate threshold
      ),
      GLOBAL_SECURITY_EVENTS_5MIN: this._calculateThreshold(
        s.securityEvents,
        DEFAULT_THRESHOLDS.GLOBAL_SECURITY_EVENTS_5MIN,
        5
      ),
      PAYER_DRAIN_RATE_LAMPORTS_PER_MIN: this._calculateThreshold(
        s.drainRate,
        DEFAULT_THRESHOLDS.PAYER_DRAIN_RATE_LAMPORTS_PER_MIN,
        10_000_000 // Minimum 0.01 SOL/min
      ),
    };

    this.baseline.lastUpdateAt = Date.now();

    logger.info('ANOMALY', 'Thresholds updated from baseline', {
      sampleCounts: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.length])),
      newThresholds: this.baseline.thresholds,
    });
  }

  /**
   * Check if baseline learning period is complete
   */
  checkBaselineComplete() {
    if (!this.baseline.isLearning) return;

    const elapsed = Date.now() - this.baseline.startedAt;

    if (elapsed >= BASELINE_CONFIG.LEARNING_PERIOD_MS) {
      this.baseline.isLearning = false;
      this.baseline.isReady = true;
      this.updateThresholds();

      logger.info('ANOMALY', 'Baseline learning complete', {
        elapsedMs: elapsed,
        thresholds: this.baseline.thresholds,
      });
    }
  }

  /**
   * Get current thresholds (dynamic or default)
   */
  getThresholds() {
    return this.baseline.isReady ? this.baseline.thresholds : DEFAULT_THRESHOLDS;
  }

  /**
   * Get baseline status
   */
  getBaselineStatus() {
    return {
      isLearning: this.baseline.isLearning,
      isReady: this.baseline.isReady,
      startedAt: this.baseline.startedAt ? new Date(this.baseline.startedAt).toISOString() : null,
      lastUpdateAt: this.baseline.lastUpdateAt
        ? new Date(this.baseline.lastUpdateAt).toISOString()
        : null,
      sampleCounts: Object.fromEntries(
        Object.entries(this.baseline.samples).map(([k, v]) => [k, v.length])
      ),
      thresholds: this.getThresholds(),
      usingDynamicThresholds: this.baseline.isReady,
    };
  }

  /**
   * Start anomaly detection
   */
  start(intervalMs = 30_000) {
    if (this.checkInterval) return;

    // Start baseline learning on first start
    this.startBaselineLearning();

    this.checkInterval = setInterval(() => {
      this.runChecks().catch((err) => {
        logger.error('ANOMALY', 'Check failed', { error: err.message });
      });
    }, intervalMs);

    logger.info('ANOMALY', 'Anomaly detection started', {
      intervalMs,
      baselineLearning: this.baseline.isLearning,
    });
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
    // Check if baseline learning is complete
    this.checkBaselineComplete();

    // Periodically update thresholds if baseline is ready
    if (this.baseline.isReady && this.baseline.lastUpdateAt) {
      const timeSinceUpdate = Date.now() - this.baseline.lastUpdateAt;
      if (timeSinceUpdate >= BASELINE_CONFIG.UPDATE_INTERVAL_MS) {
        this.updateThresholds();
      }
    }

    await this.checkGlobalAnomalies();
    await this.checkPayerDrainRate();
  }

  /**
   * Check for global anomalies
   */
  async checkGlobalAnomalies() {
    const thresholds = this.getThresholds();
    const securitySummary = auditService.getSecuritySummary(5);

    // Check for security event spike
    const totalSecurityEvents = Object.values(securitySummary).reduce((a, b) => a + b, 0);

    // Record sample for baseline learning
    this.recordSample('securityEvents', totalSecurityEvents);

    if (totalSecurityEvents >= thresholds.GLOBAL_SECURITY_EVENTS_5MIN) {
      await this.reportAnomaly(ANOMALY_TYPES.GLOBAL_SECURITY_SPIKE, {
        totalEvents: totalSecurityEvents,
        breakdown: securitySummary,
        threshold: thresholds.GLOBAL_SECURITY_EVENTS_5MIN,
        usingDynamicThreshold: this.baseline.isReady,
      });
    }

    // Check error rate
    const allCounts = auditService.getAllEventCounts(5);
    const successCount = allCounts[AUDIT_EVENTS.SUBMIT_SUCCESS] || 0;
    const failureCount =
      (allCounts[AUDIT_EVENTS.SUBMIT_FAILED] || 0) + (allCounts[AUDIT_EVENTS.SUBMIT_REJECTED] || 0);
    const totalSubmits = successCount + failureCount;

    if (totalSubmits > 10) {
      // Need minimum sample size
      const errorRate = (failureCount / totalSubmits) * 100;

      // Record sample for baseline learning
      this.recordSample('errorRate', errorRate);

      if (errorRate >= thresholds.GLOBAL_ERROR_RATE_PERCENT) {
        await this.reportAnomaly(ANOMALY_TYPES.GLOBAL_HIGH_ERROR_RATE, {
          errorRate: errorRate.toFixed(1),
          successCount,
          failureCount,
          threshold: thresholds.GLOBAL_ERROR_RATE_PERCENT,
          usingDynamicThreshold: this.baseline.isReady,
        });
      }
    }
  }

  /**
   * Check for rapid fee payer balance drain
   */
  async checkPayerDrainRate() {
    try {
      const thresholds = this.getThresholds();
      const { getPayerBalances } = require('./fee-payer-pool');
      const balances = await getPayerBalances();
      const now = Date.now();

      for (const payer of balances) {
        const history = this.payerBalanceHistory.get(payer.pubkey) || [];

        // Add current balance to history
        history.push({ balance: payer.balance, timestamp: now });

        // Keep only last 5 minutes of history
        const cutoff = now - 5 * 60 * 1000;
        const recentHistory = history.filter((h) => h.timestamp >= cutoff);
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

            // Record sample for baseline learning (only positive drain rates)
            this.recordSample('drainRate', drainRatePerMin);

            if (drainRatePerMin >= thresholds.PAYER_DRAIN_RATE_LAMPORTS_PER_MIN) {
              await this.reportAnomaly(ANOMALY_TYPES.PAYER_RAPID_DRAIN, {
                pubkey: payer.pubkey.slice(0, 8) + '...',
                drainRatePerMin: Math.round(drainRatePerMin),
                drainRateSolPerMin: (drainRatePerMin / 1e9).toFixed(4),
                currentBalance: payer.balance,
                threshold: thresholds.PAYER_DRAIN_RATE_LAMPORTS_PER_MIN,
                usingDynamicThreshold: this.baseline.isReady,
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

    const thresholds = this.getThresholds();
    const count = await redis.trackWalletActivity(wallet, activityType);

    // Record samples for baseline learning
    if (activityType === 'quote') {
      this.recordSample('quotesPerWallet', count);
    } else if (activityType === 'submit') {
      this.recordSample('submitsPerWallet', count);
    }

    // Check thresholds
    if (activityType === 'quote' && count >= thresholds.WALLET_QUOTES_5MIN) {
      await this.reportAnomaly(ANOMALY_TYPES.WALLET_HIGH_QUOTE_VOLUME, {
        wallet: wallet.slice(0, 12),
        count,
        threshold: thresholds.WALLET_QUOTES_5MIN,
        ip,
        usingDynamicThreshold: this.baseline.isReady,
      });
    }

    if (activityType === 'submit' && count >= thresholds.WALLET_SUBMITS_5MIN) {
      await this.reportAnomaly(ANOMALY_TYPES.WALLET_HIGH_SUBMIT_VOLUME, {
        wallet: wallet.slice(0, 12),
        count,
        threshold: thresholds.WALLET_SUBMITS_5MIN,
        ip,
        usingDynamicThreshold: this.baseline.isReady,
      });
    }

    if (activityType === 'failure' && count >= thresholds.WALLET_FAILURES_5MIN) {
      await this.reportAnomaly(ANOMALY_TYPES.WALLET_HIGH_FAILURE_RATE, {
        wallet: wallet.slice(0, 12),
        count,
        threshold: thresholds.WALLET_FAILURES_5MIN,
        ip,
        usingDynamicThreshold: this.baseline.isReady,
      });
    }

    return count;
  }

  /**
   * Track and check IP activity
   */
  async trackIp(ip, activityType) {
    if (!ip) return;

    const thresholds = this.getThresholds();
    const count = await redis.trackIpActivity(ip, activityType);

    // Record samples for baseline learning
    if (activityType === 'quote') {
      this.recordSample('quotesPerIP', count);
    } else if (activityType === 'submit') {
      this.recordSample('submitsPerIP', count);
    }

    // Check thresholds
    if (activityType === 'quote' && count >= thresholds.IP_QUOTES_5MIN) {
      await this.reportAnomaly(ANOMALY_TYPES.IP_HIGH_QUOTE_VOLUME, {
        ip,
        count,
        threshold: thresholds.IP_QUOTES_5MIN,
        usingDynamicThreshold: this.baseline.isReady,
      });
    }

    if (activityType === 'submit' && count >= thresholds.IP_SUBMITS_5MIN) {
      await this.reportAnomaly(ANOMALY_TYPES.IP_HIGH_SUBMIT_VOLUME, {
        ip,
        count,
        threshold: thresholds.IP_SUBMITS_5MIN,
        usingDynamicThreshold: this.baseline.isReady,
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
      thresholds: this.getThresholds(),
      baseline: this.getBaselineStatus(),
      securitySummary: auditService.getSecuritySummary(5),
    };
  }
}

// Singleton instance
const anomalyDetector = new AnomalyDetector();

module.exports = {
  anomalyDetector,
  ANOMALY_TYPES,
  DEFAULT_THRESHOLDS,
  BASELINE_CONFIG,
};
