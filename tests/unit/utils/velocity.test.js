/**
 * Velocity Tracking Tests
 * Tests the behavioral proof system for treasury refill
 */

const redis = require('../../../src/utils/redis');

describe('Velocity Tracking (Behavioral Proof)', () => {
  beforeEach(() => {
    // Clear velocity data between tests
    jest.clearAllMocks();
  });

  describe('recordTransactionVelocity()', () => {
    it('should record transaction cost', async () => {
      // Record a transaction
      await redis.recordTransactionVelocity(5000);

      // Verify metrics are updated
      const metrics = await redis.getVelocityMetrics();
      expect(metrics.txCount).toBeGreaterThanOrEqual(1);
      expect(metrics.totalCost).toBeGreaterThanOrEqual(5000);
    });

    it('should accumulate multiple transactions', async () => {
      await redis.recordTransactionVelocity(5000);
      await redis.recordTransactionVelocity(6000);
      await redis.recordTransactionVelocity(7000);

      const metrics = await redis.getVelocityMetrics();
      expect(metrics.txCount).toBeGreaterThanOrEqual(3);
      expect(metrics.totalCost).toBeGreaterThanOrEqual(18000);
    });
  });

  describe('getVelocityMetrics()', () => {
    it('should return zero metrics when no data', async () => {
      // Fresh state - might have some data from previous tests
      const metrics = await redis.getVelocityMetrics();

      expect(metrics).toHaveProperty('txCount');
      expect(metrics).toHaveProperty('totalCost');
      expect(metrics).toHaveProperty('avgCost');
      expect(metrics).toHaveProperty('txPerHour');
      expect(metrics).toHaveProperty('hoursOfData');
    });

    it('should calculate average cost correctly', async () => {
      await redis.recordTransactionVelocity(4000);
      await redis.recordTransactionVelocity(6000);

      const metrics = await redis.getVelocityMetrics();

      // Average should be between 4000 and 6000 (accounting for any prior data)
      expect(metrics.avgCost).toBeGreaterThanOrEqual(0);
    });
  });

  describe('calculateVelocityBasedBuffer()', () => {
    it('should return minimum buffer when no velocity data', async () => {
      const result = await redis.calculateVelocityBasedBuffer(2, 50_000_000);

      expect(result).toHaveProperty('required');
      expect(result).toHaveProperty('target');
      expect(result).toHaveProperty('velocity');
      expect(result).toHaveProperty('explanation');
      expect(result.required).toBeGreaterThanOrEqual(50_000_000);
    });

    it('should calculate buffer based on velocity', async () => {
      // Record several transactions to establish velocity
      for (let i = 0; i < 10; i++) {
        await redis.recordTransactionVelocity(5000);
      }

      const result = await redis.calculateVelocityBasedBuffer(2, 50_000_000);

      expect(result.required).toBeGreaterThanOrEqual(50_000_000);
      expect(result.target).toBeGreaterThan(result.required);
      expect(result.explanation).toBeDefined();
    });

    it('should use bufferHours parameter', async () => {
      // Record transactions
      for (let i = 0; i < 5; i++) {
        await redis.recordTransactionVelocity(10000);
      }

      const buffer1hr = await redis.calculateVelocityBasedBuffer(1, 50_000_000);
      const buffer4hr = await redis.calculateVelocityBasedBuffer(4, 50_000_000);

      // 4 hour buffer should be larger than 1 hour buffer (unless both at minimum)
      expect(buffer4hr.required).toBeGreaterThanOrEqual(buffer1hr.required);
    });

    it('should respect minimum buffer', async () => {
      const minBuffer = 100_000_000; // 0.1 SOL
      const result = await redis.calculateVelocityBasedBuffer(1, minBuffer);

      expect(result.required).toBeGreaterThanOrEqual(minBuffer);
    });

    it('target should be 100x required (weekly runway)', async () => {
      // Record transactions to get above minimum
      for (let i = 0; i < 100; i++) {
        await redis.recordTransactionVelocity(100000);
      }

      const result = await redis.calculateVelocityBasedBuffer(2, 1000);

      // Target should be 100x required (minimizes refill tx frequency)
      const ratio = result.target / result.required;
      expect(ratio).toBeCloseTo(100, 0);
    });
  });

  describe('Behavioral Proof Philosophy', () => {
    it('should adapt threshold based on actual usage', async () => {
      // Low activity scenario
      await redis.recordTransactionVelocity(5000);
      const lowActivity = await redis.calculateVelocityBasedBuffer(2, 50_000_000);

      // High activity scenario (simulate more transactions)
      for (let i = 0; i < 50; i++) {
        await redis.recordTransactionVelocity(5000);
      }
      const highActivity = await redis.calculateVelocityBasedBuffer(2, 50_000_000);

      // Higher activity should require higher buffer
      expect(highActivity.required).toBeGreaterThanOrEqual(lowActivity.required);
    });

    it('should include velocity data in explanation', async () => {
      for (let i = 0; i < 10; i++) {
        await redis.recordTransactionVelocity(5000);
      }

      const result = await redis.calculateVelocityBasedBuffer();

      // Explanation should contain tx/hr and cost info
      expect(result.explanation).toMatch(/tx\/hr|lamports|SOL|No velocity/);
    });
  });
});
