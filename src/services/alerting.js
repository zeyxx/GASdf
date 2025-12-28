const config = require('../utils/config');
const logger = require('../utils/logger');
const { fetchWithTimeout, WEBHOOK_TIMEOUT } = require('../utils/fetch-timeout');

// =============================================================================
// Alert Definitions
// =============================================================================

const SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
};

const ALERT_TYPES = {
  FEE_PAYER_LOW: {
    id: 'fee_payer_low',
    severity: SEVERITY.WARNING,
    title: 'Fee Payer Balance Low',
    message: (data) => `Fee payer ${data.pubkey} balance is low: ${data.balance} SOL`,
  },
  FEE_PAYER_CRITICAL: {
    id: 'fee_payer_critical',
    severity: SEVERITY.CRITICAL,
    title: 'Fee Payer Balance Critical',
    message: (data) => `Fee payer ${data.pubkey} balance critically low: ${data.balance} SOL`,
  },
  ALL_PAYERS_DOWN: {
    id: 'all_payers_down',
    severity: SEVERITY.CRITICAL,
    title: 'All Fee Payers Unhealthy',
    message: () => 'No healthy fee payers available! Service cannot process transactions.',
  },
  CIRCUIT_BREAKER_OPEN: {
    id: 'circuit_breaker_open',
    severity: SEVERITY.WARNING,
    title: 'Circuit Breaker Open',
    message: (data) => `Circuit breaker '${data.name}' is open after ${data.failures} failures`,
  },
  REDIS_DOWN: {
    id: 'redis_down',
    severity: SEVERITY.CRITICAL,
    title: 'Redis Connection Lost',
    message: () => 'Redis connection lost. Service may be degraded.',
  },
  HIGH_ERROR_RATE: {
    id: 'high_error_rate',
    severity: SEVERITY.WARNING,
    title: 'High Error Rate',
    message: (data) => `Error rate is ${data.rate}% over the last ${data.period}`,
  },
  RECOVERY: {
    id: 'recovery',
    severity: SEVERITY.INFO,
    title: 'Service Recovered',
    message: (data) => `${data.service} has recovered`,
  },

  // Security & Anomaly Alerts
  ANOMALY_DETECTED: {
    id: 'anomaly_detected',
    severity: SEVERITY.WARNING,
    title: 'Anomaly Detected',
    message: (data) => {
      switch (data.type) {
        case 'anomaly.wallet.high_quote_volume':
          return `Wallet ${data.wallet} generated ${data.count} quotes in 5min (threshold: ${data.threshold})`;
        case 'anomaly.wallet.high_submit_volume':
          return `Wallet ${data.wallet} submitted ${data.count} txs in 5min (threshold: ${data.threshold})`;
        case 'anomaly.wallet.high_failure_rate':
          return `Wallet ${data.wallet} has ${data.count} failures in 5min (threshold: ${data.threshold})`;
        case 'anomaly.ip.high_quote_volume':
          return `IP ${data.ip} generated ${data.count} quotes in 5min (threshold: ${data.threshold})`;
        case 'anomaly.global.security_spike':
          return `Security events spike: ${data.totalEvents} events in 5min (threshold: ${data.threshold})`;
        case 'anomaly.global.high_error_rate':
          return `High error rate: ${data.errorRate}% (threshold: ${data.threshold}%)`;
        case 'anomaly.payer.rapid_drain':
          return `Rapid drain on ${data.pubkey}: ${data.drainRateSolPerMin} SOL/min`;
        default:
          return `Anomaly detected: ${data.type}`;
      }
    },
  },
  SECURITY_EVENT: {
    id: 'security_event',
    severity: SEVERITY.WARNING,
    title: 'Security Event',
    message: (data) => {
      switch (data.type) {
        case 'security.replay_attack':
          return `Replay attack blocked from ${data.wallet || data.ip}`;
        case 'security.fee_payer_mismatch':
          return `Fee payer mismatch attempt from ${data.wallet || data.ip}`;
        default:
          return `Security event: ${data.type}`;
      }
    },
  },
};

// =============================================================================
// Alert State (deduplication)
// =============================================================================

const activeAlerts = new Map();
const alertHistory = [];
const MAX_HISTORY = 100;

// Cooldown period to prevent alert spam (5 minutes)
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

// =============================================================================
// Alerting Service
// =============================================================================

class AlertingService {
  constructor() {
    this.webhookUrl = config.ALERTING_WEBHOOK;
    this.enabled = !!this.webhookUrl;

    if (this.enabled) {
      logger.info('ALERTING', 'Alerting service initialized', {
        webhook: this.webhookUrl.replace(/\/[^/]+$/, '/***'),
      });
    }
  }

  /**
   * Send an alert
   */
  async alert(alertType, data = {}) {
    const alertDef = ALERT_TYPES[alertType];
    if (!alertDef) {
      logger.warn('ALERTING', 'Unknown alert type', { alertType });
      return;
    }

    const alertId = `${alertDef.id}:${data.pubkey || data.name || 'default'}`;

    // Check cooldown
    const lastAlert = activeAlerts.get(alertId);
    if (lastAlert && Date.now() - lastAlert.timestamp < ALERT_COOLDOWN_MS) {
      logger.debug('ALERTING', 'Alert in cooldown', { alertId });
      return;
    }

    const alert = {
      id: alertId,
      type: alertDef.id,
      severity: alertDef.severity,
      title: alertDef.title,
      message: alertDef.message(data),
      data,
      timestamp: Date.now(),
      environment: config.ENV,
      network: config.NETWORK,
    };

    // Track active alert
    activeAlerts.set(alertId, alert);

    // Add to history
    alertHistory.unshift(alert);
    if (alertHistory.length > MAX_HISTORY) {
      alertHistory.pop();
    }

    // Log the alert
    const logMethod = alertDef.severity === SEVERITY.CRITICAL ? 'error' :
                      alertDef.severity === SEVERITY.WARNING ? 'warn' : 'info';
    logger[logMethod]('ALERT', alert.message, {
      alertId,
      severity: alert.severity,
    });

    // Send webhook if configured
    if (this.enabled) {
      await this.sendWebhook(alert);
    }

    return alert;
  }

  /**
   * Clear an active alert (for recovery notifications)
   */
  async recover(alertType, data = {}) {
    const alertDef = ALERT_TYPES[alertType];
    if (!alertDef) return;

    const alertId = `${alertDef.id}:${data.pubkey || data.name || 'default'}`;

    if (activeAlerts.has(alertId)) {
      activeAlerts.delete(alertId);

      // Send recovery notification
      await this.alert('RECOVERY', {
        service: alertDef.title,
        ...data,
      });
    }
  }

  /**
   * Send webhook notification
   */
  async sendWebhook(alert) {
    if (!this.webhookUrl) return;

    try {
      // Detect webhook type and format accordingly
      const payload = this.formatWebhookPayload(alert);

      // ==========================================================================
      // TIMEOUT PROTECTION: Prevents hanging on slow/unresponsive webhook endpoints
      // ==========================================================================
      const response = await fetchWithTimeout(
        this.webhookUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        WEBHOOK_TIMEOUT
      );

      if (!response.ok) {
        logger.warn('ALERTING', 'Webhook request failed', {
          status: response.status,
          alertId: alert.id,
        });
      }
    } catch (error) {
      logger.error('ALERTING', 'Failed to send webhook', {
        error: error.message,
        code: error.code,
        alertId: alert.id,
      });
    }
  }

  /**
   * Format payload based on webhook URL (Slack, Discord, generic)
   */
  formatWebhookPayload(alert) {
    const url = this.webhookUrl.toLowerCase();

    // Slack format
    if (url.includes('slack.com') || url.includes('hooks.slack')) {
      return this.formatSlack(alert);
    }

    // Discord format
    if (url.includes('discord.com') || url.includes('discordapp.com')) {
      return this.formatDiscord(alert);
    }

    // Generic webhook format
    return this.formatGeneric(alert);
  }

  formatSlack(alert) {
    const color = alert.severity === SEVERITY.CRITICAL ? '#dc3545' :
                  alert.severity === SEVERITY.WARNING ? '#ffc107' : '#28a745';

    return {
      attachments: [{
        color,
        title: `[${alert.severity.toUpperCase()}] ${alert.title}`,
        text: alert.message,
        fields: [
          { title: 'Environment', value: alert.environment, short: true },
          { title: 'Network', value: alert.network, short: true },
        ],
        footer: 'GASdf Alerting',
        ts: Math.floor(alert.timestamp / 1000),
      }],
    };
  }

  formatDiscord(alert) {
    const color = alert.severity === SEVERITY.CRITICAL ? 0xdc3545 :
                  alert.severity === SEVERITY.WARNING ? 0xffc107 : 0x28a745;

    return {
      embeds: [{
        title: `[${alert.severity.toUpperCase()}] ${alert.title}`,
        description: alert.message,
        color,
        fields: [
          { name: 'Environment', value: alert.environment, inline: true },
          { name: 'Network', value: alert.network, inline: true },
        ],
        footer: { text: 'GASdf Alerting' },
        timestamp: new Date(alert.timestamp).toISOString(),
      }],
    };
  }

  formatGeneric(alert) {
    return {
      alert: {
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        timestamp: new Date(alert.timestamp).toISOString(),
        environment: alert.environment,
        network: alert.network,
        data: alert.data,
      },
    };
  }

  /**
   * Get active alerts
   */
  getActiveAlerts() {
    return Array.from(activeAlerts.values());
  }

  /**
   * Get alert history
   */
  getHistory(limit = 20) {
    return alertHistory.slice(0, limit);
  }

  /**
   * Check if alerting is enabled
   */
  isEnabled() {
    return this.enabled;
  }
}

// Singleton instance
const alertingService = new AlertingService();

// =============================================================================
// Monitoring Functions
// =============================================================================

/**
 * Check fee payer balances and send alerts
 */
async function checkFeePayerAlerts() {
  try {
    const { getPayerBalances, getHealthSummary } = require('./signer');
    const balances = await getPayerBalances();
    const summary = getHealthSummary();

    // Check for all payers down
    if (summary.healthy === 0 && summary.total > 0) {
      await alertingService.alert('ALL_PAYERS_DOWN', { total: summary.total });
    } else if (summary.healthy > 0) {
      await alertingService.recover('ALL_PAYERS_DOWN');
    }

    // Check individual payers
    for (const payer of balances) {
      if (payer.status === 'critical') {
        await alertingService.alert('FEE_PAYER_CRITICAL', {
          pubkey: payer.pubkey.slice(0, 8) + '...',
          balance: payer.balanceSol.toFixed(4),
        });
      } else if (payer.status === 'warning') {
        await alertingService.alert('FEE_PAYER_LOW', {
          pubkey: payer.pubkey.slice(0, 8) + '...',
          balance: payer.balanceSol.toFixed(4),
        });
      } else {
        await alertingService.recover('FEE_PAYER_CRITICAL', {
          pubkey: payer.pubkey.slice(0, 8) + '...',
        });
        await alertingService.recover('FEE_PAYER_LOW', {
          pubkey: payer.pubkey.slice(0, 8) + '...',
        });
      }
    }
  } catch (error) {
    logger.error('ALERTING', 'Failed to check fee payer alerts', { error: error.message });
  }
}

/**
 * Check circuit breaker alerts
 */
function checkCircuitBreakerAlerts() {
  try {
    const { getAllStatus } = require('../utils/circuit-breaker');
    const breakers = getAllStatus();

    for (const [name, status] of Object.entries(breakers)) {
      if (status.state === 'open') {
        alertingService.alert('CIRCUIT_BREAKER_OPEN', {
          name,
          failures: status.failures,
        });
      } else if (status.state === 'closed') {
        alertingService.recover('CIRCUIT_BREAKER_OPEN', { name });
      }
    }
  } catch (error) {
    logger.error('ALERTING', 'Failed to check circuit breaker alerts', { error: error.message });
  }
}

/**
 * Check Redis connection alerts
 */
function checkRedisAlerts() {
  try {
    const redis = require('../utils/redis');
    const state = redis.getConnectionState();

    if (!state.isHealthy && !state.isMemoryFallback) {
      alertingService.alert('REDIS_DOWN');
    } else if (state.isHealthy) {
      alertingService.recover('REDIS_DOWN');
    }
  } catch (error) {
    logger.error('ALERTING', 'Failed to check Redis alerts', { error: error.message });
  }
}

/**
 * Check fee payer pool circuit breaker
 */
function checkFeePayerPoolCircuitBreaker() {
  try {
    const { isCircuitOpen, getCircuitState } = require('./fee-payer-pool');

    if (isCircuitOpen()) {
      const state = getCircuitState();
      alertingService.alert('CIRCUIT_BREAKER_OPEN', {
        name: 'fee_payer_pool',
        failures: state.consecutiveFailures,
      });
    } else {
      alertingService.recover('CIRCUIT_BREAKER_OPEN', { name: 'fee_payer_pool' });
    }
  } catch (error) {
    logger.error('ALERTING', 'Failed to check fee payer pool circuit breaker', { error: error.message });
  }
}

/**
 * Start monitoring loop
 */
let monitoringInterval = null;

function startMonitoring(intervalMs = 60000) {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  logger.info('ALERTING', 'Starting alert monitoring', { intervalMs });

  // Start anomaly detector
  try {
    const { anomalyDetector } = require('./anomaly-detector');
    anomalyDetector.start(30_000); // Check every 30 seconds
  } catch (error) {
    logger.warn('ALERTING', 'Failed to start anomaly detector', { error: error.message });
  }

  // Start audit service
  try {
    const { auditService } = require('./audit');
    auditService.start();
  } catch (error) {
    logger.warn('ALERTING', 'Failed to start audit service', { error: error.message });
  }

  // Run checks immediately
  runAllChecks();

  // Then run periodically
  monitoringInterval = setInterval(runAllChecks, intervalMs);
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }

  // Stop anomaly detector
  try {
    const { anomalyDetector } = require('./anomaly-detector');
    anomalyDetector.stop();
  } catch (error) {
    // Ignore
  }

  // Stop audit service
  try {
    const { auditService } = require('./audit');
    auditService.stop();
  } catch (error) {
    // Ignore
  }

  logger.info('ALERTING', 'Stopped alert monitoring');
}

async function runAllChecks() {
  await checkFeePayerAlerts();
  checkCircuitBreakerAlerts();
  checkFeePayerPoolCircuitBreaker();
  checkRedisAlerts();
}

module.exports = {
  alertingService,
  ALERT_TYPES,
  SEVERITY,

  // Check functions
  checkFeePayerAlerts,
  checkCircuitBreakerAlerts,
  checkRedisAlerts,

  // Monitoring
  startMonitoring,
  stopMonitoring,
  runAllChecks,
};
