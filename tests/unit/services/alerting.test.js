/**
 * Tests for Alerting Service
 */

const { alertingService, ALERT_TYPES, SEVERITY } = require('../../../src/services/alerting');

// Mock fetch for webhook tests
global.fetch = jest.fn();

// Mock dependencies
jest.mock('../../../src/utils/config', () => ({
  ENV: 'test',
  NETWORK: 'devnet',
  ALERTING_WEBHOOK: null, // Disabled by default
  IS_DEV: true,
}));

describe('Alerting Service', () => {
  beforeEach(() => {
    global.fetch.mockReset();
  });

  describe('SEVERITY constants', () => {
    it('should define INFO severity', () => {
      expect(SEVERITY.INFO).toBe('info');
    });

    it('should define WARNING severity', () => {
      expect(SEVERITY.WARNING).toBe('warning');
    });

    it('should define CRITICAL severity', () => {
      expect(SEVERITY.CRITICAL).toBe('critical');
    });
  });

  describe('ALERT_TYPES', () => {
    it('should define FEE_PAYER_LOW alert', () => {
      expect(ALERT_TYPES.FEE_PAYER_LOW).toBeDefined();
      expect(ALERT_TYPES.FEE_PAYER_LOW.severity).toBe(SEVERITY.WARNING);
      expect(ALERT_TYPES.FEE_PAYER_LOW.id).toBe('fee_payer_low');
    });

    it('should define FEE_PAYER_CRITICAL alert', () => {
      expect(ALERT_TYPES.FEE_PAYER_CRITICAL).toBeDefined();
      expect(ALERT_TYPES.FEE_PAYER_CRITICAL.severity).toBe(SEVERITY.CRITICAL);
    });

    it('should define ALL_PAYERS_DOWN alert', () => {
      expect(ALERT_TYPES.ALL_PAYERS_DOWN).toBeDefined();
      expect(ALERT_TYPES.ALL_PAYERS_DOWN.severity).toBe(SEVERITY.CRITICAL);
    });

    it('should define CIRCUIT_BREAKER_OPEN alert', () => {
      expect(ALERT_TYPES.CIRCUIT_BREAKER_OPEN).toBeDefined();
      expect(ALERT_TYPES.CIRCUIT_BREAKER_OPEN.severity).toBe(SEVERITY.WARNING);
    });

    it('should define REDIS_DOWN alert', () => {
      expect(ALERT_TYPES.REDIS_DOWN).toBeDefined();
      expect(ALERT_TYPES.REDIS_DOWN.severity).toBe(SEVERITY.CRITICAL);
    });

    it('should define HIGH_ERROR_RATE alert', () => {
      expect(ALERT_TYPES.HIGH_ERROR_RATE).toBeDefined();
      expect(ALERT_TYPES.HIGH_ERROR_RATE.severity).toBe(SEVERITY.WARNING);
    });

    it('should define RECOVERY alert', () => {
      expect(ALERT_TYPES.RECOVERY).toBeDefined();
      expect(ALERT_TYPES.RECOVERY.severity).toBe(SEVERITY.INFO);
    });

    it('should define ANOMALY_DETECTED alert', () => {
      expect(ALERT_TYPES.ANOMALY_DETECTED).toBeDefined();
      expect(ALERT_TYPES.ANOMALY_DETECTED.severity).toBe(SEVERITY.WARNING);
    });

    it('should define SECURITY_EVENT alert', () => {
      expect(ALERT_TYPES.SECURITY_EVENT).toBeDefined();
      expect(ALERT_TYPES.SECURITY_EVENT.severity).toBe(SEVERITY.WARNING);
    });
  });

  describe('Alert message formatters', () => {
    it('should format FEE_PAYER_LOW message', () => {
      const message = ALERT_TYPES.FEE_PAYER_LOW.message({
        pubkey: 'abc123...',
        balance: '0.05',
      });
      expect(message).toContain('abc123...');
      expect(message).toContain('0.05');
    });

    it('should format FEE_PAYER_CRITICAL message', () => {
      const message = ALERT_TYPES.FEE_PAYER_CRITICAL.message({
        pubkey: 'def456...',
        balance: '0.001',
      });
      expect(message).toContain('critically low');
    });

    it('should format ALL_PAYERS_DOWN message', () => {
      const message = ALERT_TYPES.ALL_PAYERS_DOWN.message();
      expect(message).toContain('No healthy fee payers');
    });

    it('should format CIRCUIT_BREAKER_OPEN message', () => {
      const message = ALERT_TYPES.CIRCUIT_BREAKER_OPEN.message({
        name: 'jupiter',
        failures: 5,
      });
      expect(message).toContain('jupiter');
      expect(message).toContain('5');
    });

    it('should format REDIS_DOWN message', () => {
      const message = ALERT_TYPES.REDIS_DOWN.message();
      expect(message).toContain('Redis');
    });

    it('should format HIGH_ERROR_RATE message', () => {
      const message = ALERT_TYPES.HIGH_ERROR_RATE.message({
        rate: '15',
        period: '5 minutes',
      });
      expect(message).toContain('15%');
    });

    it('should format RECOVERY message', () => {
      const message = ALERT_TYPES.RECOVERY.message({
        service: 'Redis Connection',
      });
      expect(message).toContain('recovered');
    });

    describe('ANOMALY_DETECTED message formatting', () => {
      it('should format high quote volume anomaly', () => {
        const message = ALERT_TYPES.ANOMALY_DETECTED.message({
          type: 'anomaly.wallet.high_quote_volume',
          wallet: 'wallet123',
          count: 100,
          threshold: 50,
        });
        expect(message).toContain('wallet123');
        expect(message).toContain('100');
      });

      it('should format high submit volume anomaly', () => {
        const message = ALERT_TYPES.ANOMALY_DETECTED.message({
          type: 'anomaly.wallet.high_submit_volume',
          wallet: 'wallet456',
          count: 200,
          threshold: 100,
        });
        expect(message).toContain('submitted');
      });

      it('should format high failure rate anomaly', () => {
        const message = ALERT_TYPES.ANOMALY_DETECTED.message({
          type: 'anomaly.wallet.high_failure_rate',
          wallet: 'wallet789',
          count: 50,
          threshold: 20,
        });
        expect(message).toContain('failures');
      });

      it('should format IP high quote volume anomaly', () => {
        const message = ALERT_TYPES.ANOMALY_DETECTED.message({
          type: 'anomaly.ip.high_quote_volume',
          ip: '192.168.1.1',
          count: 500,
          threshold: 100,
        });
        expect(message).toContain('192.168.1.1');
      });

      it('should format security spike anomaly', () => {
        const message = ALERT_TYPES.ANOMALY_DETECTED.message({
          type: 'anomaly.global.security_spike',
          totalEvents: 100,
          threshold: 50,
        });
        expect(message).toContain('Security events spike');
      });

      it('should format high error rate anomaly', () => {
        const message = ALERT_TYPES.ANOMALY_DETECTED.message({
          type: 'anomaly.global.high_error_rate',
          errorRate: 25,
          threshold: 10,
        });
        expect(message).toContain('25%');
      });

      it('should format rapid drain anomaly', () => {
        const message = ALERT_TYPES.ANOMALY_DETECTED.message({
          type: 'anomaly.payer.rapid_drain',
          pubkey: 'payer123',
          drainRateSolPerMin: 0.5,
        });
        expect(message).toContain('Rapid drain');
      });

      it('should handle unknown anomaly type', () => {
        const message = ALERT_TYPES.ANOMALY_DETECTED.message({
          type: 'anomaly.unknown',
        });
        expect(message).toContain('Anomaly detected');
      });
    });

    describe('SECURITY_EVENT message formatting', () => {
      it('should format replay attack event', () => {
        const message = ALERT_TYPES.SECURITY_EVENT.message({
          type: 'security.replay_attack',
          wallet: 'attacker123',
        });
        expect(message).toContain('Replay attack');
      });

      it('should format fee payer mismatch event', () => {
        const message = ALERT_TYPES.SECURITY_EVENT.message({
          type: 'security.fee_payer_mismatch',
          ip: '10.0.0.1',
        });
        expect(message).toContain('Fee payer mismatch');
      });

      it('should handle unknown security event', () => {
        const message = ALERT_TYPES.SECURITY_EVENT.message({
          type: 'security.unknown',
        });
        expect(message).toContain('Security event');
      });
    });
  });

  describe('AlertingService', () => {
    describe('isEnabled()', () => {
      it('should return false when webhook not configured', () => {
        expect(alertingService.isEnabled()).toBe(false);
      });
    });

    describe('getActiveAlerts()', () => {
      it('should return array of active alerts', () => {
        const alerts = alertingService.getActiveAlerts();
        expect(Array.isArray(alerts)).toBe(true);
      });
    });

    describe('getHistory()', () => {
      it('should return alert history', () => {
        const history = alertingService.getHistory();
        expect(Array.isArray(history)).toBe(true);
      });

      it('should respect limit parameter', () => {
        const history = alertingService.getHistory(5);
        expect(history.length).toBeLessThanOrEqual(5);
      });
    });

    describe('alert()', () => {
      it('should handle unknown alert type gracefully', async () => {
        const result = await alertingService.alert('UNKNOWN_TYPE');
        expect(result).toBeUndefined();
      });
    });
  });

  describe('Webhook payload formatting', () => {
    it('should format Slack payload', () => {
      // Access the internal method
      const mockAlert = {
        id: 'test:1',
        type: 'fee_payer_low',
        severity: SEVERITY.WARNING,
        title: 'Test Alert',
        message: 'Test message',
        timestamp: Date.now(),
        environment: 'test',
        network: 'devnet',
      };

      // Test Slack format
      const slackPayload = alertingService.formatSlack(mockAlert);
      expect(slackPayload.attachments).toBeDefined();
      expect(slackPayload.attachments[0].title).toContain('WARNING');
      expect(slackPayload.attachments[0].color).toBe('#ffc107');
    });

    it('should format Discord payload', () => {
      const mockAlert = {
        id: 'test:2',
        type: 'fee_payer_critical',
        severity: SEVERITY.CRITICAL,
        title: 'Critical Alert',
        message: 'Critical message',
        timestamp: Date.now(),
        environment: 'test',
        network: 'devnet',
      };

      const discordPayload = alertingService.formatDiscord(mockAlert);
      expect(discordPayload.embeds).toBeDefined();
      expect(discordPayload.embeds[0].title).toContain('CRITICAL');
      expect(discordPayload.embeds[0].color).toBe(0xdc3545);
    });

    it('should format generic payload', () => {
      const mockAlert = {
        id: 'test:3',
        type: 'recovery',
        severity: SEVERITY.INFO,
        title: 'Recovery',
        message: 'Service recovered',
        timestamp: Date.now(),
        environment: 'test',
        network: 'devnet',
        data: { service: 'redis' },
      };

      const genericPayload = alertingService.formatGeneric(mockAlert);
      expect(genericPayload.alert).toBeDefined();
      expect(genericPayload.alert.id).toBe('test:3');
      expect(genericPayload.alert.data).toEqual({ service: 'redis' });
    });

    it('should use correct color for INFO severity in Slack', () => {
      const mockAlert = {
        severity: SEVERITY.INFO,
        title: 'Info',
        message: 'Info message',
        timestamp: Date.now(),
        environment: 'test',
        network: 'devnet',
      };

      const slackPayload = alertingService.formatSlack(mockAlert);
      expect(slackPayload.attachments[0].color).toBe('#28a745');
    });

    it('should use correct color for INFO severity in Discord', () => {
      const mockAlert = {
        severity: SEVERITY.INFO,
        title: 'Info',
        message: 'Info message',
        timestamp: Date.now(),
        environment: 'test',
        network: 'devnet',
      };

      const discordPayload = alertingService.formatDiscord(mockAlert);
      expect(discordPayload.embeds[0].color).toBe(0x28a745);
    });

    it('should route to Slack format for slack.com URLs', () => {
      const originalUrl = alertingService.webhookUrl;
      alertingService.webhookUrl = 'https://hooks.slack.com/services/xxx';

      const mockAlert = {
        severity: SEVERITY.WARNING,
        title: 'Test',
        message: 'Test',
        timestamp: Date.now(),
        environment: 'test',
        network: 'devnet',
      };

      const payload = alertingService.formatWebhookPayload(mockAlert);
      expect(payload.attachments).toBeDefined();

      alertingService.webhookUrl = originalUrl;
    });

    it('should route to Discord format for discord.com URLs', () => {
      const originalUrl = alertingService.webhookUrl;
      alertingService.webhookUrl = 'https://discord.com/api/webhooks/xxx';

      const mockAlert = {
        severity: SEVERITY.CRITICAL,
        title: 'Test',
        message: 'Test',
        timestamp: Date.now(),
        environment: 'test',
        network: 'devnet',
      };

      const payload = alertingService.formatWebhookPayload(mockAlert);
      expect(payload.embeds).toBeDefined();

      alertingService.webhookUrl = originalUrl;
    });

    it('should route to generic format for unknown URLs', () => {
      const originalUrl = alertingService.webhookUrl;
      alertingService.webhookUrl = 'https://custom-webhook.example.com/alert';

      const mockAlert = {
        severity: SEVERITY.INFO,
        title: 'Test',
        message: 'Test',
        timestamp: Date.now(),
        environment: 'test',
        network: 'devnet',
        data: {},
      };

      const payload = alertingService.formatWebhookPayload(mockAlert);
      expect(payload.alert).toBeDefined();

      alertingService.webhookUrl = originalUrl;
    });
  });

  describe('Alert cooldown', () => {
    it('should send alert and add to history', async () => {
      const initialHistory = alertingService.getHistory().length;

      await alertingService.alert('FEE_PAYER_LOW', {
        pubkey: 'testPubkey123',
        balance: '0.05',
      });

      const newHistory = alertingService.getHistory();
      expect(newHistory.length).toBeGreaterThanOrEqual(initialHistory);
    });

    it('should track active alerts', async () => {
      await alertingService.alert('REDIS_DOWN');

      const activeAlerts = alertingService.getActiveAlerts();
      const redisAlert = activeAlerts.find((a) => a.type === 'redis_down');
      expect(redisAlert).toBeDefined();
    });
  });

  describe('Recovery', () => {
    it('should clear active alert on recovery', async () => {
      // First trigger an alert
      await alertingService.alert('CIRCUIT_BREAKER_OPEN', { name: 'test-breaker', failures: 3 });

      // Then recover
      await alertingService.recover('CIRCUIT_BREAKER_OPEN', { name: 'test-breaker' });

      const activeAlerts = alertingService.getActiveAlerts();
      const breakerAlert = activeAlerts.find(
        (a) => a.id === 'circuit_breaker_open:test-breaker'
      );
      expect(breakerAlert).toBeUndefined();
    });

    it('should handle recovery for non-existent alert gracefully', async () => {
      // Should not throw
      await alertingService.recover('FEE_PAYER_LOW', { pubkey: 'nonexistent' });
    });

    it('should handle recovery with unknown alert type', async () => {
      await alertingService.recover('UNKNOWN_TYPE', {});
      // Should not throw
    });
  });

  describe('Webhook sending', () => {
    it('should not send webhook when URL is not configured', async () => {
      await alertingService.sendWebhook({
        id: 'test:1',
        type: 'test',
        severity: SEVERITY.INFO,
        title: 'Test',
        message: 'Test',
        timestamp: Date.now(),
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle successful webhook response', async () => {
      const originalUrl = alertingService.webhookUrl;
      alertingService.webhookUrl = 'https://test.webhook.com/alert';
      global.fetch.mockResolvedValueOnce({ ok: true });

      await alertingService.sendWebhook({
        id: 'test:2',
        type: 'test',
        severity: SEVERITY.WARNING,
        title: 'Test',
        message: 'Test',
        timestamp: Date.now(),
        environment: 'test',
        network: 'devnet',
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      alertingService.webhookUrl = originalUrl;
    });

    it('should handle 4xx non-retryable errors', async () => {
      const originalUrl = alertingService.webhookUrl;
      alertingService.webhookUrl = 'https://test.webhook.com/alert';
      global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

      await alertingService.sendWebhook({
        id: 'test:3',
        type: 'test',
        severity: SEVERITY.INFO,
        title: 'Test',
        message: 'Test',
        timestamp: Date.now(),
        environment: 'test',
        network: 'devnet',
      });

      // Should only call once (no retries for 4xx)
      expect(global.fetch).toHaveBeenCalledTimes(1);
      alertingService.webhookUrl = originalUrl;
    });

    it('should handle 5xx retryable errors', async () => {
      const originalUrl = alertingService.webhookUrl;
      alertingService.webhookUrl = 'https://test.webhook.com/alert';
      // First call fails with 500, second succeeds
      global.fetch
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true });

      await alertingService.sendWebhook({
        id: 'test:4',
        type: 'test',
        severity: SEVERITY.WARNING,
        title: 'Test',
        message: 'Test',
        timestamp: Date.now(),
        environment: 'test',
        network: 'devnet',
      });

      // Should retry after 500
      expect(global.fetch).toHaveBeenCalledTimes(2);
      alertingService.webhookUrl = originalUrl;
    });

    it('should handle fetch exceptions', async () => {
      const originalUrl = alertingService.webhookUrl;
      alertingService.webhookUrl = 'https://test.webhook.com/alert';
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      await alertingService.sendWebhook({
        id: 'test:5',
        type: 'test',
        severity: SEVERITY.CRITICAL,
        title: 'Test',
        message: 'Test',
        timestamp: Date.now(),
        environment: 'test',
        network: 'devnet',
      });

      // Should attempt retry
      expect(global.fetch).toHaveBeenCalled();
      alertingService.webhookUrl = originalUrl;
    });
  });

  describe('Alert deduplication', () => {
    it('should deduplicate repeated alerts within cooldown period', async () => {
      const initialHistoryLength = alertingService.getHistory().length;

      // Send same alert twice quickly
      await alertingService.alert('HIGH_ERROR_RATE', { rate: '10', period: '5 minutes' });
      await alertingService.alert('HIGH_ERROR_RATE', { rate: '10', period: '5 minutes' });

      // Should only add one alert due to cooldown
      const newHistory = alertingService.getHistory();
      expect(newHistory.length).toBe(initialHistoryLength + 1);
    });
  });
});
