/**
 * Tests for Tokens Route
 */

const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring the route
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/middleware/security', () => ({
  scoreLimiter: (req, res, next) => next(),
  globalLimiter: (req, res, next) => next(),
}));

jest.mock('../../../src/utils/rpc', () => ({
  getConnection: jest.fn().mockReturnValue({
    getParsedTokenAccountsByOwner: jest.fn().mockResolvedValue({ value: [] }),
  }),
  getBalance: jest.fn().mockResolvedValue(0),
}));

jest.mock('../../../src/utils/config', () => ({
  BASE_FEE_LAMPORTS: 50000,
  NETWORK_FEE_LAMPORTS: 5000,
}));

jest.mock('../../../src/services/helius', () => ({
  calculatePriorityFee: jest.fn().mockResolvedValue({
    priorityFeeLamports: 1000,
    microLamportsPerCU: 5,
  }),
}));

jest.mock('../../../src/services/jupiter', () => ({
  getFeeInToken: jest.fn().mockResolvedValue({
    inputAmount: 1000,
    symbol: 'TEST',
    decimals: 6,
  }),
}));

jest.mock('../../../src/services/holdex', () => ({
  getToken: jest.fn().mockResolvedValue({
    kScore: 75,
    tier: 'Gold',
    kRank: { tier: 'Gold', icon: '🥇', level: 6 },
    creditRating: { grade: 'A3', risk: 'low' },
  }),
  getAllTokens: jest.fn().mockResolvedValue({ success: true, tokens: [] }),
  getKRank: jest.fn().mockReturnValue({ tier: 'Gold', icon: '🥇', level: 6 }),
  getCreditRating: jest.fn().mockReturnValue({ grade: 'A3', risk: 'low' }),
  ACCEPTED_TIERS: new Set(['Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze']),
}));

jest.mock('../../../src/services/holder-tiers', () => ({
  getAllTiers: jest.fn().mockReturnValue([
    { name: 'NORMIE', emoji: '👤', minHolding: 0, discountPercent: 0 },
    { name: 'HOLDER', emoji: '💎', minHolding: 10000, discountPercent: 10 },
    { name: 'WHALE', emoji: '🐋', minHolding: 100000, discountPercent: 25 },
    { name: 'OG', emoji: '🏆', minHolding: 1000000, discountPercent: 50 },
  ]),
  getHolderTier: jest.fn().mockResolvedValue({
    tier: 'BRONZE',
    emoji: '🥉',
    balance: 0,
    discountPercent: 0,
  }),
  calculateDiscountedFee: jest.fn().mockResolvedValue({
    discountedFee: 50000,
    savingsPercent: 0,
  }),
}));

jest.mock('../../../src/services/token-gate', () => ({
  getAcceptedTokensList: jest.fn().mockReturnValue([
    {
      mint: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      decimals: 9,
      trusted: true,
    },
    {
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      decimals: 6,
      trusted: true,
    },
  ]),
  isTokenAccepted: jest.fn(),
  isDiamondToken: jest.fn().mockReturnValue(false),
}));

const tokensRouter = require('../../../src/routes/tokens');
const { getHolderTier } = require('../../../src/services/holder-tiers');
const { isTokenAccepted } = require('../../../src/services/token-gate');

describe('Tokens Route', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/tokens', tokensRouter);
    jest.clearAllMocks();
  });

  describe('GET /tokens', () => {
    it('should return list of accepted tokens', async () => {
      const res = await request(app).get('/tokens');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('tokens');
      expect(res.body.tokens).toHaveLength(2);
      expect(res.body.tokens[0]).toHaveProperty('symbol', 'SOL');
      expect(res.body.tokens[1]).toHaveProperty('symbol', 'USDC');
      expect(res.body).toHaveProperty('note');
    });
  });

  describe('GET /tokens/:mint/check', () => {
    it('should return accepted for trusted token', async () => {
      isTokenAccepted.mockResolvedValue({
        accepted: true,
        reason: 'trusted',
      });

      const mint = 'So11111111111111111111111111111111111111112';
      const res = await request(app).get(`/tokens/${mint}/check`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        mint,
        accepted: true,
        reason: 'trusted',
      });
    });

    it('should return accepted for HolDex-verified token', async () => {
      isTokenAccepted.mockResolvedValue({
        accepted: true,
        reason: 'holdex_verified',
      });

      const mint = '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump';
      const res = await request(app).get(`/tokens/${mint}/check`);

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      expect(res.body.reason).toBe('holdex_verified');
    });

    it('should return not accepted for unknown token', async () => {
      isTokenAccepted.mockResolvedValue({
        accepted: false,
        reason: 'not_verified',
      });

      const mint = 'UnknownMint11111111111111111111111111111111';
      const res = await request(app).get(`/tokens/${mint}/check`);

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(false);
      expect(res.body.reason).toBe('not_verified');
    });

    it('should return 400 for invalid mint address format', async () => {
      const res = await request(app).get('/tokens/invalid-mint/check');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid mint address format');
    });

    it('should return 400 for mint address with invalid characters', async () => {
      const res = await request(app).get(
        '/tokens/0OIl00000000000000000000000000000000000000/check'
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid mint address format');
    });

    it('should return 500 when isTokenAccepted throws', async () => {
      isTokenAccepted.mockRejectedValue(new Error('Service unavailable'));

      const mint = 'So11111111111111111111111111111111111111112';
      const res = await request(app).get(`/tokens/${mint}/check`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to check token');
    });
  });

  describe('GET /tokens/tiers', () => {
    it('should return tier structure', async () => {
      const res = await request(app).get('/tokens/tiers');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('tiers');
      expect(res.body.tiers).toHaveLength(4);
      expect(res.body).toHaveProperty('description');
    });

    it('should return correct tier details', async () => {
      const res = await request(app).get('/tokens/tiers');

      const tiers = res.body.tiers;
      expect(tiers[0]).toMatchObject({ name: 'NORMIE', discountPercent: 0 });
      expect(tiers[3]).toMatchObject({ name: 'OG', discountPercent: 50 });
    });
  });

  describe('GET /tokens/tiers/:wallet', () => {
    it('should return tier info for valid wallet', async () => {
      getHolderTier.mockResolvedValue({
        tier: 'HOLDER',
        emoji: '💎',
        balance: 50000,
        sharePercent: 0.005,
        circulating: 1000000000,
        discountPercent: 10,
      });

      const wallet = 'iuj2dDvPozkJARoqWpKLLGD9QgAkJS1K1d6RxPy2YCX';
      const res = await request(app).get(`/tokens/tiers/${wallet}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        wallet,
        tier: 'HOLDER',
        emoji: '💎',
        asdfBalance: 50000,
        discountPercent: 10,
      });
    });

    it('should return NORMIE tier for wallet with no holdings', async () => {
      getHolderTier.mockResolvedValue({
        tier: 'NORMIE',
        emoji: '👤',
        balance: 0,
        sharePercent: 0,
        circulating: 1000000000,
        discountPercent: 0,
      });

      const wallet = 'NAsdfWa11et11111111111111111111111111111111';
      const res = await request(app).get(`/tokens/tiers/${wallet}`);

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe('NORMIE');
      expect(res.body.discountPercent).toBe(0);
    });

    it('should return 400 for invalid wallet address format', async () => {
      const res = await request(app).get('/tokens/tiers/invalid-wallet');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid wallet address format');
    });

    it('should return 400 for wallet with invalid base58 characters', async () => {
      const res = await request(app).get(
        '/tokens/tiers/0OIl00000000000000000000000000000000000000'
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid wallet address format');
    });

    it('should return 500 when getHolderTier throws', async () => {
      getHolderTier.mockRejectedValue(new Error('RPC error'));

      const wallet = 'iuj2dDvPozkJARoqWpKLLGD9QgAkJS1K1d6RxPy2YCX';
      const res = await request(app).get(`/tokens/tiers/${wallet}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get tier info');
    });
  });
});
