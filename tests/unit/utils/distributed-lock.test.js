/**
 * Tests for distributed locking mechanism
 * Validates race condition prevention in redis.js
 */

// Mock redis client for testing
const _mockRedisClient = {
  set: jest.fn(),
  get: jest.fn(),
  eval: jest.fn(),
};

// Mock the redis module
jest.mock('../../../src/utils/redis', () => {
  const originalModule = jest.requireActual('../../../src/utils/redis');

  // We'll test the in-memory fallback which doesn't need actual Redis
  return {
    ...originalModule,
  };
});

const redis = require('../../../src/utils/redis');

describe('Distributed Locking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('acquireLock()', () => {
    it('should acquire a lock successfully', async () => {
      const lockName = 'test-lock-' + Date.now();
      const token = await redis.acquireLock(lockName, 5);

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
    });

    it('should fail to acquire lock if already held', async () => {
      const lockName = 'test-lock-held-' + Date.now();

      // First acquisition should succeed
      const token1 = await redis.acquireLock(lockName, 5);
      expect(token1).toBeTruthy();

      // Second acquisition should fail
      const token2 = await redis.acquireLock(lockName, 5);
      expect(token2).toBeNull();
    });

    it('should allow re-acquisition after lock expires', async () => {
      const lockName = 'test-lock-expire-' + Date.now();

      // Acquire with very short TTL
      const token1 = await redis.acquireLock(lockName, 1);
      expect(token1).toBeTruthy();

      // Wait for lock to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be able to acquire again
      const token2 = await redis.acquireLock(lockName, 5);
      expect(token2).toBeTruthy();
    });
  });

  describe('releaseLock()', () => {
    it('should release a lock with correct token', async () => {
      const lockName = 'test-release-' + Date.now();

      const token = await redis.acquireLock(lockName, 5);
      expect(token).toBeTruthy();

      const released = await redis.releaseLock(lockName, token);
      expect(released).toBe(true);

      // Should be able to acquire again
      const newToken = await redis.acquireLock(lockName, 5);
      expect(newToken).toBeTruthy();
    });

    it('should not release a lock with wrong token', async () => {
      const lockName = 'test-wrong-token-' + Date.now();

      const token = await redis.acquireLock(lockName, 5);
      expect(token).toBeTruthy();

      const released = await redis.releaseLock(lockName, 'wrong-token');
      expect(released).toBe(false);

      // Lock should still be held
      const newToken = await redis.acquireLock(lockName, 5);
      expect(newToken).toBeNull();
    });
  });

  describe('isLockHeld()', () => {
    it('should return true if lock is held', async () => {
      const lockName = 'test-is-held-' + Date.now();

      await redis.acquireLock(lockName, 5);

      const isHeld = await redis.isLockHeld(lockName);
      expect(isHeld).toBe(true);
    });

    it('should return false if lock is not held', async () => {
      const lockName = 'test-not-held-' + Date.now();

      const isHeld = await redis.isLockHeld(lockName);
      expect(isHeld).toBe(false);
    });
  });

  describe('withLock()', () => {
    it('should execute function while holding lock', async () => {
      const lockName = 'test-with-lock-' + Date.now();
      let executed = false;

      const result = await redis.withLock(lockName, async () => {
        executed = true;
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(executed).toBe(true);
    });

    it('should release lock after function completes', async () => {
      const lockName = 'test-release-after-' + Date.now();

      await redis.withLock(lockName, async () => {
        return 'done';
      });

      // Lock should be released
      const isHeld = await redis.isLockHeld(lockName);
      expect(isHeld).toBe(false);
    });

    it('should release lock even if function throws', async () => {
      const lockName = 'test-release-on-error-' + Date.now();

      const result = await redis.withLock(lockName, async () => {
        throw new Error('Test error');
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('EXECUTION_ERROR');

      // Lock should be released
      const isHeld = await redis.isLockHeld(lockName);
      expect(isHeld).toBe(false);
    });

    it('should return LOCK_HELD if lock is already taken', async () => {
      const lockName = 'test-lock-held-withlock-' + Date.now();

      // Acquire lock first
      const token = await redis.acquireLock(lockName, 5);
      expect(token).toBeTruthy();

      // withLock should fail
      const result = await redis.withLock(lockName, async () => {
        return 'should not run';
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('LOCK_HELD');
    });

    it('should prevent concurrent execution', async () => {
      const lockName = 'test-concurrent-' + Date.now();
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const executeWithTracking = async () => {
        return redis.withLock(
          lockName,
          async () => {
            concurrentCount++;
            maxConcurrent = Math.max(maxConcurrent, concurrentCount);

            // Simulate some work
            await new Promise((resolve) => setTimeout(resolve, 50));

            concurrentCount--;
            return 'done';
          },
          10
        );
      };

      // Launch multiple concurrent executions
      const results = await Promise.all([
        executeWithTracking(),
        executeWithTracking(),
        executeWithTracking(),
      ]);

      // Only one should succeed at a time
      expect(maxConcurrent).toBe(1);

      // First one should succeed, others should fail with LOCK_HELD
      const successes = results.filter((r) => r.success);
      const lockHeld = results.filter((r) => r.error === 'LOCK_HELD');

      expect(successes.length).toBe(1);
      expect(lockHeld.length).toBe(2);
    });
  });
});
