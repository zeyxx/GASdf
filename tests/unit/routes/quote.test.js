/**
 * Tests for Quote Route
 */

const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring the route
jest.mock('../../../src/utils/config', () => ({
  IS_DEV: true,
  BASE_FEE_LAMPORTS: 5000,
  FEE_MULTIPLIER: 1.2,
  QUOTE_TTL_SECONDS: 60,
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/utils/redis', () => ({
  setQuote: jest.fn().mockResolvedValue(true),
  getQuote: jest.fn(),
  deleteQuote: jest.fn(),
}));

jest.mock('../../../src/services/jupiter', () => ({
  getFeeInToken: jest.fn().mockResolvedValue({
    inputAmount: 100000,
    symbol: 'USDC',
    decimals: 6,
  }),
}));

jest.mock('../../../src/services/oracle', () => ({
  getKScore: jest.fn().mockResolvedValue({
    score: 85,
    tier: 'TRUSTED',
    feeMultiplier: 1.0,
  }),
}));

jest.mock('../../../src/services/holder-tiers', () => ({
  calculateDiscountedFee: jest.fn().mockResolvedValue({
    originalFee: 6000,
    discountedFee: 25000, // Floored at break-even
    breakEvenFee: 25000,
    savings: -19000, // 6000 - 25000
    savingsPercent: 0,
    maxDiscountPercent: 0,
    tier: 'NORMIE',
    tierEmoji: '👤',
    balance: 0,
    nextTier: { name: 'HOLDER', minHolding: 10000, needed: 10000 },
    isAtBreakEven: true,
  }),
}));

jest.mock('../../../src/services/fee-payer-pool', () => ({
  reserveBalance: jest.fn().mockResolvedValue('FeePayerPubkey111111111111111111111111111111'),
  isCircuitOpen: jest.fn().mockReturnValue(false),
  getCircuitState: jest.fn().mockReturnValue({
    open: false,
    closesAt: null,
  }),
}));

jest.mock('../../../src/utils/safe-math', () => ({
  clamp: jest.fn((value, min, max) => Math.min(Math.max(value, min), max)),
  safeMul: jest.fn((a, b) => a * b),
  safeCeil: jest.fn((val) => Math.ceil(val)),
  MAX_COMPUTE_UNITS: 1400000,
}));

jest.mock('../../../src/middleware/security', () => ({
  quoteLimiter: (req, res, next) => next(),
  walletQuoteLimiter: (req, res, next) => next(),
}));

jest.mock('../../../src/middleware/validation', () => ({
  validate: () => (req, res, next) => next(),
}));

jest.mock('../../../src/utils/metrics', () => ({
  quotesTotal: { inc: jest.fn() },
  quoteDuration: { observe: jest.fn() },
  activeQuotes: { inc: jest.fn(), dec: jest.fn() },
}));

jest.mock('../../../src/services/audit', () => ({
  logQuoteCreated: jest.fn(),
  logQuoteRejected: jest.fn(),
  AUDIT_EVENTS: {
    QUOTE_CREATED: 'quote.created',
    QUOTE_REJECTED: 'quote.rejected',
  },
}));

jest.mock('../../../src/services/anomaly-detector', () => ({
  anomalyDetector: {
    trackWallet: jest.fn().mockResolvedValue(undefined),
    trackIp: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('test-quote-uuid-1234'),
}));

describe('Quote Route', () => {
  let app;
  let quoteRouter;
  let jupiter;
  let oracle;
  let feePayerPool;
  let redis;
  let safeMath;
  let metrics;
  let audit;

  beforeEach(() => {
    jest.clearAllMocks();

    // Get mocked modules
    jupiter = require('../../../src/services/jupiter');
    oracle = require('../../../src/services/oracle');
    feePayerPool = require('../../../src/services/fee-payer-pool');
    redis = require('../../../src/utils/redis');
    safeMath = require('../../../src/utils/safe-math');
    metrics = require('../../../src/utils/metrics');
    audit = require('../../../src/services/audit');

    // Reset all mocks to default values
    jupiter.getFeeInToken.mockResolvedValue({
      inputAmount: 100000,
      symbol: 'USDC',
      decimals: 6,
    });
    oracle.getKScore.mockResolvedValue({
      score: 85,
      tier: 'TRUSTED',
      feeMultiplier: 1.0,
    });
    feePayerPool.isCircuitOpen.mockReturnValue(false);
    feePayerPool.reserveBalance.mockResolvedValue('FeePayerPubkey111111111111111111111111111111');
    feePayerPool.getCircuitState.mockReturnValue({ open: false, closesAt: null });
    safeMath.clamp.mockImplementation((value, min, max) => Math.min(Math.max(value, min), max));
    safeMath.safeMul.mockImplementation((a, b) => a * b);
    safeMath.safeCeil.mockImplementation((val) => Math.ceil(val));

    // Create express app with quote router
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.requestId = 'test-request-id';
      next();
    });

    // Re-require route to get fresh instance
    jest.isolateModules(() => {
      quoteRouter = require('../../../src/routes/quote');
    });
    app.use('/quote', quoteRouter);
  });

  describe('POST /quote', () => {
    const validRequest = {
      paymentToken: 'So11111111111111111111111111111111111111112',
      userPubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    };

    it('should return quote for valid request', async () => {
      const response = await request(app)
        .post('/quote')
        .send(validRequest)
        .expect(200);

      expect(response.body).toHaveProperty('quoteId');
      expect(response.body).toHaveProperty('feePayer');
      expect(response.body).toHaveProperty('feeAmount');
      expect(response.body).toHaveProperty('paymentToken');
      expect(response.body).toHaveProperty('kScore');
      expect(response.body).toHaveProperty('expiresAt');
      expect(response.body).toHaveProperty('ttl');
    });

    it('should include kScore info in response', async () => {
      const response = await request(app)
        .post('/quote')
        .send(validRequest)
        .expect(200);

      expect(response.body.kScore).toEqual({
        score: 85,
        tier: 'TRUSTED',
        feeMultiplier: 1.0,
      });
    });

    it('should include payment token info in response', async () => {
      const response = await request(app)
        .post('/quote')
        .send(validRequest)
        .expect(200);

      expect(response.body.paymentToken).toEqual({
        mint: validRequest.paymentToken,
        symbol: 'USDC',
        decimals: 6,
      });
    });

    it('should call oracle for K-score', async () => {
      await request(app)
        .post('/quote')
        .send(validRequest);

      expect(oracle.getKScore).toHaveBeenCalledWith(validRequest.paymentToken);
    });

    it('should call jupiter for fee conversion', async () => {
      await request(app)
        .post('/quote')
        .send(validRequest);

      expect(jupiter.getFeeInToken).toHaveBeenCalledWith(
        validRequest.paymentToken,
        expect.any(Number)
      );
    });

    it('should store quote in redis', async () => {
      await request(app)
        .post('/quote')
        .send(validRequest)
        .expect(200);

      expect(redis.setQuote).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          paymentToken: validRequest.paymentToken,
          userPubkey: validRequest.userPubkey,
          feePayer: expect.any(String),
        })
      );
    });

    it('should increment metrics on success', async () => {
      await request(app)
        .post('/quote')
        .send(validRequest)
        .expect(200);

      expect(metrics.quotesTotal.inc).toHaveBeenCalledWith({ status: 'success' });
      expect(metrics.quoteDuration.observe).toHaveBeenCalled();
      expect(metrics.activeQuotes.inc).toHaveBeenCalled();
    });

    it('should log quote creation', async () => {
      await request(app)
        .post('/quote')
        .send(validRequest)
        .expect(200);

      expect(audit.logQuoteCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          quoteId: expect.any(String),
          userPubkey: validRequest.userPubkey,
          paymentToken: validRequest.paymentToken,
        })
      );
    });

    describe('with estimatedComputeUnits', () => {
      it('should accept custom compute units', async () => {
        const response = await request(app)
          .post('/quote')
          .send({
            ...validRequest,
            estimatedComputeUnits: 400000,
          })
          .expect(200);

        expect(response.body.quoteId).toBeDefined();
        expect(safeMath.clamp).toHaveBeenCalled();
      });
    });

    describe('circuit breaker open', () => {
      it('should return 503 when circuit is open', async () => {
        feePayerPool.isCircuitOpen.mockReturnValue(true);
        feePayerPool.getCircuitState.mockReturnValue({
          open: true,
          closesAt: Date.now() + 30000,
        });

        const response = await request(app)
          .post('/quote')
          .send(validRequest)
          .expect(503);

        expect(response.body.error).toContain('Service temporarily unavailable');
        expect(response.body.code).toBe('CIRCUIT_BREAKER_OPEN');
        expect(response.body.retryAfter).toBeDefined();
      });

      it('should log quote rejection', async () => {
        feePayerPool.isCircuitOpen.mockReturnValue(true);
        feePayerPool.getCircuitState.mockReturnValue({
          open: true,
          closesAt: Date.now() + 30000,
        });

        await request(app)
          .post('/quote')
          .send(validRequest);

        expect(audit.logQuoteRejected).toHaveBeenCalledWith(
          expect.objectContaining({
            reason: 'Circuit breaker open',
            code: 'CIRCUIT_BREAKER_OPEN',
          })
        );
      });
    });

    describe('no fee payer capacity', () => {
      it('should return 503 when no fee payer available', async () => {
        feePayerPool.reserveBalance.mockResolvedValue(null);

        const response = await request(app)
          .post('/quote')
          .send(validRequest)
          .expect(503);

        expect(response.body.error).toContain('no fee payer capacity');
        expect(response.body.code).toBe('NO_PAYER_CAPACITY');
        expect(response.body.retryAfter).toBe(30);
      });

      it('should log quote rejection for no capacity', async () => {
        feePayerPool.reserveBalance.mockResolvedValue(null);

        await request(app)
          .post('/quote')
          .send(validRequest);

        expect(audit.logQuoteRejected).toHaveBeenCalledWith(
          expect.objectContaining({
            code: 'NO_PAYER_CAPACITY',
          })
        );
      });
    });

    describe('fee calculation overflow', () => {
      it('should return 500 on fee overflow', async () => {
        safeMath.safeCeil.mockReturnValue(null);

        const response = await request(app)
          .post('/quote')
          .send(validRequest)
          .expect(500);

        expect(response.body.code).toBe('FEE_OVERFLOW');
      });

      it('should return 500 on zero fee', async () => {
        safeMath.safeCeil.mockReturnValue(0);

        const response = await request(app)
          .post('/quote')
          .send(validRequest)
          .expect(500);

        expect(response.body.code).toBe('FEE_OVERFLOW');
      });
    });

    describe('error handling', () => {
      it('should return 500 on jupiter error', async () => {
        jupiter.getFeeInToken.mockRejectedValue(new Error('Jupiter API error'));

        const response = await request(app)
          .post('/quote')
          .send(validRequest)
          .expect(500);

        expect(response.body.error).toBe('Failed to generate quote');
        expect(response.body.code).toBe('QUOTE_FAILED');
      });

      it('should return 500 on oracle error', async () => {
        oracle.getKScore.mockRejectedValue(new Error('Oracle error'));

        const response = await request(app)
          .post('/quote')
          .send(validRequest)
          .expect(500);

        expect(response.body.code).toBe('QUOTE_FAILED');
      });

      it('should return 503 on circuit breaker exception', async () => {
        const error = new Error('Circuit open');
        error.code = 'CIRCUIT_OPEN';
        oracle.getKScore.mockRejectedValue(error);

        const response = await request(app)
          .post('/quote')
          .send(validRequest)
          .expect(503);

        expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
      });

      it('should increment error metrics', async () => {
        oracle.getKScore.mockRejectedValue(new Error('Test error'));

        await request(app)
          .post('/quote')
          .send(validRequest);

        expect(metrics.quotesTotal.inc).toHaveBeenCalledWith({ status: 'error' });
      });
    });
  });
});
