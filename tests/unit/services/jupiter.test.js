/**
 * Tests for Jupiter Service
 */

// Mock dependencies before requiring the module
jest.mock('../../../src/utils/config', () => ({
  WSOL_MINT: 'So11111111111111111111111111111111111111112',
  ASDF_MINT: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
  IS_DEV: false,
}));

jest.mock('../../../src/utils/circuit-breaker', () => ({
  jupiterBreaker: {
    execute: jest.fn((fn) => fn()),
  },
}));

jest.mock('../../../src/utils/fetch-timeout', () => ({
  fetchWithTimeout: jest.fn(),
  JUPITER_TIMEOUT: 15000,
}));

const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
const { jupiterBreaker } = require('../../../src/utils/circuit-breaker');
const config = require('../../../src/utils/config');

describe('Jupiter Service', () => {
  let jupiter;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset module cache to get fresh instance
    jest.resetModules();

    // Re-mock after reset
    jest.mock('../../../src/utils/config', () => ({
      WSOL_MINT: 'So11111111111111111111111111111111111111112',
      ASDF_MINT: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
      IS_DEV: false,
    }));

    jest.mock('../../../src/utils/circuit-breaker', () => ({
      jupiterBreaker: {
        execute: jest.fn((fn) => fn()),
      },
    }));

    jest.mock('../../../src/utils/fetch-timeout', () => ({
      fetchWithTimeout: jest.fn(),
      JUPITER_TIMEOUT: 15000,
    }));

    jupiter = require('../../../src/services/jupiter');
  });

  describe('getQuote()', () => {
    it('should fetch quote from Jupiter API', async () => {
      const mockQuote = {
        inAmount: '1000000',
        outAmount: '500000',
        priceImpactPct: '0.01',
      };

      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      const result = await jupiter.getQuote(
        'inputMint123',
        'outputMint456',
        1000000,
        50
      );

      expect(result).toEqual(mockQuote);
      expect(fetchWithTimeout).toHaveBeenCalledWith(
        expect.stringContaining('lite-api.jup.ag/swap/v1/quote'),
        {},
        15000
      );
    });

    it('should include correct query parameters', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await jupiter.getQuote('inputMint', 'outputMint', 5000000, 100);

      const calledUrl = fetchWithTimeout.mock.calls[0][0];
      expect(calledUrl).toContain('inputMint=inputMint');
      expect(calledUrl).toContain('outputMint=outputMint');
      expect(calledUrl).toContain('amount=5000000');
      expect(calledUrl).toContain('slippageBps=100');
    });

    it('should use default slippage of 50 bps', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await jupiter.getQuote('inputMint', 'outputMint', 1000000);

      const calledUrl = fetchWithTimeout.mock.calls[0][0];
      expect(calledUrl).toContain('slippageBps=50');
    });

    it('should throw error when response is not ok', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
      });

      await expect(jupiter.getQuote('input', 'output', 1000)).rejects.toThrow(
        'Jupiter quote failed: Bad Request'
      );
    });

    it('should execute through circuit breaker', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      const { jupiterBreaker } = require('../../../src/utils/circuit-breaker');

      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await jupiter.getQuote('input', 'output', 1000);

      expect(jupiterBreaker.execute).toHaveBeenCalled();
    });
  });

  describe('getSwapTransaction()', () => {
    const mockQuoteResponse = {
      inAmount: '1000000',
      outAmount: '500000',
    };

    it('should fetch swap transaction from Jupiter API', async () => {
      const mockSwap = {
        swapTransaction: 'base64EncodedTransaction',
      };

      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSwap),
      });

      const result = await jupiter.getSwapTransaction(
        mockQuoteResponse,
        'userPubkey123'
      );

      expect(result).toEqual(mockSwap);
    });

    it('should send POST request with correct body', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await jupiter.getSwapTransaction(mockQuoteResponse, 'userPubkey123');

      expect(fetchWithTimeout).toHaveBeenCalledWith(
        expect.stringContaining('/swap'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteResponse: mockQuoteResponse,
            userPublicKey: 'userPubkey123',
            wrapAndUnwrapSol: true,
          }),
        }),
        15000
      );
    });

    it('should throw error when response is not ok', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(
        jupiter.getSwapTransaction(mockQuoteResponse, 'user')
      ).rejects.toThrow('Jupiter swap failed: Internal Server Error');
    });

    it('should execute through circuit breaker', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      const { jupiterBreaker } = require('../../../src/utils/circuit-breaker');

      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await jupiter.getSwapTransaction(mockQuoteResponse, 'user');

      expect(jupiterBreaker.execute).toHaveBeenCalled();
    });
  });

  describe('getFeeInToken()', () => {
    const WSOL_MINT = 'So11111111111111111111111111111111111111112';

    it('should return SOL amount directly when paying in SOL', async () => {
      const result = await jupiter.getFeeInToken(WSOL_MINT, 5000);

      expect(result).toEqual({
        inputAmount: 5000,
        outputAmount: 5000,
        priceImpactPct: 0,
        symbol: 'SOL',
        decimals: 9,
      });
    });

    it('should get quote and calculate input amount for non-SOL tokens', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          inAmount: '2000000', // 2 USDC for 2x SOL
          outAmount: '10000000', // 0.01 SOL (2x of 0.005 SOL)
          priceImpactPct: '0.05',
        }),
      });

      const result = await jupiter.getFeeInToken(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        5000000 // 0.005 SOL in lamports
      );

      expect(result.inputAmount).toBeDefined();
      expect(result.outputAmount).toBe(5000000);
      expect(result.symbol).toBe('USDC');
      expect(result.decimals).toBe(6);
    });

    it('should use known token info for common tokens', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          inAmount: '1000000',
          outAmount: '10000000',
          priceImpactPct: '0.01',
        }),
      });

      // Test USDC
      const usdcResult = await jupiter.getFeeInToken(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        5000000
      );
      expect(usdcResult.symbol).toBe('USDC');
      expect(usdcResult.decimals).toBe(6);
    });

    it('should use UNKNOWN for unrecognized tokens', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          inAmount: '1000000',
          outAmount: '10000000',
          priceImpactPct: '0',
        }),
      });

      const result = await jupiter.getFeeInToken('UnknownMint123', 5000000);
      expect(result.symbol).toBe('UNKNOWN');
      expect(result.decimals).toBe(6);
    });

    it('should throw error when Jupiter returns zero output', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          inAmount: '1000000',
          outAmount: '0',
          priceImpactPct: '0',
        }),
      });

      await expect(
        jupiter.getFeeInToken('SomeToken123', 5000000)
      ).rejects.toThrow('Jupiter returned zero output amount');
    });

    it('should include route in response', async () => {
      const mockQuote = {
        inAmount: '1000000',
        outAmount: '10000000',
        priceImpactPct: '0.02',
        routePlan: [{ swapInfo: {} }],
      };

      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      const result = await jupiter.getFeeInToken('SomeToken', 5000000);
      expect(result.route).toBeDefined();
    });
  });

  describe('getFeeInToken() - devnet fallback', () => {
    beforeEach(() => {
      jest.resetModules();

      // Mock with IS_DEV = true for devnet tests
      jest.mock('../../../src/utils/config', () => ({
        WSOL_MINT: 'So11111111111111111111111111111111111111112',
        ASDF_MINT: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
        IS_DEV: true,
      }));

      jest.mock('../../../src/utils/circuit-breaker', () => ({
        jupiterBreaker: {
          execute: jest.fn((fn) => fn()),
        },
      }));

      jest.mock('../../../src/utils/fetch-timeout', () => ({
        fetchWithTimeout: jest.fn(),
        JUPITER_TIMEOUT: 15000,
      }));
    });

    it('should use fallback rates for USDC on devnet when Jupiter fails', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockRejectedValue(new Error('Network error'));

      const jupiterDev = require('../../../src/services/jupiter');

      const result = await jupiterDev.getFeeInToken(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        1000000000 // 1 SOL
      );

      expect(result.simulated).toBe(true);
      expect(result.symbol).toBe('USDC');
      expect(result.decimals).toBe(6);
      // 1 SOL * $200 = 200 USDC = 200000000 (with 6 decimals)
      expect(result.inputAmount).toBe(200000000);
    });

    it('should use fallback rates for USDT on devnet when Jupiter fails', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockRejectedValue(new Error('Network error'));

      const jupiterDev = require('../../../src/services/jupiter');

      const result = await jupiterDev.getFeeInToken(
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
        1000000000 // 1 SOL
      );

      expect(result.simulated).toBe(true);
      expect(result.symbol).toBe('USDT');
      expect(result.inputAmount).toBe(200000000);
    });

    it('should use 1:1 fallback for unknown tokens on devnet', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockRejectedValue(new Error('Network error'));

      const jupiterDev = require('../../../src/services/jupiter');

      const result = await jupiterDev.getFeeInToken(
        'UnknownToken123',
        1000000000 // 1 SOL
      );

      expect(result.simulated).toBe(true);
      expect(result.symbol).toBe('UNKNOWN');
      // 1:1 rate adjusted for decimals (6 decimals for unknown)
      expect(result.inputAmount).toBe(1000000);
    });
  });

  describe('getFeeInToken() - error handling', () => {
    it('should throw error on mainnet when Jupiter fails', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockRejectedValue(new Error('Jupiter unavailable'));

      await expect(
        jupiter.getFeeInToken('SomeToken', 5000000)
      ).rejects.toThrow('Jupiter unavailable');
    });

    it('should throw error when calculation overflows', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          inAmount: String(Number.MAX_SAFE_INTEGER),
          outAmount: '1',
          priceImpactPct: '0',
        }),
      });

      await expect(
        jupiter.getFeeInToken('SomeToken', Number.MAX_SAFE_INTEGER)
      ).rejects.toThrow();
    });

  });

  describe('swapToAsdf()', () => {
    it('should get quote for SOL to ASDF swap', async () => {
      const mockQuote = {
        inAmount: '1000000000',
        outAmount: '5000000000',
      };

      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      });

      const result = await jupiter.swapToAsdf(1000000000);

      expect(result).toEqual(mockQuote);
    });

    it('should use WSOL as input and ASDF as output', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await jupiter.swapToAsdf(1000000000);

      const calledUrl = fetchWithTimeout.mock.calls[0][0];
      expect(calledUrl).toContain('inputMint=So11111111111111111111111111111111111111112');
      expect(calledUrl).toContain('outputMint=9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');
    });

    it('should use 1% slippage (100 bps) for internal swaps', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await jupiter.swapToAsdf(1000000000);

      const calledUrl = fetchWithTimeout.mock.calls[0][0];
      expect(calledUrl).toContain('slippageBps=100');
    });

    it('should pass through the SOL amount', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await jupiter.swapToAsdf(5000000);

      const calledUrl = fetchWithTimeout.mock.calls[0][0];
      expect(calledUrl).toContain('amount=5000000');
    });
  });

  describe('TOKEN_INFO constants', () => {
    it('should recognize SOL token', async () => {
      const result = await jupiter.getFeeInToken(
        'So11111111111111111111111111111111111111112',
        1000000
      );
      expect(result.symbol).toBe('SOL');
      expect(result.decimals).toBe(9);
    });

    it('should recognize USDC token', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          inAmount: '1000000',
          outAmount: '10000000',
          priceImpactPct: '0',
        }),
      });

      const result = await jupiter.getFeeInToken(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        5000000
      );
      expect(result.symbol).toBe('USDC');
      expect(result.decimals).toBe(6);
    });

    it('should recognize mSOL token', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          inAmount: '1000000000',
          outAmount: '10000000',
          priceImpactPct: '0',
        }),
      });

      const result = await jupiter.getFeeInToken(
        'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
        5000000
      );
      expect(result.symbol).toBe('mSOL');
      expect(result.decimals).toBe(9);
    });

    it('should recognize jitoSOL token', async () => {
      const { fetchWithTimeout } = require('../../../src/utils/fetch-timeout');
      fetchWithTimeout.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          inAmount: '1000000000',
          outAmount: '10000000',
          priceImpactPct: '0',
        }),
      });

      const result = await jupiter.getFeeInToken(
        'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
        5000000
      );
      expect(result.symbol).toBe('jitoSOL');
      expect(result.decimals).toBe(9);
    });
  });
});
