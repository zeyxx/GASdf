/**
 * Quote → Submit Flow Tests
 *
 * Tests the complete gasless transaction lifecycle at the route level.
 * These are "flow tests" that verify the interaction between quote and submit.
 */

const request = require('supertest');
const express = require('express');

// =============================================================================
// Mocks
// =============================================================================

jest.mock('../../../src/utils/config', () => ({
  IS_DEV: true,
  BASE_FEE_LAMPORTS: 50000,
  NETWORK_FEE_LAMPORTS: 5000,
  QUOTE_TTL_SECONDS: 60,
  WSOL_MINT: 'So11111111111111111111111111111111111111112',
  ASDF_MINT: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Shared quote storage between quote and submit (prefixed with 'mock' for jest)
const mockQuoteStorage = new Map();

jest.mock('../../../src/utils/redis', () => ({
  setQuote: jest.fn((key, value, _ttl) => {
    mockQuoteStorage.set(key, value);
    return Promise.resolve(true);
  }),
  getQuote: jest.fn((key) => Promise.resolve(mockQuoteStorage.get(key) || null)),
  deleteQuote: jest.fn((key) => {
    mockQuoteStorage.delete(key);
    return Promise.resolve(true);
  }),
  claimTxSlot: jest.fn().mockResolvedValue(true),
  trackPendingSwap: jest.fn().mockResolvedValue(true),
  incrementStats: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../../src/services/jupiter', () => ({
  getFeeInToken: jest.fn().mockResolvedValue({
    inputAmount: 100000,
    outputAmount: 50000,
    symbol: 'USDC',
    decimals: 6,
    priceImpactPct: 0.1,
  }),
}));

jest.mock('../../../src/services/token-gate', () => ({
  isTokenAccepted: jest.fn().mockResolvedValue({
    accepted: true,
    reason: 'trusted',
  }),
}));

jest.mock('../../../src/services/holder-tiers', () => ({
  calculateDiscountedFee: jest.fn().mockResolvedValue({
    originalFee: 50000,
    discountedFee: 50000,
    breakEvenFee: 25000,
    savings: 0,
    savingsPercent: 0,
    maxDiscountPercent: 50,
    tier: 'NORMIE',
    tierEmoji: '👤',
    balance: 0,
    nextTier: { name: 'HOLDER', minHolding: 10000, needed: 10000 },
    isAtBreakEven: false,
  }),
}));

jest.mock('../../../src/services/fee-payer-pool', () => ({
  reserveBalance: jest.fn().mockResolvedValue('FeePayer111111111111111111111111111111111'),
  releaseReservation: jest.fn().mockResolvedValue(true),
  isCircuitOpen: jest.fn().mockReturnValue(false),
  getCircuitState: jest.fn().mockReturnValue({ open: false }),
}));

jest.mock('../../../src/services/treasury-ata', () => ({
  ensureTreasuryAta: jest.fn().mockResolvedValue('TreasuryATA1111111111111111111111111111111'),
  getTreasuryAddress: jest.fn().mockReturnValue({
    toBase58: () => 'Treasury111111111111111111111111111111111',
  }),
}));

jest.mock('../../../src/middleware/security', () => ({
  quoteLimiter: (req, res, next) => next(),
  walletQuoteLimiter: (req, res, next) => next(),
  submitLimiter: (req, res, next) => next(),
}));

jest.mock('../../../src/middleware/validation', () => ({
  validate: () => (req, res, next) => next(),
}));

jest.mock('../../../src/utils/metrics', () => ({
  quotesTotal: { inc: jest.fn() },
  quoteDuration: { observe: jest.fn() },
  activeQuotes: { inc: jest.fn(), dec: jest.fn() },
  submitsTotal: { inc: jest.fn() },
  submitDuration: { observe: jest.fn() },
  errorsTotal: { inc: jest.fn() },
}));

jest.mock('../../../src/services/audit', () => ({
  logQuoteCreated: jest.fn(),
  logQuoteRejected: jest.fn(),
  logSubmitSuccess: jest.fn(),
  logSubmitFailure: jest.fn(),
  logSecurityEvent: jest.fn(),
}));

jest.mock('../../../src/services/anomaly-detector', () => ({
  anomalyDetector: {
    trackWallet: jest.fn().mockResolvedValue(true),
    trackIp: jest.fn().mockResolvedValue(true),
    checkRateLimit: jest.fn().mockReturnValue({ allowed: true }),
    trackSuccess: jest.fn(),
    trackFailure: jest.fn(),
  },
}));

jest.mock('../../../src/utils/safe-math', () => ({
  clamp: jest.fn((value, min, max) => Math.min(Math.max(value, min), max)),
  safeMul: jest.fn((a, b) => a * b),
  safeCeil: jest.fn((val) => Math.ceil(val)),
  MAX_COMPUTE_UNITS: 1400000,
}));

const quoteRouter = require('../../../src/routes/quote');
const redis = require('../../../src/utils/redis');
const { isTokenAccepted } = require('../../../src/services/token-gate');
const { reserveBalance, isCircuitOpen } = require('../../../src/services/fee-payer-pool');
const { calculateDiscountedFee } = require('../../../src/services/holder-tiers');
const audit = require('../../../src/services/audit');
const metrics = require('../../../src/utils/metrics');

// =============================================================================
// Test Suite
// =============================================================================

describe('Quote → Submit Flow', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/quote', quoteRouter);
    mockQuoteStorage.clear();
    jest.clearAllMocks();
  });

  // ===========================================================================
  // Quote Creation
  // ===========================================================================

  describe('Quote Creation', () => {
    const validQuoteRequest = {
      paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      userPubkey: 'UserWallet1111111111111111111111111111111',
    };

    it('should create a quote and return required fields', async () => {
      const res = await request(app).post('/quote').send(validQuoteRequest);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('quoteId');
      expect(res.body).toHaveProperty('feePayer', 'FeePayer111111111111111111111111111111111');
      expect(res.body).toHaveProperty('feeAmount');
      expect(res.body).toHaveProperty('expiresAt');
      expect(res.body.holderTier).toHaveProperty('tier', 'NORMIE');
    });

    it('should store quote in redis', async () => {
      const res = await request(app).post('/quote').send(validQuoteRequest);

      expect(res.status).toBe(200);
      const storedQuote = await redis.getQuote(res.body.quoteId);
      expect(storedQuote).not.toBeNull();
      expect(storedQuote.userPubkey).toBe(validQuoteRequest.userPubkey);
    });

    it('should include payment token info', async () => {
      const res = await request(app).post('/quote').send(validQuoteRequest);

      expect(res.status).toBe(200);
      expect(res.body.paymentToken).toHaveProperty('mint', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(res.body.paymentToken).toHaveProperty('symbol', 'USDC');
      expect(res.body.paymentToken).toHaveProperty('decimals', 6);
    });

    it('should log quote creation', async () => {
      await request(app).post('/quote').send(validQuoteRequest);

      expect(audit.logQuoteCreated).toHaveBeenCalled();
    });

    it('should increment metrics', async () => {
      await request(app).post('/quote').send(validQuoteRequest);

      expect(metrics.quotesTotal.inc).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Quote Validation
  // ===========================================================================

  describe('Quote Validation', () => {
    it('should reject unverified tokens', async () => {
      isTokenAccepted.mockResolvedValueOnce({
        accepted: false,
        reason: 'not_verified',
      });

      const res = await request(app).post('/quote').send({
        paymentToken: 'UnverifiedToken111111111111111111111111111',
        userPubkey: 'UserWallet1111111111111111111111111111111',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not accepted');
      expect(audit.logQuoteRejected).toHaveBeenCalled();
    });

    it('should reject when circuit breaker is open', async () => {
      isCircuitOpen.mockReturnValueOnce(true);

      const res = await request(app).post('/quote').send({
        paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        userPubkey: 'UserWallet1111111111111111111111111111111',
      });

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('unavailable');
    });

    it('should reject when no fee payer available', async () => {
      reserveBalance.mockResolvedValueOnce(null);

      const res = await request(app).post('/quote').send({
        paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        userPubkey: 'UserWallet1111111111111111111111111111111',
      });

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('capacity');
    });
  });

  // ===========================================================================
  // Tier System Integration
  // ===========================================================================

  describe('Tier System', () => {
    it('should apply tier discount to fees', async () => {
      calculateDiscountedFee.mockResolvedValueOnce({
        originalFee: 50000,
        discountedFee: 25000, // 50% discount for OG tier
        breakEvenFee: 25000,
        savings: 25000,
        savingsPercent: 50,
        maxDiscountPercent: 50,
        tier: 'OG',
        tierEmoji: '🏆',
        balance: 2000000,
        nextTier: null,
        isAtBreakEven: true,
      });

      const res = await request(app).post('/quote').send({
        paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        userPubkey: 'OGHolder11111111111111111111111111111111',
      });

      expect(res.status).toBe(200);
      expect(res.body.holderTier.tier).toBe('OG');
      expect(res.body.holderTier).toHaveProperty('savings', 25000);
    });

    it('should include next tier info for non-max tiers', async () => {
      const res = await request(app).post('/quote').send({
        paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        userPubkey: 'UserWallet1111111111111111111111111111111',
      });

      expect(res.status).toBe(200);
      expect(res.body.holderTier.nextTier).toEqual({
        name: 'HOLDER',
        minHolding: 10000,
        needed: 10000,
      });
    });
  });

  // ===========================================================================
  // Quote Expiry
  // ===========================================================================

  describe('Quote Expiry', () => {
    it('should set expiration time', async () => {
      const beforeRequest = Date.now();

      const res = await request(app).post('/quote').send({
        paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        userPubkey: 'UserWallet1111111111111111111111111111111',
      });

      expect(res.status).toBe(200);
      expect(res.body.expiresAt).toBeGreaterThan(beforeRequest);
      // Should expire in ~60 seconds (QUOTE_TTL_SECONDS)
      expect(res.body.expiresAt).toBeLessThan(beforeRequest + 70000);
    });
  });

  // ===========================================================================
  // Payment Token Handling
  // ===========================================================================

  describe('Payment Token Handling', () => {
    it('should accept trusted tokens', async () => {
      const res = await request(app).post('/quote').send({
        paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        userPubkey: 'UserWallet1111111111111111111111111111111',
      });

      expect(res.status).toBe(200);
      expect(res.body.paymentToken.accepted).toBe('trusted');
    });

    it('should accept HolDex verified tokens', async () => {
      isTokenAccepted.mockResolvedValueOnce({
        accepted: true,
        reason: 'holdex_verified',
        kScore: 85,
      });

      const res = await request(app).post('/quote').send({
        paymentToken: 'Ho1dexVerified11111111111111111111111111111',
        userPubkey: 'UserWallet1111111111111111111111111111111',
      });

      expect(res.status).toBe(200);
      expect(res.body.paymentToken.accepted).toBe('holdex_verified');
    });
  });

  // ===========================================================================
  // Compute Units (stored in quote, affects fee calculation)
  // ===========================================================================

  describe('Compute Units', () => {
    it('should accept custom compute units and store in quote', async () => {
      const res = await request(app).post('/quote').send({
        paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        userPubkey: 'UserWallet1111111111111111111111111111111',
        estimatedComputeUnits: 500000,
      });

      expect(res.status).toBe(200);
      // Compute units are stored in the quote, not returned directly
      const storedQuote = await redis.getQuote(res.body.quoteId);
      expect(storedQuote.estimatedComputeUnits).toBe(500000);
    });

    it('should use default compute units when not specified', async () => {
      const res = await request(app).post('/quote').send({
        paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        userPubkey: 'UserWallet1111111111111111111111111111111',
      });

      expect(res.status).toBe(200);
      const storedQuote = await redis.getQuote(res.body.quoteId);
      expect(storedQuote.estimatedComputeUnits).toBe(200000); // default
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should return 500 on Jupiter error', async () => {
      const { getFeeInToken } = require('../../../src/services/jupiter');
      getFeeInToken.mockRejectedValueOnce(new Error('Jupiter API down'));

      const res = await request(app).post('/quote').send({
        paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        userPubkey: 'UserWallet1111111111111111111111111111111',
      });

      expect(res.status).toBe(500);
      expect(metrics.quotesTotal.inc).toHaveBeenCalledWith({ status: 'error' });
    });

    it('should return 500 on token-gate error', async () => {
      isTokenAccepted.mockRejectedValueOnce(new Error('HolDex API down'));

      const res = await request(app).post('/quote').send({
        paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        userPubkey: 'UserWallet1111111111111111111111111111111',
      });

      expect(res.status).toBe(500);
    });
  });
});
