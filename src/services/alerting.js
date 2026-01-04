const config = require('../utils/config');
const logger = require('../utils/logger');
const { fetchWithTimeout, WEBHOOK_TIMEOUT } = require('../utils/fetch-timeout');

// Webhook retry configuration
const WEBHOOK_MAX_RETRIES = 3;
const WEBHOOK_INITIAL_DELAY_MS = 1000; // 1 second
const WEBHOOK_MAX_DELAY_MS = 10000; // 10 seconds

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
    message: (data) => {
      const lines = [`Fee payer ${data.pubkey} balance is low: ${data.balance} SOL`];
      if (data.txPossible !== undefined) {
        lines.push(`Tx remaining: ~${data.txPossible.toLocaleString()}`);
      }
      if (data.threshold) {
        lines.push(`Warning threshold: ${data.threshold} SOL`);
      }
      if (data.reservations !== undefined) {
        lines.push(`Active reservations: ${data.reservations}`);
      }
      return lines.join('\n');
    },
  },
  FEE_PAYER_CRITICAL: {
    id: 'fee_payer_critical',
    severity: SEVERITY.CRITICAL,
    title: 'Fee Payer Balance Critical',
    message: (data) => {
      const lines = [`Fee payer ${data.pubkey} balance critically low: ${data.balance} SOL`];
      if (data.txPossible !== undefined) {
        lines.push(`Tx remaining: ~${data.txPossible.toLocaleString()}`);
      }
      if (data.threshold) {
        lines.push(`Critical threshold: ${data.threshold} SOL`);
      }
      if (data.reservations !== undefined) {
        lines.push(`Active reservations: ${data.reservations}`);
      }
      if (data.action) {
        lines.push(`Action: ${data.action}`);
      }
      return lines.join('\n');
    },
  },
  ALL_PAYERS_DOWN: {
    id: 'all_payers_down',
    severity: SEVERITY.CRITICAL,
    title: 'All Fee Payers Unhealthy',
    message: (data = {}) => {
      const lines = ['No healthy fee payers available! Service cannot process transactions.'];
      if (data.total !== undefined) {
        lines.push(`Total payers: ${data.total}`);
      }
      if (data.payers && data.payers.length > 0) {
        lines.push('Status by payer:');
        for (const p of data.payers) {
          lines.push(`  • ${p.pubkey}: ${p.balance} SOL (${p.reason || p.status})`);
        }
      }
      if (data.circuitBreakerOpen) {
        lines.push('Circuit breaker: OPEN');
      }
      return lines.join('\n');
    },
  },
  CIRCUIT_BREAKER_OPEN: {
    id: 'circuit_breaker_open',
    severity: SEVERITY.WARNING,
    title: 'Circuit Breaker Open',
    message: (data) => {
      const lines = [`Circuit breaker '${data.name}' is open after ${data.failures} failures`];
      if (data.lastError) {
        lines.push(`Last error: ${data.lastError}`);
      }
      if (data.timeUntilRetry) {
        lines.push(`Retry in: ${Math.ceil(data.timeUntilRetry / 1000)}s`);
      }
      if (data.successRate !== undefined) {
        lines.push(`Success rate: ${data.successRate}%`);
      }
      return lines.join('\n');
    },
  },
  REDIS_DOWN: {
    id: 'redis_down',
    severity: SEVERITY.CRITICAL,
    title: 'Redis Connection Lost',
    message: (data = {}) => {
      const lines = ['Redis connection lost. Service may be degraded.'];
      if (data.error) {
        lines.push(`Error: ${data.error}`);
      }
      if (data.reconnectAttempts !== undefined) {
        lines.push(`Reconnect attempts: ${data.reconnectAttempts}`);
      }
      if (data.fallbackActive) {
        lines.push('Memory fallback: ACTIVE');
      }
      return lines.join('\n');
    },
  },
  HIGH_ERROR_RATE: {
    id: 'high_error_rate',
    severity: SEVERITY.WARNING,
    title: 'High Error Rate',
    message: (data) => {
      const lines = [`Error rate is ${data.rate}% over the last ${data.period}`];
      if (data.errorCount !== undefined && data.totalCount !== undefined) {
        lines.push(`Errors: ${data.errorCount}/${data.totalCount} requests`);
      }
      if (data.topErrors && data.topErrors.length > 0) {
        lines.push('Top errors:');
        for (const err of data.topErrors.slice(0, 3)) {
          lines.push(`  • ${err.message}: ${err.count}x`);
        }
      }
      return lines.join('\n');
    },
  },
  RECOVERY: {
    id: 'recovery',
    severity: SEVERITY.INFO,
    title: 'Service Recovered',
    message: (data) => {
      const lines = [`${data.service} has recovered`];
      if (data.downtime) {
        lines.push(`Downtime: ${data.downtime}`);
      }
      if (data.currentStatus) {
        lines.push(`Current status: ${data.currentStatus}`);
      }
      if (data.balance) {
        lines.push(`Balance: ${data.balance} SOL`);
      }
      return lines.join('\n');
    },
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
    const logMethod =
      alertDef.severity === SEVERITY.CRITICAL
        ? 'error'
        : alertDef.severity === SEVERITY.WARNING
          ? 'warn'
          : 'info';
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
   * Send webhook notification with retry logic
   * Uses exponential backoff: 1s, 2s, 4s (capped at 10s)
   */
  async sendWebhook(alert) {
    if (!this.webhookUrl) return;

    const payload = this.formatWebhookPayload(alert);
    let lastError = null;

    for (let attempt = 1; attempt <= WEBHOOK_MAX_RETRIES; attempt++) {
      try {
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

        if (response.ok) {
          if (attempt > 1) {
            logger.info('ALERTING', 'Webhook succeeded after retry', {
              alertId: alert.id,
              attempt,
            });
          }
          return; // Success
        }

        // Non-retryable status codes
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          logger.warn('ALERTING', 'Webhook request failed (non-retryable)', {
            status: response.status,
            alertId: alert.id,
          });
          return; // Don't retry 4xx errors (except 429)
        }

        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }

      // Log retry attempt
      if (attempt < WEBHOOK_MAX_RETRIES) {
        const delay = Math.min(
          WEBHOOK_INITIAL_DELAY_MS * Math.pow(2, attempt - 1),
          WEBHOOK_MAX_DELAY_MS
        );
        logger.debug('ALERTING', 'Webhook failed, retrying...', {
          alertId: alert.id,
          attempt,
          nextRetryMs: delay,
          error: lastError?.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // All retries exhausted
    logger.error('ALERTING', 'Failed to send webhook after retries', {
      error: lastError?.message,
      code: lastError?.code,
      alertId: alert.id,
      attempts: WEBHOOK_MAX_RETRIES,
    });
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
    const color =
      alert.severity === SEVERITY.CRITICAL
        ? '#dc3545'
        : alert.severity === SEVERITY.WARNING
          ? '#ffc107'
          : '#28a745';

    return {
      attachments: [
        {
          color,
          title: `[${alert.severity.toUpperCase()}] ${alert.title}`,
          text: alert.message,
          fields: [
            { title: 'Environment', value: alert.environment, short: true },
            { title: 'Network', value: alert.network, short: true },
          ],
          footer: 'GASdf Alerting',
          ts: Math.floor(alert.timestamp / 1000),
        },
      ],
    };
  }

  formatDiscord(alert) {
    const color =
      alert.severity === SEVERITY.CRITICAL
        ? 0xdc3545
        : alert.severity === SEVERITY.WARNING
          ? 0xffc107
          : 0x28a745;

    return {
      embeds: [
        {
          title: `[${alert.severity.toUpperCase()}] ${alert.title}`,
          description: alert.message,
          color,
          fields: [
            { name: 'Environment', value: alert.environment, inline: true },
            { name: 'Network', value: alert.network, inline: true },
          ],
          footer: { text: 'GASdf Alerting' },
          timestamp: new Date(alert.timestamp).toISOString(),
        },
      ],
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
 * Skips alerting if balance data is stale (RPC failures)
 */
async function checkFeePayerAlerts() {
  try {
    const {
      getPayerBalances,
      getHealthSummary,
      isCircuitOpen,
      CRITICAL_BALANCE,
      WARNING_BALANCE,
    } = require('./signer');
    const { pool } = require('./fee-payer-pool');

    const balances = await getPayerBalances();
    const summary = getHealthSummary();

    // Skip alerting if balance data is stale (RPC failed)
    // This prevents false "0 SOL" alerts when Helius returns 429
    if (summary.isStale) {
      logger.debug('ALERTING', 'Skipping fee payer alerts - balance data is stale', {
        lastRefresh: summary.lastRefresh,
        ageMs: Date.now() - summary.lastRefresh,
      });
      return;
    }

    // Check for all payers down (only if we have fresh data)
    if (summary.healthy === 0 && summary.total > 0) {
      // Build detailed payer status
      const payerDetails = balances.map((p) => ({
        pubkey: p.pubkey.slice(0, 8) + '...',
        balance: p.balanceSol.toFixed(4),
        status: p.status,
        reason: p.status === 'critical' ? 'balance_critical' : p.isHealthy ? 'ok' : 'unhealthy',
      }));

      await alertingService.alert('ALL_PAYERS_DOWN', {
        total: summary.total,
        payers: payerDetails,
        circuitBreakerOpen: isCircuitOpen ? isCircuitOpen() : false,
      });
    } else if (summary.healthy > 0) {
      await alertingService.recover('ALL_PAYERS_DOWN', {
        currentStatus: `${summary.healthy}/${summary.total} healthy`,
      });
    }

    // Constants for thresholds (in SOL)
    const criticalThresholdSol = (CRITICAL_BALANCE || 50_000_000) / 1e9;
    const warningThresholdSol = (WARNING_BALANCE || 200_000_000) / 1e9;
    const avgTxCost = 5000; // lamports per tx

    // Check individual payers
    for (const payer of balances) {
      // Skip if this payer's data is stale
      if (payer.isStale) {
        logger.debug('ALERTING', 'Skipping payer alert - stale data', {
          pubkey: payer.pubkey.slice(0, 8),
          error: payer.refreshError,
        });
        continue;
      }

      const pubkeyShort = payer.pubkey.slice(0, 8) + '...';
      const txPossible = Math.floor(payer.balance / avgTxCost);
      const reservationCount = pool?.reservationsByPayer?.get(payer.pubkey)?.size || 0;

      if (payer.status === 'critical') {
        await alertingService.alert('FEE_PAYER_CRITICAL', {
          pubkey: pubkeyShort,
          balance: payer.balanceSol.toFixed(4),
          txPossible,
          threshold: criticalThresholdSol.toFixed(2),
          reservations: reservationCount,
          action: 'Fund immediately or service will halt',
        });
      } else if (payer.status === 'warning') {
        await alertingService.alert('FEE_PAYER_LOW', {
          pubkey: pubkeyShort,
          balance: payer.balanceSol.toFixed(4),
          txPossible,
          threshold: warningThresholdSol.toFixed(2),
          reservations: reservationCount,
        });
      } else {
        await alertingService.recover('FEE_PAYER_CRITICAL', {
          pubkey: pubkeyShort,
          balance: payer.balanceSol.toFixed(4),
          currentStatus: 'healthy',
        });
        await alertingService.recover('FEE_PAYER_LOW', {
          pubkey: pubkeyShort,
          balance: payer.balanceSol.toFixed(4),
          currentStatus: 'healthy',
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
        const timeUntilRetry = status.openedAt
          ? Math.max(0, status.openedAt + status.resetTimeout - Date.now())
          : 0;

        alertingService.alert('CIRCUIT_BREAKER_OPEN', {
          name,
          failures: status.failures,
          lastError: status.lastError || null,
          timeUntilRetry,
          successRate:
            status.stats?.successRate !== 'N/A'
              ? parseFloat(status.stats?.successRate || 0).toFixed(1)
              : undefined,
        });
      } else if (status.state === 'closed') {
        alertingService.recover('CIRCUIT_BREAKER_OPEN', {
          name,
          currentStatus: 'closed',
        });
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
      alertingService.alert('REDIS_DOWN', {
        error: state.lastError || 'Connection failed',
        reconnectAttempts: state.reconnectAttempts || 0,
        fallbackActive: state.isMemoryFallback || false,
      });
    } else if (state.isHealthy) {
      alertingService.recover('REDIS_DOWN', {
        currentStatus: 'connected',
      });
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
      const timeUntilRetry = state.closesAt ? Math.max(0, state.closesAt - Date.now()) : 0;

      alertingService.alert('CIRCUIT_BREAKER_OPEN', {
        name: 'fee_payer_pool',
        failures: state.consecutiveFailures,
        timeUntilRetry,
        totalReservations: state.totalReservations || 0,
      });
    } else {
      alertingService.recover('CIRCUIT_BREAKER_OPEN', {
        name: 'fee_payer_pool',
        currentStatus: 'closed',
      });
    }
  } catch (error) {
    logger.error('ALERTING', 'Failed to check fee payer pool circuit breaker', {
      error: error.message,
    });
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
