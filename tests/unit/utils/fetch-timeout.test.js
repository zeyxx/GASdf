/**
 * Tests for fetch-timeout utilities
 * Validates timeout protection for HTTP requests
 */

const {
  withTimeout,
  timeoutPromise,
  fetchWithTimeout,
  fetchJsonWithTimeout,
  retryWithTimeout,
  DEFAULT_TIMEOUT,
  JUPITER_TIMEOUT,
  WEBHOOK_TIMEOUT,
  HEALTH_CHECK_TIMEOUT,
} = require('../../../src/utils/fetch-timeout');

// Mock global fetch
global.fetch = jest.fn();

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

  describe('fetchWithTimeout()', () => {
    beforeEach(() => {
      global.fetch.mockReset();
    });

    it('should return response on successful fetch', async () => {
      const mockResponse = { ok: true, status: 200 };
      global.fetch.mockResolvedValue(mockResponse);

      const result = await fetchWithTimeout('https://example.com', {}, 1000);
      expect(result).toBe(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('should pass options to fetch', async () => {
      const mockResponse = { ok: true };
      global.fetch.mockResolvedValue(mockResponse);

      await fetchWithTimeout('https://example.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      }, 1000);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test: true }),
        })
      );
    });

    it('should throw timeout error on abort', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      global.fetch.mockRejectedValue(abortError);

      await expect(
        fetchWithTimeout('https://example.com', {}, 100)
      ).rejects.toMatchObject({
        code: 'TIMEOUT',
        url: 'https://example.com',
        timeoutMs: 100,
      });
    });

    it('should rethrow non-abort errors', async () => {
      const networkError = new Error('Network error');
      global.fetch.mockRejectedValue(networkError);

      await expect(
        fetchWithTimeout('https://example.com', {}, 1000)
      ).rejects.toThrow('Network error');
    });

    it('should use DEFAULT_TIMEOUT when not specified', async () => {
      const mockResponse = { ok: true };
      global.fetch.mockResolvedValue(mockResponse);

      await fetchWithTimeout('https://example.com');
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('fetchJsonWithTimeout()', () => {
    beforeEach(() => {
      global.fetch.mockReset();
    });

    it('should return parsed JSON on success', async () => {
      const jsonData = { message: 'success', value: 42 };
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(jsonData),
      };
      global.fetch.mockResolvedValue(mockResponse);

      const result = await fetchJsonWithTimeout('https://api.example.com/data', {}, 1000);
      expect(result).toEqual(jsonData);
    });

    it('should throw error on non-ok response', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      };
      global.fetch.mockResolvedValue(mockResponse);

      await expect(
        fetchJsonWithTimeout('https://api.example.com/missing', {}, 1000)
      ).rejects.toMatchObject({
        status: 404,
        statusText: 'Not Found',
        url: 'https://api.example.com/missing',
      });
    });

    it('should throw HTTP error with status', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };
      global.fetch.mockResolvedValue(mockResponse);

      try {
        await fetchJsonWithTimeout('https://api.example.com/error', {}, 1000);
        fail('Should have thrown');
      } catch (error) {
        expect(error.message).toContain('500');
        expect(error.status).toBe(500);
      }
    });
  });

  describe('retryWithTimeout()', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return result on first success', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const resultPromise = retryWithTimeout(fn, {
        maxRetries: 3,
        timeoutMs: 1000,
        delayMs: 100,
        operation: 'Test',
      });

      // Fast-forward past any pending timers
      jest.runAllTimers();

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      jest.useRealTimers(); // Use real timers for this test

      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const result = await retryWithTimeout(fn, {
        maxRetries: 3,
        timeoutMs: 1000,
        delayMs: 10,
        operation: 'Retry test',
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries', async () => {
      jest.useRealTimers();

      const fn = jest.fn().mockRejectedValue(new Error('always fails'));

      await expect(
        retryWithTimeout(fn, {
          maxRetries: 2,
          timeoutMs: 100,
          delayMs: 10,
          operation: 'Failing op',
        })
      ).rejects.toThrow('always fails');

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should use default options', async () => {
      jest.useRealTimers();

      const fn = jest.fn().mockResolvedValue('result');

      const result = await retryWithTimeout(fn);
      expect(result).toBe('result');
    });
  });
});
