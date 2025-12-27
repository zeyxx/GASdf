/**
 * Integration Tests for Stats & Burns Routes
 */

const request = require('supertest');

// Mock pump-swap-sdk first (before any imports)
jest.mock('@pump-fun/pump-swap-sdk', () => ({
  PumpAmmSdk: jest.fn().mockImplementation(() => ({
    swap: jest.fn().mockResolvedValue({ signature: 'mock_sig' }),
  })),
}));

// Mock Solana dependencies before requiring app
jest.mock('@solana/web3.js', () => {
  const mockPublicKey = jest.fn().mockImplementation((key) => ({
    toBase58: () => key || 'MockPubkey',
    toString: () => key || 'MockPubkey',
    toBuffer: () => Buffer.from(key || ''),
    equals: () => false,
  }));
  mockPublicKey.findProgramAddressSync = jest.fn().mockReturnValue([{ toBase58: () => 'PDA' }, 255]);

  const mockSystemProgram = {
    programId: { toBase58: () => '11111111111111111111111111111111' },
    transfer: jest.fn(),
  };

  return {
    Connection: jest.fn().mockImplementation(() => ({
      getSlot: jest.fn().mockResolvedValue(12345678),
      getLatestBlockhash: jest.fn().mockResolvedValue({
        blockhash: 'TestBlockhash',
        lastValidBlockHeight: 100000,
      }),
      getBalance: jest.fn().mockResolvedValue(1000000000),
    })),
    PublicKey: mockPublicKey,
    Keypair: {
      fromSecretKey: jest.fn().mockReturnValue({
        publicKey: { toBase58: () => 'TestPubkey123' },
        secretKey: new Uint8Array(64),
      }),
    },
    Transaction: jest.fn().mockImplementation(() => ({
      add: jest.fn(),
      sign: jest.fn(),
      serialize: jest.fn().mockReturnValue(Buffer.from([])),
    })),
    VersionedTransaction: jest.fn(),
    SystemProgram: mockSystemProgram,
    LAMPORTS_PER_SOL: 1000000000,
  };
});

jest.mock('@solana/spl-token', () => ({
  getAssociatedTokenAddress: jest.fn().mockResolvedValue('TokenAccount123'),
  createTransferInstruction: jest.fn(),
  getAccount: jest.fn().mockResolvedValue({ amount: BigInt(0) }),
  createBurnInstruction: jest.fn(),
  TOKEN_PROGRAM_ID: { toBase58: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
  TOKEN_2022_PROGRAM_ID: { toBase58: () => 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
}));

describe('Stats & Burns API Routes', () => {
  let app;

  beforeAll(async () => {
    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL = '';

    // Clear module cache and load app
    jest.resetModules();
    app = require('../../../src/index');
  });

  describe('GET /v1/stats/burns', () => {
    test('should return 200 with burns array', async () => {
      const response = await request(app)
        .get('/v1/stats/burns')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('burns');
      expect(Array.isArray(response.body.burns)).toBe(true);
    });

    test('should include totalBurns count', async () => {
      const response = await request(app)
        .get('/v1/stats/burns')
        .expect(200);

      expect(response.body).toHaveProperty('totalBurns');
      expect(typeof response.body.totalBurns).toBe('number');
    });

    test('should include verification message', async () => {
      const response = await request(app)
        .get('/v1/stats/burns')
        .expect(200);

      expect(response.body).toHaveProperty('verification');
      expect(response.body.verification).toHaveProperty('message');
      expect(response.body.verification).toHaveProperty('howToVerify');
    });

    test('should respect limit parameter', async () => {
      const response = await request(app)
        .get('/v1/stats/burns?limit=5')
        .expect(200);

      expect(response.body.burns.length).toBeLessThanOrEqual(5);
    });

    test('should cap limit at 100', async () => {
      const response = await request(app)
        .get('/v1/stats/burns?limit=500')
        .expect(200);

      // Should not exceed max limit
      expect(response.body.burns.length).toBeLessThanOrEqual(100);
    });
  });

  describe('GET /v1/stats/burns/:signature', () => {
    test('should return 404 for non-existent signature', async () => {
      // Use a valid-looking signature that doesn't exist (87 chars base58)
      const fakeSignature = '5XzL8mK9vN2pQ7wR4tU6yH3jF8gC1bD9aE0iO5kM2nP3qS4rT7uV6wX8yZ1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT';
      const response = await request(app)
        .get(`/v1/stats/burns/${fakeSignature}`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });

    test('should return 400 for invalid signature format', async () => {
      const response = await request(app)
        .get('/v1/stats/burns/short')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid');
    });
  });

  describe('GET /status', () => {
    test('should return 200 with status', async () => {
      const response = await request(app)
        .get('/status')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('status');
    });

    test('should include components health', async () => {
      const response = await request(app)
        .get('/status')
        .expect(200);

      expect(response.body).toHaveProperty('components');
      expect(response.body.components).toHaveProperty('api');
      expect(response.body.components).toHaveProperty('rpc');
      expect(response.body.components).toHaveProperty('database');
    });

    test('should include updated_at timestamp', async () => {
      const response = await request(app)
        .get('/status')
        .expect(200);

      expect(response.body).toHaveProperty('updated_at');
      expect(new Date(response.body.updated_at)).toBeInstanceOf(Date);
    });

    test('should include response_time_ms', async () => {
      const response = await request(app)
        .get('/status')
        .expect(200);

      expect(response.body).toHaveProperty('response_time_ms');
      expect(typeof response.body.response_time_ms).toBe('number');
    });

    test('should include Upptime-compatible page info', async () => {
      const response = await request(app)
        .get('/status')
        .expect(200);

      expect(response.body).toHaveProperty('page');
      expect(response.body.page).toHaveProperty('name');
      expect(response.body.page).toHaveProperty('url');
    });

    test('should include simple indicators', async () => {
      const response = await request(app)
        .get('/status')
        .expect(200);

      expect(response.body).toHaveProperty('indicators');
      expect(response.body.indicators).toHaveProperty('operational');
      expect(response.body.indicators).toHaveProperty('degraded');
      expect(response.body.indicators).toHaveProperty('outage');
    });
  });

  describe('Deprecation headers on legacy routes', () => {
    test('GET /health should include Deprecation header', async () => {
      const response = await request(app)
        .get('/health');

      // Health might return 503 in test mode (no Redis) but should still have headers
      expect([200, 503]).toContain(response.status);
      expect(response.headers.deprecation).toBe('true');
    });

    test('GET /stats should include Sunset header', async () => {
      const response = await request(app)
        .get('/stats')
        .expect(200);

      expect(response.headers).toHaveProperty('sunset');
    });

    test('GET /stats should include Link header to v1', async () => {
      const response = await request(app)
        .get('/stats')
        .expect(200);

      expect(response.headers).toHaveProperty('link');
      expect(response.headers.link).toContain('/v1');
      expect(response.headers.link).toContain('successor-version');
    });

    test('GET /v1/health should NOT include Deprecation header', async () => {
      const response = await request(app)
        .get('/v1/health')
        .expect(200);

      expect(response.headers.deprecation).toBeUndefined();
    });
  });
});
