/**
 * Tests for Submit Route
 */

const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring the route
jest.mock('../../../src/utils/config', () => ({
  IS_DEV: true,
  BURN_RATIO: 0.5,
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/utils/redis', () => ({
  getQuote: jest.fn(),
  deleteQuote: jest.fn().mockResolvedValue(true),
  hasTransactionHash: jest.fn().mockResolvedValue(false),
  markTransactionHash: jest.fn().mockResolvedValue(true),
  addPendingSwap: jest.fn().mockResolvedValue(true),
  incrTxCount: jest.fn().mockResolvedValue(true),
  incrWalletBurn: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/utils/rpc', () => ({
  isBlockhashValid: jest.fn().mockResolvedValue(true),
  simulateTransaction: jest.fn().mockResolvedValue({ success: true, unitsConsumed: 200000 }),
  sendTransaction: jest.fn().mockResolvedValue('test-signature-abc123'),
  confirmTransaction: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/services/signer', () => ({
  signTransaction: jest.fn((tx) => tx),
  markPayerUnhealthy: jest.fn(),
}));

jest.mock('../../../src/services/fee-payer-pool', () => ({
  releaseReservation: jest.fn(),
  getReservation: jest.fn().mockReturnValue(null),
}));

jest.mock('../../../src/services/validator', () => ({
  deserializeTransaction: jest.fn().mockReturnValue({ message: {} }),
  validateTransaction: jest.fn().mockReturnValue({
    valid: true,
    feePayer: 'FeePayerPubkey111111111111111111111111111111',
  }),
  validateTransactionSize: jest.fn().mockReturnValue({ valid: true, size: 500 }),
  getTransactionBlockhash: jest.fn().mockReturnValue('blockhash123'),
  computeTransactionHash: jest.fn().mockReturnValue('txhash456'),
}));

jest.mock('../../../src/middleware/security', () => ({
  submitLimiter: (req, res, next) => next(),
  walletSubmitLimiter: (req, res, next) => next(),
}));

jest.mock('../../../src/middleware/validation', () => ({
  validate: () => (req, res, next) => next(),
}));

jest.mock('../../../src/services/tx-queue', () => ({
  enqueue: jest.fn().mockResolvedValue({ id: 'tx-entry-1' }),
  markProcessing: jest.fn().mockResolvedValue(true),
  markSuccess: jest.fn().mockResolvedValue(true),
  markRetryOrFailed: jest.fn().mockResolvedValue(true),
  getEntry: jest.fn(),
  MAX_RETRIES: 3,
  RETRY_DELAYS: [1000, 2000, 4000],
  isRetryableError: jest.fn().mockReturnValue(false),
}));

jest.mock('../../../src/utils/metrics', () => ({
  submitsTotal: { inc: jest.fn() },
  submitDuration: { observe: jest.fn() },
  activeQuotes: { inc: jest.fn(), dec: jest.fn() },
}));

jest.mock('../../../src/services/audit', () => ({
  logSubmitSuccess: jest.fn(),
  logSubmitRejected: jest.fn(),
  logSecurityEvent: jest.fn(),
  AUDIT_EVENTS: {
    REPLAY_ATTACK_DETECTED: 'security.replay_attack',
    BLOCKHASH_EXPIRED: 'security.blockhash_expired',
    SIMULATION_FAILED: 'security.simulation_failed',
    VALIDATION_FAILED: 'security.validation_failed',
    FEE_PAYER_MISMATCH: 'security.fee_payer_mismatch',
  },
}));

jest.mock('../../../src/services/anomaly-detector', () => ({
  anomalyDetector: {
    trackWallet: jest.fn().mockResolvedValue(undefined),
    trackIp: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('Submit Route', () => {
  let app;
  let submitRouter;
  let redis;
  let rpc;
  let validator;
  let feePayerPool;
  let txQueue;
  let metrics;
  let audit;
  let anomalyDetector;

  const validQuote = {
    paymentToken: 'So11111111111111111111111111111111111111112',
    userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    feePayer: 'FeePayerPubkey111111111111111111111111111111',
    feeAmountLamports: 5000,
    feeAmountToken: 100000,
    expiresAt: Date.now() + 60000,
  };

  const validRequest = {
    quoteId: '550e8400-e29b-41d4-a716-446655440000',
    transaction: 'SGVsbG8gV29ybGQ=', // base64 encoded
    userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Get mocked modules
    redis = require('../../../src/utils/redis');
    rpc = require('../../../src/utils/rpc');
    validator = require('../../../src/services/validator');
    feePayerPool = require('../../../src/services/fee-payer-pool');
    txQueue = require('../../../src/services/tx-queue');
    metrics = require('../../../src/utils/metrics');
    audit = require('../../../src/services/audit');
    anomalyDetector = require('../../../src/services/anomaly-detector').anomalyDetector;

    // Reset all mocks to default values
    redis.getQuote.mockResolvedValue(validQuote);
    redis.hasTransactionHash.mockResolvedValue(false);
    rpc.isBlockhashValid.mockResolvedValue(true);
    rpc.simulateTransaction.mockResolvedValue({ success: true, unitsConsumed: 200000 });
    rpc.sendTransaction.mockResolvedValue('test-signature-abc123');
    validator.deserializeTransaction.mockReturnValue({ message: {} });
    validator.validateTransaction.mockReturnValue({
      valid: true,
      feePayer: 'FeePayerPubkey111111111111111111111111111111',
    });
    validator.validateTransactionSize.mockReturnValue({ valid: true, size: 500 });
    feePayerPool.getReservation.mockReturnValue(null);
    txQueue.isRetryableError.mockReturnValue(false);

    // Create express app with submit router
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.requestId = 'test-request-id';
      next();
    });

    // Re-require route to get fresh instance
    jest.isolateModules(() => {
      submitRouter = require('../../../src/routes/submit');
    });
    app.use('/submit', submitRouter);
  });

  describe('POST /submit', () => {
    it('should return signature for valid submission', async () => {
      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(200);

      expect(response.body).toHaveProperty('signature');
      expect(response.body).toHaveProperty('status', 'submitted');
      expect(response.body).toHaveProperty('attempts');
      expect(response.body).toHaveProperty('explorer');
    });

    it('should include explorer link in response', async () => {
      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(200);

      expect(response.body.explorer).toContain('solscan.io/tx/');
    });

    it('should delete quote after successful submission', async () => {
      await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(200);

      expect(redis.deleteQuote).toHaveBeenCalledWith(validRequest.quoteId);
    });

    it('should mark transaction hash to prevent replay', async () => {
      await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(200);

      expect(redis.markTransactionHash).toHaveBeenCalled();
    });

    it('should track pending swap', async () => {
      await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(200);

      expect(redis.addPendingSwap).toHaveBeenCalledWith(validQuote.feeAmountLamports);
      expect(redis.incrTxCount).toHaveBeenCalled();
    });

    it('should increment success metrics', async () => {
      await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(200);

      expect(metrics.submitsTotal.inc).toHaveBeenCalledWith({ status: 'success' });
      expect(metrics.activeQuotes.dec).toHaveBeenCalled();
    });

    it('should log successful submission', async () => {
      await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(200);

      expect(audit.logSubmitSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          quoteId: validRequest.quoteId,
          signature: expect.any(String),
          userPubkey: validRequest.userPubkey,
        })
      );
    });
  });

  describe('quote validation', () => {
    it('should return 400 for non-existent quote', async () => {
      redis.getQuote.mockResolvedValue(null);

      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(400);

      expect(response.body.error).toContain('Quote not found');
      expect(response.body.code).toBe('QUOTE_NOT_FOUND');
    });

    it('should return 400 for expired quote', async () => {
      redis.getQuote.mockResolvedValue({
        ...validQuote,
        expiresAt: Date.now() - 1000, // Expired
      });

      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(400);

      expect(response.body.error).toBe('Quote expired');
      expect(response.body.code).toBe('QUOTE_EXPIRED');
    });

    it('should delete expired quote', async () => {
      redis.getQuote.mockResolvedValue({
        ...validQuote,
        expiresAt: Date.now() - 1000,
      });

      await request(app)
        .post('/submit')
        .send(validRequest);

      expect(redis.deleteQuote).toHaveBeenCalledWith(validRequest.quoteId);
    });
  });

  describe('transaction size validation', () => {
    it('should return 400 for oversized transaction', async () => {
      validator.validateTransactionSize.mockReturnValue({
        valid: false,
        error: 'Transaction too large',
        size: 2000,
        maxSize: 1232,
      });

      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(400);

      expect(response.body.code).toBe('TX_TOO_LARGE');
      expect(response.body.size).toBe(2000);
      expect(response.body.maxSize).toBe(1232);
    });

    it('should log security event for oversized transaction', async () => {
      validator.validateTransactionSize.mockReturnValue({
        valid: false,
        size: 2000,
        maxSize: 1232,
      });

      await request(app)
        .post('/submit')
        .send(validRequest);

      expect(audit.logSecurityEvent).toHaveBeenCalledWith(
        audit.AUDIT_EVENTS.VALIDATION_FAILED,
        expect.objectContaining({
          reason: 'transaction_size_exceeded',
        })
      );
    });
  });

  describe('transaction deserialization', () => {
    it('should return 400 for invalid transaction format', async () => {
      validator.deserializeTransaction.mockImplementation(() => {
        throw new Error('Invalid transaction');
      });

      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(400);

      expect(response.body.code).toBe('INVALID_TX_FORMAT');
    });
  });

  describe('anti-replay protection', () => {
    it('should return 400 for replay attack', async () => {
      redis.hasTransactionHash.mockResolvedValue(true);

      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(400);

      expect(response.body.error).toBe('Transaction already submitted');
      expect(response.body.code).toBe('REPLAY_DETECTED');
    });

    it('should log security event for replay', async () => {
      redis.hasTransactionHash.mockResolvedValue(true);

      await request(app)
        .post('/submit')
        .send(validRequest);

      expect(audit.logSecurityEvent).toHaveBeenCalledWith(
        audit.AUDIT_EVENTS.REPLAY_ATTACK_DETECTED,
        expect.objectContaining({
          quoteId: validRequest.quoteId,
        })
      );
    });

    it('should track failure for anomaly detection', async () => {
      redis.hasTransactionHash.mockResolvedValue(true);

      await request(app)
        .post('/submit')
        .send(validRequest);

      expect(anomalyDetector.trackWallet).toHaveBeenCalledWith(
        validRequest.userPubkey,
        'failure',
        expect.any(String)
      );
    });
  });

  describe('blockhash validation', () => {
    it('should return 400 for expired blockhash', async () => {
      rpc.isBlockhashValid.mockResolvedValue(false);

      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(400);

      expect(response.body.error).toContain('blockhash expired');
      expect(response.body.code).toBe('BLOCKHASH_EXPIRED');
    });

    it('should log security event for stale blockhash', async () => {
      rpc.isBlockhashValid.mockResolvedValue(false);

      await request(app)
        .post('/submit')
        .send(validRequest);

      expect(audit.logSecurityEvent).toHaveBeenCalledWith(
        audit.AUDIT_EVENTS.BLOCKHASH_EXPIRED,
        expect.any(Object)
      );
    });
  });

  describe('transaction validation', () => {
    it('should return 400 for invalid transaction', async () => {
      validator.validateTransaction.mockReturnValue({
        valid: false,
        errors: ['Invalid instruction'],
      });

      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.details).toContain('Invalid instruction');
    });
  });

  describe('fee payer validation', () => {
    it('should return 400 for fee payer mismatch with reservation', async () => {
      feePayerPool.getReservation.mockReturnValue({
        pubkey: 'DifferentPayer11111111111111111111111111111',
      });
      validator.validateTransaction.mockReturnValue({
        valid: true,
        feePayer: 'FeePayerPubkey111111111111111111111111111111',
      });

      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(400);

      expect(response.body.code).toBe('FEE_PAYER_MISMATCH');
    });

    it('should return 400 for fee payer mismatch with quote', async () => {
      redis.getQuote.mockResolvedValue({
        ...validQuote,
        feePayer: 'DifferentPayer11111111111111111111111111111',
      });

      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(400);

      expect(response.body.code).toBe('FEE_PAYER_MISMATCH');
    });
  });

  describe('transaction simulation', () => {
    it('should return 400 for failed simulation', async () => {
      rpc.simulateTransaction.mockResolvedValue({
        success: false,
        error: 'Simulation failed',
        logs: ['Error log 1', 'Error log 2'],
      });

      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(400);

      expect(response.body.code).toBe('SIMULATION_FAILED');
      expect(response.body.details).toBe('Simulation failed');
    });

    it('should release reservation on simulation failure', async () => {
      rpc.simulateTransaction.mockResolvedValue({
        success: false,
        error: 'Simulation failed',
      });

      await request(app)
        .post('/submit')
        .send(validRequest);

      expect(feePayerPool.releaseReservation).toHaveBeenCalledWith(validRequest.quoteId);
    });
  });

  describe('transaction submission failure', () => {
    it('should return 500 when all retries fail', async () => {
      rpc.sendTransaction.mockRejectedValue(new Error('Network error'));
      txQueue.isRetryableError.mockReturnValue(true);

      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(500);

      expect(response.body.code).toBe('SUBMIT_FAILED');
      expect(response.body.attempts).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should return 500 on unexpected error', async () => {
      redis.getQuote.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/submit')
        .send(validRequest)
        .expect(500);

      expect(response.body.error).toBe('Failed to submit transaction');
      expect(response.body.code).toBe('SUBMIT_FAILED');
    });

    it('should increment error metrics on failure', async () => {
      redis.getQuote.mockRejectedValue(new Error('Database error'));

      await request(app)
        .post('/submit')
        .send(validRequest);

      expect(metrics.submitsTotal.inc).toHaveBeenCalledWith({ status: 'error' });
    });

    it('should release reservation on error', async () => {
      redis.getQuote.mockRejectedValue(new Error('Database error'));

      await request(app)
        .post('/submit')
        .send(validRequest);

      expect(feePayerPool.releaseReservation).toHaveBeenCalled();
    });
  });

  describe('GET /submit/status/:txId', () => {
    it('should return transaction status', async () => {
      txQueue.getEntry.mockResolvedValue({
        id: 'tx-123',
        status: 'completed',
        signature: 'sig-abc',
        attempts: 1,
        createdAt: Date.now(),
        completedAt: Date.now(),
      });

      const response = await request(app)
        .get('/submit/status/tx-123')
        .expect(200);

      expect(response.body.id).toBe('tx-123');
      expect(response.body.status).toBe('completed');
      expect(response.body.signature).toBe('sig-abc');
    });

    it('should return 404 for unknown transaction', async () => {
      txQueue.getEntry.mockResolvedValue(null);

      const response = await request(app)
        .get('/submit/status/unknown-tx')
        .expect(404);

      expect(response.body.code).toBe('TX_NOT_FOUND');
    });

    it('should return 500 on error', async () => {
      txQueue.getEntry.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/submit/status/tx-123')
        .expect(500);

      expect(response.body.error).toBe('Failed to get transaction status');
    });
  });
});
