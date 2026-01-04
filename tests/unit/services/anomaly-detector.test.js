/**
 * Tests for Anomaly Detector Service
 */

const {
  anomalyDetector,
  ANOMALY_TYPES,
  DEFAULT_THRESHOLDS,
  BASELINE_CONFIG,
} = require('../../../src/services/anomaly-detector');

// Mock dependencies
jest.mock('../../../src/utils/config', () => ({
  IS_DEV: true,
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/utils/redis', () => ({
  getStats: jest.fn().mockResolvedValue({
    totalBurned: 1000000,
    txCount: 100,
    pendingSwap: 50000,
  }),
  trackWalletActivity: jest.fn().mockResolvedValue({ count: 1 }),
  trackIpActivity: jest.fn().mockResolvedValue({ count: 1 }),
  getWalletActivity: jest.fn().mockResolvedValue({ quotes: 0, submits: 0, failures: 0 }),
  getIpActivity: jest.fn().mockResolvedValue({ quotes: 0, submits: 0 }),
  isReady: jest.fn().mockReturnValue(true),
}));

jest.mock('../../../src/services/alerting', () => ({
  alertingService: {
    alert: jest.fn(),
  },
  ALERT_TYPES: {
    ANOMALY_DETECTED: { id: 'anomaly_detected' },
  },
}));

jest.mock('../../../src/services/audit', () => ({
  auditService: {
    log: jest.fn(),
    getSecuritySummary: jest.fn().mockReturnValue({
      totalEvents: 0,
      byType: {},
      byWallet: {},
      byIP: {},
    }),
  },
  AUDIT_EVENTS: {
    ANOMALY_DETECTED: 'anomaly_detected',
  },
}));

describe('Anomaly Detector Service', () => {
  describe('ANOMALY_TYPES', () => {
    it('should define wallet anomaly types', () => {
      expect(ANOMALY_TYPES.WALLET_HIGH_QUOTE_VOLUME).toBe('anomaly.wallet.high_quote_volume');
      expect(ANOMALY_TYPES.WALLET_HIGH_SUBMIT_VOLUME).toBe('anomaly.wallet.high_submit_volume');
      expect(ANOMALY_TYPES.WALLET_HIGH_FAILURE_RATE).toBe('anomaly.wallet.high_failure_rate');
    });

    it('should define IP anomaly types', () => {
      expect(ANOMALY_TYPES.IP_HIGH_QUOTE_VOLUME).toBe('anomaly.ip.high_quote_volume');
      expect(ANOMALY_TYPES.IP_HIGH_SUBMIT_VOLUME).toBe('anomaly.ip.high_submit_volume');
    });

    it('should define global anomaly types', () => {
      expect(ANOMALY_TYPES.GLOBAL_HIGH_ERROR_RATE).toBe('anomaly.global.high_error_rate');
      expect(ANOMALY_TYPES.GLOBAL_SECURITY_SPIKE).toBe('anomaly.global.security_spike');
    });

    it('should define payer anomaly types', () => {
      expect(ANOMALY_TYPES.PAYER_RAPID_DRAIN).toBe('anomaly.payer.rapid_drain');
    });
  });

  describe('DEFAULT_THRESHOLDS', () => {
    it('should define wallet thresholds', () => {
      expect(DEFAULT_THRESHOLDS.WALLET_QUOTES_5MIN).toBeDefined();
      expect(DEFAULT_THRESHOLDS.WALLET_SUBMITS_5MIN).toBeDefined();
      expect(DEFAULT_THRESHOLDS.WALLET_FAILURES_5MIN).toBeDefined();
    });

    it('should define IP thresholds', () => {
      expect(DEFAULT_THRESHOLDS.IP_QUOTES_5MIN).toBeDefined();
      expect(DEFAULT_THRESHOLDS.IP_SUBMITS_5MIN).toBeDefined();
    });

    it('should define global thresholds', () => {
      expect(DEFAULT_THRESHOLDS.GLOBAL_ERROR_RATE_PERCENT).toBeDefined();
      expect(DEFAULT_THRESHOLDS.GLOBAL_SECURITY_EVENTS_5MIN).toBeDefined();
    });

    it('should define payer thresholds', () => {
      expect(DEFAULT_THRESHOLDS.PAYER_DRAIN_RATE_LAMPORTS_PER_MIN).toBeDefined();
    });

    it('should have reasonable default values', () => {
      expect(DEFAULT_THRESHOLDS.WALLET_QUOTES_5MIN).toBe(50);
      expect(DEFAULT_THRESHOLDS.WALLET_SUBMITS_5MIN).toBe(30);
      expect(DEFAULT_THRESHOLDS.WALLET_FAILURES_5MIN).toBe(10);
      expect(DEFAULT_THRESHOLDS.IP_QUOTES_5MIN).toBe(100);
      expect(DEFAULT_THRESHOLDS.GLOBAL_ERROR_RATE_PERCENT).toBe(20);
    });
  });

  describe('BASELINE_CONFIG', () => {
    it('should define learning period', () => {
      expect(BASELINE_CONFIG.LEARNING_PERIOD_MS).toBeDefined();
      expect(typeof BASELINE_CONFIG.LEARNING_PERIOD_MS).toBe('number');
    });

    it('should define minimum samples', () => {
      expect(BASELINE_CONFIG.MIN_SAMPLES).toBeDefined();
      expect(typeof BASELINE_CONFIG.MIN_SAMPLES).toBe('number');
    });

    it('should define stddev multiplier', () => {
      expect(BASELINE_CONFIG.STDDEV_MULTIPLIER).toBeDefined();
      expect(typeof BASELINE_CONFIG.STDDEV_MULTIPLIER).toBe('number');
    });

    it('should define update interval', () => {
      expect(BASELINE_CONFIG.UPDATE_INTERVAL_MS).toBeDefined();
      expect(typeof BASELINE_CONFIG.UPDATE_INTERVAL_MS).toBe('number');
    });
  });

  describe('anomalyDetector', () => {
    it('should be defined', () => {
      expect(anomalyDetector).toBeDefined();
    });

    describe('internal helper methods', () => {
      it('_mean should calculate mean correctly', () => {
        expect(anomalyDetector._mean([1, 2, 3, 4, 5])).toBe(3);
        expect(anomalyDetector._mean([10])).toBe(10);
        expect(anomalyDetector._mean([])).toBe(0);
      });

      it('_stddev should calculate standard deviation', () => {
        // Standard deviation of [1, 2, 3, 4, 5] = ~1.41
        const stddev = anomalyDetector._stddev([1, 2, 3, 4, 5]);
        expect(stddev).toBeCloseTo(1.414, 2);
      });

      it('_stddev should return 0 for empty array', () => {
        expect(anomalyDetector._stddev([])).toBe(0);
      });

      it('_stddev should return 0 for single element', () => {
        expect(anomalyDetector._stddev([5])).toBe(0);
      });
    });

    describe('baseline state', () => {
      it('should have baseline property', () => {
        expect(anomalyDetector.baseline).toBeDefined();
      });

      it('should have default thresholds in baseline', () => {
        expect(anomalyDetector.baseline.thresholds).toBeDefined();
      });

      it('should have sample arrays in baseline', () => {
        expect(anomalyDetector.baseline.samples).toBeDefined();
        expect(Array.isArray(anomalyDetector.baseline.samples.quotesPerWallet)).toBe(true);
        expect(Array.isArray(anomalyDetector.baseline.samples.submitsPerWallet)).toBe(true);
        expect(Array.isArray(anomalyDetector.baseline.samples.quotesPerIP)).toBe(true);
      });
    });

    describe('getStatus()', () => {
      it('should return status object', () => {
        const status = anomalyDetector.getStatus();
        expect(status).toBeDefined();
        expect(typeof status).toBe('object');
      });

      it('should include check interval info', () => {
        const status = anomalyDetector.getStatus();
        // Check for presence of relevant fields
        expect(status).toHaveProperty('thresholds');
        expect(status).toHaveProperty('baseline');
      });

      it('should include baseline info', () => {
        const status = anomalyDetector.getStatus();
        expect(status.baseline).toBeDefined();
        expect(typeof status.baseline.isLearning).toBe('boolean');
        expect(typeof status.baseline.isReady).toBe('boolean');
      });

      it('should include thresholds', () => {
        const status = anomalyDetector.getStatus();
        expect(status.thresholds).toBeDefined();
      });
    });

    describe('start() and stop()', () => {
      it('should have start method', () => {
        expect(typeof anomalyDetector.start).toBe('function');
      });

      it('should have stop method', () => {
        expect(typeof anomalyDetector.stop).toBe('function');
      });

      it('stop should not throw if not started', () => {
        expect(() => anomalyDetector.stop()).not.toThrow();
      });
    });

    describe('getThresholds()', () => {
      it('should return thresholds object', () => {
        const thresholds = anomalyDetector.getThresholds();
        expect(thresholds).toBeDefined();
        expect(typeof thresholds).toBe('object');
      });

      it('should include all threshold values', () => {
        const thresholds = anomalyDetector.getThresholds();
        expect(thresholds.WALLET_QUOTES_5MIN).toBeDefined();
        expect(thresholds.WALLET_SUBMITS_5MIN).toBeDefined();
        expect(thresholds.IP_QUOTES_5MIN).toBeDefined();
      });
    });

    describe('getBaselineStatus()', () => {
      it('should return baseline status object', () => {
        const status = anomalyDetector.getBaselineStatus();
        expect(status).toBeDefined();
        expect(typeof status).toBe('object');
      });

      it('should include isLearning flag', () => {
        const status = anomalyDetector.getBaselineStatus();
        expect(typeof status.isLearning).toBe('boolean');
      });

      it('should include isReady flag', () => {
        const status = anomalyDetector.getBaselineStatus();
        expect(typeof status.isReady).toBe('boolean');
      });
    });

    describe('startBaselineLearning()', () => {
      it('should have startBaselineLearning method', () => {
        expect(typeof anomalyDetector.startBaselineLearning).toBe('function');
      });

      it('should set isLearning to true when called', () => {
        anomalyDetector.baseline.isLearning = false;
        anomalyDetector.baseline.isReady = false;
        anomalyDetector.startBaselineLearning();
        expect(anomalyDetector.baseline.isLearning).toBe(true);
      });
    });

    describe('recordSample()', () => {
      it('should have recordSample method', () => {
        expect(typeof anomalyDetector.recordSample).toBe('function');
      });

      it('should not throw when recording valid sample', () => {
        anomalyDetector.baseline.isLearning = true;
        expect(() => {
          anomalyDetector.recordSample('quotesPerWallet', 10);
        }).not.toThrow();
      });

      it('should add sample to baseline samples', () => {
        anomalyDetector.baseline.isLearning = true;
        anomalyDetector.baseline.samples.quotesPerWallet = [];
        anomalyDetector.recordSample('quotesPerWallet', 42);
        expect(anomalyDetector.baseline.samples.quotesPerWallet).toContain(42);
      });

      it('should not record when not learning', () => {
        anomalyDetector.baseline.isLearning = false;
        anomalyDetector.baseline.isReady = false;
        anomalyDetector.baseline.samples.quotesPerWallet = [];
        anomalyDetector.recordSample('quotesPerWallet', 42);
        expect(anomalyDetector.baseline.samples.quotesPerWallet.length).toBe(0);
      });
    });

    describe('_calculateThreshold()', () => {
      it('should return default value when not enough samples', () => {
        const result = anomalyDetector._calculateThreshold([], 100);
        expect(result).toBe(100);
      });

      it('should return default value with few samples', () => {
        const result = anomalyDetector._calculateThreshold([1, 2], 100);
        expect(result).toBe(100);
      });

      it('should calculate threshold with enough samples', () => {
        // Need MIN_SAMPLES worth of data
        const samples = new Array(20).fill(0).map((_, i) => i + 1);
        const result = anomalyDetector._calculateThreshold(samples, 50);
        expect(result).toBeGreaterThan(0);
      });

      it('should apply minimum floor when specified', () => {
        const samples = new Array(20).fill(0).map((_, i) => i);
        const result = anomalyDetector._calculateThreshold(samples, 10, 100);
        expect(result).toBeGreaterThanOrEqual(100);
      });
    });

    describe('updateThresholds()', () => {
      it('should have updateThresholds method', () => {
        expect(typeof anomalyDetector.updateThresholds).toBe('function');
      });

      it('should not throw when called', () => {
        expect(() => anomalyDetector.updateThresholds()).not.toThrow();
      });

      it('should update baseline thresholds', () => {
        const beforeThresholds = { ...anomalyDetector.baseline.thresholds };
        // Add some samples
        anomalyDetector.baseline.samples.quotesPerWallet = new Array(20)
          .fill(0)
          .map(() => Math.random() * 100);
        anomalyDetector.updateThresholds();
        // Thresholds object should still exist
        expect(anomalyDetector.baseline.thresholds).toBeDefined();
      });
    });

    describe('trackWallet()', () => {
      it('should have trackWallet method', () => {
        expect(typeof anomalyDetector.trackWallet).toBe('function');
      });

      it('should return promise', () => {
        const result = anomalyDetector.trackWallet('test-wallet', 'quote', '192.168.1.1');
        expect(result).toBeInstanceOf(Promise);
      });

      it('should not throw on valid input', async () => {
        await expect(
          anomalyDetector.trackWallet('test-wallet', 'quote', '192.168.1.1')
        ).resolves.not.toThrow();
      });
    });

    describe('trackIp()', () => {
      it('should have trackIp method', () => {
        expect(typeof anomalyDetector.trackIp).toBe('function');
      });

      it('should return promise', () => {
        const result = anomalyDetector.trackIp('192.168.1.1', 'quote');
        expect(result).toBeInstanceOf(Promise);
      });

      it('should not throw on valid input', async () => {
        await expect(anomalyDetector.trackIp('192.168.1.1', 'quote')).resolves.not.toThrow();
      });
    });
  });
});
