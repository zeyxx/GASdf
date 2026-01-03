/**
 * Unit Tests for Stats Route
 */

const request = require('supertest');
const express = require('express');

// Mock Solana dependencies
jest.mock('@solana/web3.js', () => ({
  PublicKey: jest.fn().mockImplementation((key) => ({
    toBase58: () => key,
    toString: () => key,
  })),
}));

jest.mock('@solana/spl-token', () => ({
  getAccount: jest.fn(),
  getAssociatedTokenAddress: jest.fn().mockResolvedValue('MockATA'),
}));

jest.mock('../../../src/utils/config', () => ({
  ASDF_MINT: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
  BURN_RATIO: 0.8,
  TREASURY_RATIO: 0.2,
}));

jest.mock('../../../src/utils/redis', () => ({
  getStats: jest.fn(),
  getTreasuryBalance: jest.fn(),
  getWalletBurnStats: jest.fn(),
  getBurnerCount: jest.fn(),
  getBurnLeaderboard: jest.fn(),
  getTreasuryHistory: jest.fn(),
  getBurnProofs: jest.fn(),
  getBurnProofBySignature: jest.fn(),
}));

jest.mock('../../../src/utils/rpc', () => ({
  getConnection: jest.fn().mockReturnValue({
    getBalance: jest.fn().mockResolvedValue(1000000000),
  }),
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/services/treasury-ata', () => ({
  getTreasuryAddress: jest.fn().mockReturnValue({
    toBase58: () => 'TreasuryAddress123',
  }),
}));

const redis = require('../../../src/utils/redis');
const rpc = require('../../../src/utils/rpc');
const { getAccount } = require('@solana/spl-token');
const { getTreasuryAddress } = require('../../../src/services/treasury-ata');

describe('Stats Route', () => {
  let app;

  beforeEach(() => {
    const statsRouter = require('../../../src/routes/stats');
    app = express();
    app.use(express.json());
    app.use('/stats', statsRouter);
    jest.clearAllMocks();
  });

  // ==========================================================================
  // GET /stats
  // ==========================================================================

  describe('GET /stats', () => {
    it('should return burn and treasury stats', async () => {
      redis.getStats.mockResolvedValue({
        burnTotal: 5000000000, // 5000 $ASDF
        txCount: 1500,
      });
      redis.getTreasuryBalance.mockResolvedValue(500000000); // 0.5 SOL
      getAccount.mockResolvedValue({ amount: BigInt(1000000000) });

      const res = await request(app).get('/stats');

      expect(res.status).toBe(200);
      expect(res.body.totalBurned).toBe(5000000000);
      expect(res.body.totalTransactions).toBe(1500);
      expect(res.body.treasury).toHaveProperty('trackedBalance');
      expect(res.body.treasury).toHaveProperty('model', '80/20');
    });

    it('should handle missing treasury address', async () => {
      getTreasuryAddress.mockReturnValueOnce(null);
      redis.getStats.mockResolvedValue({ burnTotal: 0, txCount: 0 });
      redis.getTreasuryBalance.mockResolvedValue(0);

      const res = await request(app).get('/stats');

      expect(res.status).toBe(200);
      expect(res.body.treasury.onChain.sol).toBe(0);
    });

    it('should handle RPC error gracefully', async () => {
      redis.getStats.mockResolvedValue({ burnTotal: 100, txCount: 10 });
      redis.getTreasuryBalance.mockResolvedValue(0);
      rpc.getConnection.mockReturnValue({
        getBalance: jest.fn().mockRejectedValue(new Error('RPC down')),
      });

      const res = await request(app).get('/stats');

      expect(res.status).toBe(200);
      expect(res.body.treasury.onChain.sol).toBe(0);
    });

    it('should handle redis error', async () => {
      redis.getStats.mockRejectedValue(new Error('Redis connection lost'));

      const res = await request(app).get('/stats');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get stats');
    });
  });

  // ==========================================================================
  // GET /stats/wallet/:address
  // ==========================================================================

  describe('GET /stats/wallet/:address', () => {
    const validWallet = 'iuj2dDvPozkJARoqWpKLLGD9QgAkJS1K1d6RxPy2YCX';

    it('should return wallet burn stats', async () => {
      redis.getWalletBurnStats.mockResolvedValue({
        totalBurned: 1000000,
        txCount: 5,
        rank: 10,
      });
      redis.getStats.mockResolvedValue({ burnTotal: 100000000, txCount: 500 });
      redis.getBurnerCount.mockResolvedValue(100);

      const res = await request(app).get(`/stats/wallet/${validWallet}`);

      expect(res.status).toBe(200);
      expect(res.body.wallet).toBe(validWallet);
      expect(res.body.totalBurned).toBe(1000000);
      expect(res.body.rank).toBe(10);
      expect(res.body.totalBurners).toBe(100);
      expect(res.body.impact).toHaveProperty('message');
    });

    it('should return zero contribution for wallet with no burns', async () => {
      redis.getWalletBurnStats.mockResolvedValue({
        totalBurned: 0,
        txCount: 0,
        rank: null,
      });
      redis.getStats.mockResolvedValue({ burnTotal: 100000000, txCount: 500 });
      redis.getBurnerCount.mockResolvedValue(100);

      const res = await request(app).get(`/stats/wallet/${validWallet}`);

      expect(res.status).toBe(200);
      expect(res.body.totalBurned).toBe(0);
      expect(res.body.impact.message).toContain('Start transacting');
    });

    it('should return 400 for too short address', async () => {
      const res = await request(app).get('/stats/wallet/short');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid wallet address');
    });

    it('should return 400 for too long address', async () => {
      const longAddress = 'a'.repeat(50);
      const res = await request(app).get(`/stats/wallet/${longAddress}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid wallet address');
    });

    it('should return 500 on redis error', async () => {
      redis.getWalletBurnStats.mockRejectedValue(new Error('Redis timeout'));

      const res = await request(app).get(`/stats/wallet/${validWallet}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get wallet stats');
    });
  });

  // ==========================================================================
  // GET /stats/leaderboard
  // ==========================================================================

  describe('GET /stats/leaderboard', () => {
    it('should return burn leaderboard', async () => {
      redis.getBurnLeaderboard.mockResolvedValue([
        { wallet: 'Wallet1111111111111111111111111111111111111', totalBurned: 5000000 },
        { wallet: 'Wallet2222222222222222222222222222222222222', totalBurned: 3000000 },
      ]);
      redis.getStats.mockResolvedValue({ burnTotal: 10000000, txCount: 100 });
      redis.getBurnerCount.mockResolvedValue(50);

      const res = await request(app).get('/stats/leaderboard');

      expect(res.status).toBe(200);
      expect(res.body.leaderboard).toHaveLength(2);
      expect(res.body.leaderboard[0]).toHaveProperty('burnedFormatted');
      expect(res.body.leaderboard[0]).toHaveProperty('walletShort');
      expect(res.body.totalBurners).toBe(50);
    });

    it('should respect limit parameter', async () => {
      redis.getBurnLeaderboard.mockResolvedValue([]);
      redis.getStats.mockResolvedValue({ burnTotal: 0, txCount: 0 });
      redis.getBurnerCount.mockResolvedValue(0);

      const res = await request(app).get('/stats/leaderboard').query({ limit: 10 });

      expect(res.status).toBe(200);
      expect(redis.getBurnLeaderboard).toHaveBeenCalledWith(10);
    });

    it('should cap limit at 100', async () => {
      redis.getBurnLeaderboard.mockResolvedValue([]);
      redis.getStats.mockResolvedValue({ burnTotal: 0, txCount: 0 });
      redis.getBurnerCount.mockResolvedValue(0);

      const res = await request(app).get('/stats/leaderboard').query({ limit: 500 });

      expect(res.status).toBe(200);
      expect(redis.getBurnLeaderboard).toHaveBeenCalledWith(100);
    });

    it('should handle zero totalBurned', async () => {
      redis.getBurnLeaderboard.mockResolvedValue([
        { wallet: 'Wallet1111111111111111111111111111111111111', totalBurned: 0 },
      ]);
      redis.getStats.mockResolvedValue({ burnTotal: 0, txCount: 0 });
      redis.getBurnerCount.mockResolvedValue(1);

      const res = await request(app).get('/stats/leaderboard');

      expect(res.status).toBe(200);
      expect(res.body.leaderboard[0].contributionPercent).toBe('0.00');
    });

    it('should return 500 on redis error', async () => {
      redis.getBurnLeaderboard.mockRejectedValue(new Error('Connection refused'));

      const res = await request(app).get('/stats/leaderboard');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get leaderboard');
    });
  });

  // ==========================================================================
  // GET /stats/treasury
  // ==========================================================================

  describe('GET /stats/treasury', () => {
    it('should return treasury details', async () => {
      redis.getTreasuryBalance.mockResolvedValue(2000000000); // 2 SOL
      redis.getTreasuryHistory.mockResolvedValue([
        { type: 'deposit', amount: 1000000000, timestamp: Date.now() },
      ]);

      const res = await request(app).get('/stats/treasury');

      expect(res.status).toBe(200);
      expect(res.body.balance).toBe(2000000000);
      expect(res.body.balanceFormatted).toContain('SOL');
      expect(res.body.model).toHaveProperty('name', '80/20 Treasury Model');
      expect(res.body.recentEvents).toHaveLength(1);
    });

    it('should return 500 on redis error', async () => {
      redis.getTreasuryBalance.mockRejectedValue(new Error('Redis error'));

      const res = await request(app).get('/stats/treasury');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get treasury stats');
    });
  });

  // ==========================================================================
  // GET /stats/burns
  // ==========================================================================

  describe('GET /stats/burns', () => {
    it('should return burn proofs', async () => {
      const now = Date.now();
      redis.getBurnProofs.mockResolvedValue({
        proofs: [
          {
            signature: 'sig123',
            amountBurned: 1000000,
            solAmount: 100000000,
            treasuryAmount: 20000000,
            timestamp: now - 60000, // 1 min ago
          },
        ],
        totalCount: 1,
      });

      const res = await request(app).get('/stats/burns');

      expect(res.status).toBe(200);
      expect(res.body.burns).toHaveLength(1);
      expect(res.body.burns[0]).toHaveProperty('amountFormatted');
      expect(res.body.burns[0]).toHaveProperty('age');
      expect(res.body.totalBurns).toBe(1);
      expect(res.body.verification).toHaveProperty('message');
    });

    it('should return 500 on redis error', async () => {
      redis.getBurnProofs.mockRejectedValue(new Error('Redis error'));

      const res = await request(app).get('/stats/burns');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get burn proofs');
    });
  });

  // ==========================================================================
  // GET /stats/burns/:signature
  // ==========================================================================

  describe('GET /stats/burns/:signature', () => {
    const validSig =
      '5VERqnXfCd3XmKzYfRj8wFzWZMxPGqRRaEUFAk2VmqCJQXgFVHbNxU9BhvDZ5B4qKZsJPWJRb3DmKzYpSPPmKzYf';

    it('should return burn proof for valid signature', async () => {
      redis.getBurnProofBySignature.mockResolvedValue({
        signature: validSig,
        amountBurned: 1000000,
        solAmount: 100000000,
        treasuryAmount: 20000000,
        timestamp: Date.now(),
        swapSignature: 'swapSig123',
        explorerUrl: 'https://solscan.io/tx/sig123',
      });

      const res = await request(app).get(`/stats/burns/${validSig}`);

      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(true);
      expect(res.body.proof).toHaveProperty('amountFormatted');
      expect(res.body.verification).toHaveProperty('swapExplorerUrl');
    });

    it('should return 404 for non-existent signature', async () => {
      redis.getBurnProofBySignature.mockResolvedValue(null);

      const res = await request(app).get(`/stats/burns/${validSig}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Burn proof not found');
    });

    it('should return 400 for too short signature', async () => {
      const res = await request(app).get('/stats/burns/tooshort');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid signature format');
    });

    it('should return 400 for too long signature', async () => {
      const longSig = 'a'.repeat(100);
      const res = await request(app).get(`/stats/burns/${longSig}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid signature format');
    });

    it('should return 500 on redis error', async () => {
      redis.getBurnProofBySignature.mockRejectedValue(new Error('Redis error'));

      const res = await request(app).get(`/stats/burns/${validSig}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to verify burn');
    });
  });
});
