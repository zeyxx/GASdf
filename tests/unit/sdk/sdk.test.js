/**
 * SDK Tests
 * Tests for @gasdf/sdk
 */

// Mock fetch globally
global.fetch = jest.fn();

const { GASdf, GASdfError } = require('../../../sdk');

describe('GASdf SDK', () => {
  let gasdf;

  beforeEach(() => {
    jest.clearAllMocks();
    gasdf = new GASdf({ baseUrl: 'http://test-api.local', timeout: 5000 });
  });

  describe('constructor', () => {
    test('should use default baseUrl when not provided', () => {
      const sdk = new GASdf();
      expect(sdk.baseUrl).toBe('https://api.gasdf.io');
    });

    test('should use custom baseUrl when provided', () => {
      const sdk = new GASdf({ baseUrl: 'http://custom.api' });
      expect(sdk.baseUrl).toBe('http://custom.api');
    });

    test('should use default timeout when not provided', () => {
      const sdk = new GASdf();
      expect(sdk.timeout).toBe(30000);
    });

    test('should use custom timeout when provided', () => {
      const sdk = new GASdf({ timeout: 10000 });
      expect(sdk.timeout).toBe(10000);
    });
  });

  describe('quote()', () => {
    const mockQuote = {
      quoteId: 'quote_123',
      feePayer: 'FeePayer111111111111111111111111111111111111',
      blockhash: 'TestBlockhash123',
      feeAmountLamports: 5000,
    };

    test('should call /v1/quote endpoint', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      await gasdf.quote('TokenMint123', 'UserPubkey123');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://test-api.local/v1/quote',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    test('should include paymentToken and userPubkey in body', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      await gasdf.quote('TokenMint123', 'UserPubkey123');

      const call = global.fetch.mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.paymentToken).toBe('TokenMint123');
      expect(body.userPubkey).toBe('UserPubkey123');
    });

    test('should return quote on success', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      const result = await gasdf.quote('TokenMint123', 'UserPubkey123');

      expect(result).toEqual(mockQuote);
    });

    test('should throw GASdfError on failure', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Invalid token', code: 'INVALID_TOKEN' }),
      });

      await expect(gasdf.quote('Invalid', 'User')).rejects.toThrow(GASdfError);
    });

    test('should include error code in GASdfError', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Invalid token', code: 'INVALID_TOKEN' }),
      });

      try {
        await gasdf.quote('Invalid', 'User');
      } catch (error) {
        expect(error.code).toBe('INVALID_TOKEN');
        expect(error.status).toBe(400);
      }
    });
  });

  describe('submit()', () => {
    const mockResult = {
      success: true,
      signature: 'TxSignature123',
      explorerUrl: 'https://solscan.io/tx/TxSignature123',
    };

    test('should call /v1/submit endpoint', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      await gasdf.submit('quote_123', 'base64EncodedTx');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://test-api.local/v1/submit',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    test('should include quoteId and signedTransaction in body', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      await gasdf.submit('quote_123', 'base64EncodedTx');

      const call = global.fetch.mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.quoteId).toBe('quote_123');
      expect(body.signedTransaction).toBe('base64EncodedTx');
    });

    test('should return result on success', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const result = await gasdf.submit('quote_123', 'base64EncodedTx');

      expect(result.success).toBe(true);
      expect(result.signature).toBe('TxSignature123');
    });
  });

  describe('stats()', () => {
    const mockStats = {
      totalBurned: 1000000000,
      totalTransactions: 100,
      burnedFormatted: '1,000.00 $ASDF',
    };

    test('should call /v1/stats endpoint', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStats),
      });

      await gasdf.stats();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://test-api.local/v1/stats',
        expect.any(Object)
      );
    });

    test('should return stats on success', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStats),
      });

      const result = await gasdf.stats();

      expect(result.totalBurned).toBe(1000000000);
    });
  });

  describe('burnProofs()', () => {
    const mockProofs = {
      burns: [
        { burnSignature: 'sig1', amountBurned: 1000000 },
        { burnSignature: 'sig2', amountBurned: 2000000 },
      ],
      totalBurns: 2,
    };

    test('should call /v1/stats/burns endpoint with limit', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProofs),
      });

      await gasdf.burnProofs(25);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://test-api.local/v1/stats/burns?limit=25',
        expect.any(Object)
      );
    });

    test('should use default limit of 50', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProofs),
      });

      await gasdf.burnProofs();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://test-api.local/v1/stats/burns?limit=50',
        expect.any(Object)
      );
    });

    test('should return burn proofs', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProofs),
      });

      const result = await gasdf.burnProofs();

      expect(result.burns).toHaveLength(2);
      expect(result.totalBurns).toBe(2);
    });
  });

  describe('verifyBurn()', () => {
    const mockVerification = {
      verified: true,
      proof: {
        burnSignature: 'sig123',
        amountBurned: 1500000000,
      },
    };

    test('should call /v1/stats/burns/:signature endpoint', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockVerification),
      });

      await gasdf.verifyBurn('sig123');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://test-api.local/v1/stats/burns/sig123',
        expect.any(Object)
      );
    });

    test('should return verification result', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockVerification),
      });

      const result = await gasdf.verifyBurn('sig123');

      expect(result.verified).toBe(true);
    });

    test('should throw on not found', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Burn proof not found' }),
      });

      await expect(gasdf.verifyBurn('invalid')).rejects.toThrow(GASdfError);
    });
  });

  describe('health()', () => {
    test('should call /v1/health endpoint', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      await gasdf.health();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://test-api.local/v1/health',
        expect.any(Object)
      );
    });
  });

  describe('GASdfError', () => {
    test('should have correct properties', () => {
      const error = new GASdfError('Test error', 'TEST_CODE', 500);

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.status).toBe(500);
      expect(error.name).toBe('GASdfError');
    });

    test('should be instanceof Error', () => {
      const error = new GASdfError('Test', 'CODE', 400);

      expect(error instanceof Error).toBe(true);
      expect(error instanceof GASdfError).toBe(true);
    });
  });
});
