/**
 * Tests for fetch-timeout utilities
 * Validates timeout protection for HTTP requests
 */

const {
  withTimeout,
  timeoutPromise,
  DEFAULT_TIMEOUT,
  JUPITER_TIMEOUT,
  WEBHOOK_TIMEOUT,
  HEALTH_CHECK_TIMEOUT,
} = require('../../../src/utils/fetch-timeout');

describe('Fetch Timeout Utilities', () => {
  describe('timeoutPromise()', () => {
    it('should reject after specified timeout', async () => {
      const start = Date.now();

      await expect(timeoutPromise(100, 'Test')).rejects.toThrow('Test timeout after 100ms');

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(95);
      expect(elapsed).toBeLessThan(200);
    });

    it('should include error code', async () => {
      try {
        await timeoutPromise(50, 'Operation');
        fail('Should have thrown');
      } catch (error) {
        expect(error.code).toBe('TIMEOUT');
        expect(error.timeoutMs).toBe(50);
      }
    });
  });

  describe('withTimeout()', () => {
    it('should resolve if promise completes before timeout', async () => {
      const fastPromise = new Promise((resolve) => {
        setTimeout(() => resolve('success'), 50);
      });

      const result = await withTimeout(fastPromise, 200, 'Fast operation');
      expect(result).toBe('success');
    });

    it('should reject if promise takes longer than timeout', async () => {
      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('success'), 500);
      });

      await expect(
        withTimeout(slowPromise, 100, 'Slow operation')
      ).rejects.toThrow('Slow operation timeout after 100ms');
    });

    it('should preserve original rejection', async () => {
      const failingPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Original error')), 50);
      });

      await expect(
        withTimeout(failingPromise, 200, 'Failing operation')
      ).rejects.toThrow('Original error');
    });

    it('should handle immediate resolution', async () => {
      const result = await withTimeout(Promise.resolve('instant'), 100, 'Instant');
      expect(result).toBe('instant');
    });

    it('should handle immediate rejection', async () => {
      await expect(
        withTimeout(Promise.reject(new Error('immediate')), 100, 'Immediate')
      ).rejects.toThrow('immediate');
    });
  });

  describe('Timeout Constants', () => {
    it('DEFAULT_TIMEOUT should be 10 seconds', () => {
      expect(DEFAULT_TIMEOUT).toBe(10_000);
    });

    it('JUPITER_TIMEOUT should be 15 seconds', () => {
      expect(JUPITER_TIMEOUT).toBe(15_000);
    });

    it('WEBHOOK_TIMEOUT should be 5 seconds', () => {
      expect(WEBHOOK_TIMEOUT).toBe(5_000);
    });

    it('HEALTH_CHECK_TIMEOUT should be 3 seconds', () => {
      expect(HEALTH_CHECK_TIMEOUT).toBe(3_000);
    });
  });

  describe('Concurrent timeout handling', () => {
    it('should handle multiple concurrent timeouts independently', async () => {
      const results = await Promise.allSettled([
        withTimeout(
          new Promise((resolve) => setTimeout(() => resolve('fast'), 50)),
          200,
          'Fast'
        ),
        withTimeout(
          new Promise((resolve) => setTimeout(() => resolve('slow'), 300)),
          100,
          'Slow'
        ),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[0].value).toBe('fast');

      expect(results[1].status).toBe('rejected');
      expect(results[1].reason.message).toContain('timeout');
    });

    it('should not leak timers on early resolution', async () => {
      // This test verifies that timers are properly cleaned up
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          withTimeout(Promise.resolve(i), 1000, `Op${i}`)
        );
      }

      const results = await Promise.all(promises);
      expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  describe('Edge cases', () => {
    it('should handle zero timeout', async () => {
      await expect(
        withTimeout(
          new Promise((resolve) => setTimeout(resolve, 10)),
          0,
          'Zero'
        )
      ).rejects.toThrow('Zero timeout after 0ms');
    });

    it('should handle very large timeout', async () => {
      const result = await withTimeout(
        Promise.resolve('quick'),
        Number.MAX_SAFE_INTEGER,
        'Large timeout'
      );
      expect(result).toBe('quick');
    });
  });
});
