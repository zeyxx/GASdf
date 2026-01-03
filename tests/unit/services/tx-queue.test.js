/**
 * Unit Tests for Transaction Queue Service
 */

jest.mock('../../../src/utils/config', () => ({}));

jest.mock('../../../src/utils/redis', () => ({
  setQuote: jest.fn().mockResolvedValue(true),
  getQuote: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const redis = require('../../../src/utils/redis');
const logger = require('../../../src/utils/logger');
const txQueue = require('../../../src/services/tx-queue');

describe('Transaction Queue Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Constants
  // ==========================================================================

  describe('Constants', () => {
    it('should export MAX_RETRIES', () => {
      expect(txQueue.MAX_RETRIES).toBe(3);
    });

    it('should export RETRY_DELAYS array', () => {
      expect(txQueue.RETRY_DELAYS).toEqual([1000, 5000, 15000]);
    });

    it('should export RETRYABLE_ERRORS patterns', () => {
      expect(txQueue.RETRYABLE_ERRORS).toContain('BlockhashNotFound');
      expect(txQueue.RETRYABLE_ERRORS).toContain('ETIMEDOUT');
      expect(txQueue.RETRYABLE_ERRORS).toContain('rate limit');
    });

    it('should export BACKOFF_CONFIG', () => {
      expect(txQueue.BACKOFF_CONFIG).toHaveProperty('baseDelayMs');
      expect(txQueue.BACKOFF_CONFIG).toHaveProperty('maxDelayMs');
      expect(txQueue.BACKOFF_CONFIG).toHaveProperty('jitterMs');
    });
  });

  // ==========================================================================
  // getRetryDelay
  // ==========================================================================

  describe('getRetryDelay', () => {
    it('should return delay within expected range for attempt 1', () => {
      const delay = txQueue.getRetryDelay(1);
      // 500 * 2^0 = 500, plus jitter (0-500)
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThan(1000);
    });

    it('should return delay within expected range for attempt 2', () => {
      const delay = txQueue.getRetryDelay(2);
      // 500 * 2^1 = 1000, plus jitter (0-500)
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThan(1500);
    });

    it('should return delay within expected range for attempt 3', () => {
      const delay = txQueue.getRetryDelay(3);
      // 500 * 2^2 = 2000, plus jitter (0-500)
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThan(2500);
    });

    it('should cap delay at maxDelayMs for high attempts', () => {
      const delay = txQueue.getRetryDelay(10);
      // Should be capped at 15000 + jitter (0-500)
      expect(delay).toBeLessThanOrEqual(15500);
    });

    it('should include jitter for randomness', () => {
      // Run multiple times to check for jitter
      const delays = Array.from({ length: 10 }, () => txQueue.getRetryDelay(1));
      const uniqueDelays = new Set(delays);
      // With jitter, we should see some variation
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });
  });

  // ==========================================================================
  // isRetryableError
  // ==========================================================================

  describe('isRetryableError', () => {
    it('should return true for BlockhashNotFound', () => {
      const error = new Error('BlockhashNotFound: blockhash expired');
      expect(txQueue.isRetryableError(error)).toBe(true);
    });

    it('should return true for TransactionExpired', () => {
      const error = new Error('TransactionExpired');
      expect(txQueue.isRetryableError(error)).toBe(true);
    });

    it('should return true for ETIMEDOUT', () => {
      const error = new Error('connect ETIMEDOUT 10.0.0.1:443');
      expect(txQueue.isRetryableError(error)).toBe(true);
    });

    it('should return true for rate limit errors', () => {
      const error = new Error('Rate limit exceeded');
      expect(txQueue.isRetryableError(error)).toBe(true);
    });

    it('should return true for Too Many Requests', () => {
      const error = new Error('429 Too Many Requests');
      expect(txQueue.isRetryableError(error)).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      const error = new Error('Insufficient funds');
      expect(txQueue.isRetryableError(error)).toBe(false);
    });

    it('should return false for signature verification failure', () => {
      const error = new Error('Signature verification failed');
      expect(txQueue.isRetryableError(error)).toBe(false);
    });

    it('should handle error as string', () => {
      expect(txQueue.isRetryableError('BlockhashNotFound')).toBe(true);
      expect(txQueue.isRetryableError('Invalid signature')).toBe(false);
    });

    it('should be case-insensitive', () => {
      const error = new Error('blockhashnotfound');
      expect(txQueue.isRetryableError(error)).toBe(true);
    });
  });

  // ==========================================================================
  // enqueue
  // ==========================================================================

  describe('enqueue', () => {
    it('should enqueue a transaction', async () => {
      const txData = {
        quoteId: 'quote-123',
        transaction: 'base64EncodedTx',
        userPubkey: 'UserPubkey11111111111111111111111111111111',
        feePayer: 'FeePayer111111111111111111111111111111111',
        feeAmount: 50000,
        paymentToken: 'USDC',
      };

      const entry = await txQueue.enqueue(txData);

      expect(entry.id).toBe('quote-123');
      expect(entry.status).toBe('pending');
      expect(entry.attempts).toBe(0);
      expect(entry.maxRetries).toBe(3);
      expect(entry.errors).toEqual([]);
      expect(redis.setQuote).toHaveBeenCalledWith('tx:quote-123', expect.any(Object), 3600);
      expect(logger.info).toHaveBeenCalledWith(
        'TX_QUEUE',
        'Transaction enqueued',
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // getEntry
  // ==========================================================================

  describe('getEntry', () => {
    it('should return entry from redis', async () => {
      const mockEntry = { id: 'tx-123', status: 'pending' };
      redis.getQuote.mockResolvedValue(mockEntry);

      const entry = await txQueue.getEntry('tx-123');

      expect(entry).toEqual(mockEntry);
      expect(redis.getQuote).toHaveBeenCalledWith('tx:tx-123');
    });

    it('should return null for non-existent entry', async () => {
      redis.getQuote.mockResolvedValue(null);

      const entry = await txQueue.getEntry('non-existent');

      expect(entry).toBeNull();
    });
  });

  // ==========================================================================
  // updateEntry
  // ==========================================================================

  describe('updateEntry', () => {
    it('should update entry with new values', async () => {
      const existingEntry = { id: 'tx-123', status: 'pending', attempts: 0 };
      redis.getQuote.mockResolvedValue(existingEntry);

      const updated = await txQueue.updateEntry('tx-123', { status: 'processing' });

      expect(updated.status).toBe('processing');
      expect(updated.attempts).toBe(0);
      expect(redis.setQuote).toHaveBeenCalledWith(
        'tx:tx-123',
        expect.objectContaining({ status: 'processing' }),
        3600
      );
    });

    it('should return null for non-existent entry', async () => {
      redis.getQuote.mockResolvedValue(null);

      const updated = await txQueue.updateEntry('non-existent', { status: 'processing' });

      expect(updated).toBeNull();
    });
  });

  // ==========================================================================
  // markProcessing
  // ==========================================================================

  describe('markProcessing', () => {
    it('should mark entry as processing', async () => {
      const existingEntry = { id: 'tx-123', status: 'pending' };
      redis.getQuote.mockResolvedValue(existingEntry);

      const updated = await txQueue.markProcessing('tx-123');

      expect(updated.status).toBe('processing');
      expect(updated.lastAttempt).toBeDefined();
    });
  });

  // ==========================================================================
  // markSuccess
  // ==========================================================================

  describe('markSuccess', () => {
    it('should mark entry as success with signature', async () => {
      const existingEntry = { id: 'tx-123', status: 'processing', attempts: 1 };
      redis.getQuote.mockResolvedValue(existingEntry);

      const signature = '5VERq...signature';
      const updated = await txQueue.markSuccess('tx-123', signature);

      expect(updated.status).toBe('success');
      expect(updated.signature).toBe(signature);
      expect(updated.completedAt).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(
        'TX_QUEUE',
        'Transaction succeeded',
        expect.objectContaining({ id: 'tx-123', signature })
      );
    });
  });

  // ==========================================================================
  // markRetryOrFailed
  // ==========================================================================

  describe('markRetryOrFailed', () => {
    it('should schedule retry for retryable error within max retries', async () => {
      const existingEntry = {
        id: 'tx-123',
        status: 'processing',
        attempts: 0,
        errors: [],
      };
      redis.getQuote.mockResolvedValue(existingEntry);

      const error = new Error('BlockhashNotFound');
      const updated = await txQueue.markRetryOrFailed('tx-123', error);

      expect(updated.status).toBe('pending_retry');
      expect(updated.attempts).toBe(1);
      expect(updated.nextRetry).toBeDefined();
      expect(updated.errors).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'TX_QUEUE',
        'Transaction scheduled for retry',
        expect.any(Object)
      );
    });

    it('should mark as failed when max retries reached', async () => {
      const existingEntry = {
        id: 'tx-123',
        status: 'processing',
        attempts: 2, // Will become 3, which equals MAX_RETRIES
        errors: [],
      };
      redis.getQuote.mockResolvedValue(existingEntry);

      const error = new Error('BlockhashNotFound');
      const updated = await txQueue.markRetryOrFailed('tx-123', error);

      expect(updated.status).toBe('failed');
      expect(updated.attempts).toBe(3);
      expect(updated.failedAt).toBeDefined();
      expect(logger.error).toHaveBeenCalledWith(
        'TX_QUEUE',
        'Transaction failed permanently',
        expect.any(Object)
      );
    });

    it('should mark as failed for non-retryable error', async () => {
      const existingEntry = {
        id: 'tx-123',
        status: 'processing',
        attempts: 0,
        errors: [],
      };
      redis.getQuote.mockResolvedValue(existingEntry);

      const error = new Error('Signature verification failed');
      const updated = await txQueue.markRetryOrFailed('tx-123', error);

      expect(updated.status).toBe('failed');
      expect(updated.attempts).toBe(1);
    });

    it('should return null for non-existent entry', async () => {
      redis.getQuote.mockResolvedValue(null);

      const updated = await txQueue.markRetryOrFailed('non-existent', new Error('test'));

      expect(updated).toBeNull();
    });

    it('should accumulate errors in the errors array', async () => {
      const existingEntry = {
        id: 'tx-123',
        status: 'processing',
        attempts: 0,
        errors: [{ message: 'Previous error', at: Date.now() - 1000 }],
      };
      redis.getQuote.mockResolvedValue(existingEntry);

      const error = new Error('BlockhashNotFound');
      const updated = await txQueue.markRetryOrFailed('tx-123', error);

      expect(updated.errors).toHaveLength(2);
    });
  });

  // ==========================================================================
  // getRetryableTxs
  // ==========================================================================

  describe('getRetryableTxs', () => {
    it('should return empty array (placeholder implementation)', async () => {
      const result = await txQueue.getRetryableTxs();
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // getStats
  // ==========================================================================

  describe('getStats', () => {
    it('should return stats object with zero counts', async () => {
      const stats = await txQueue.getStats();

      expect(stats).toEqual({
        pending: 0,
        processing: 0,
        pendingRetry: 0,
        failed: 0,
        success: 0,
      });
    });
  });

  // ==========================================================================
  // cleanup
  // ==========================================================================

  describe('cleanup', () => {
    it('should complete without error', async () => {
      await expect(txQueue.cleanup()).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalledWith('TX_QUEUE', 'Cleanup completed');
    });

    it('should accept optional maxAgeMs parameter', async () => {
      await expect(txQueue.cleanup(3600000)).resolves.toBeUndefined();
    });
  });
});
