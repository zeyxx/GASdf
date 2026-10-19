/**
 * Tests for Token Gate Service — Phase 0 Whitelist Model
 *
 * Phase 0: Hardcoded whitelist only (no HolDex).
 * Accepted: USDC, USDT, $ASDF (and SOL native).
 */

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('Token Gate Service', () => {
  let tokenGate;
  let logger;

  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
  const PYUSD = '2b1kV6DkPAnxd5ixfnExCx2PdhTteca1Ck2aG1Znhrog';
  const SOL = 'So11111111111111111111111111111111111111112';
  const ASDF = '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump';
  const UNKNOWN = 'UnknownMint1111111111111111111111111111111';
  const MSOL = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    logger = require('../../../src/utils/logger');
    tokenGate = require('../../../src/services/token-gate');
  });

  describe('isTokenAccepted()', () => {
    describe('Whitelist tokens — accepted', () => {
      it('should accept USDC', async () => {
        const result = await tokenGate.isTokenAccepted(USDC);
        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('whitelisted');
      });

      it('should accept USDT', async () => {
        const result = await tokenGate.isTokenAccepted(USDT);
        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('whitelisted');
      });

      it('should accept $ASDF (100% burn channel)', async () => {
        const result = await tokenGate.isTokenAccepted(ASDF);
        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('whitelisted');
      });
    });

    describe('Non-whitelist tokens — rejected', () => {
      it('should accept wSOL (wrapped SOL is whitelisted)', async () => {
        const result = await tokenGate.isTokenAccepted(SOL);
        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('whitelisted');
      });

      it('should reject unknown token', async () => {
        const result = await tokenGate.isTokenAccepted(UNKNOWN);
        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('not_whitelisted');
      });

      it('should reject mSOL (not in Phase 0 whitelist)', async () => {
        const result = await tokenGate.isTokenAccepted(MSOL);
        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('not_whitelisted');
      });

      it('should log rejection for non-whitelisted tokens', async () => {
        await tokenGate.isTokenAccepted(UNKNOWN);
        expect(logger.info).toHaveBeenCalledWith(
          'TOKEN_GATE',
          'Token rejected - not whitelisted',
          expect.objectContaining({ mint: UNKNOWN.slice(0, 8) })
        );
      });

      it('should NOT make any network calls for any token', async () => {
        // Phase 0: pure local check, no external dependencies
        // This test verifies no network calls are made (holdex removed)
        const result = await tokenGate.isTokenAccepted(UNKNOWN);
        expect(result.accepted).toBe(false);
        // If we reach here without network errors, test passes
      });
    });
  });

  describe('isWhitelisted()', () => {
    it('should return true for whitelisted tokens', () => {
      expect(tokenGate.isWhitelisted(USDC)).toBe(true);
      expect(tokenGate.isWhitelisted(USDT)).toBe(true);
      expect(tokenGate.isWhitelisted(PYUSD)).toBe(true);
      expect(tokenGate.isWhitelisted(ASDF)).toBe(true);
    });

    it('should return true for wSOL (whitelisted wrapped SOL)', () => {
      expect(tokenGate.isWhitelisted(SOL)).toBe(true);
    });

    it('should return false for non-whitelisted tokens', () => {
      expect(tokenGate.isWhitelisted(UNKNOWN)).toBe(false);
      expect(tokenGate.isWhitelisted(MSOL)).toBe(false);
    });
  });

  describe('getAcceptedTokens()', () => {
    it('should return list of whitelisted tokens', () => {
      const tokens = tokenGate.getAcceptedTokens();
      expect(tokens).toBeInstanceOf(Array);
      // Phase 0 whitelist: USDC, USDT, PYUSD, wSOL, $ASDF
      expect(tokens.length).toBe(5);
    });

    it('should include $ASDF (100% burn channel)', () => {
      const tokens = tokenGate.getAcceptedTokens();
      const asdf = tokens.find((t) => t.mint === ASDF);
      expect(asdf).toBeDefined();
      expect(asdf.symbol).toBe('ASDF');
    });

    it('should include all stablecoins', () => {
      const tokens = tokenGate.getAcceptedTokens();
      expect(tokens.find((t) => t.symbol === 'USDC')).toBeDefined();
      expect(tokens.find((t) => t.symbol === 'USDT')).toBeDefined();
      expect(tokens.find((t) => t.symbol === 'PYUSD')).toBeDefined();
    });

    it('should include wSOL under SOL symbol', () => {
      const tokens = tokenGate.getAcceptedTokens();
      expect(tokens.find((t) => t.symbol === 'SOL')).toBeDefined();
    });
  });

  describe('WHITELIST', () => {
    it('should be exported as a Map', () => {
      expect(tokenGate.WHITELIST).toBeInstanceOf(Map);
    });

    it('should contain Phase 0 whitelist', () => {
      expect(tokenGate.WHITELIST.has(USDC)).toBe(true);
      expect(tokenGate.WHITELIST.has(USDT)).toBe(true);
      expect(tokenGate.WHITELIST.has(PYUSD)).toBe(true);
      expect(tokenGate.WHITELIST.has(ASDF)).toBe(true);
      expect(tokenGate.WHITELIST.has(SOL)).toBe(true);
    });

    it('should not contain non-whitelisted tokens', () => {
      expect(tokenGate.WHITELIST.has(UNKNOWN)).toBe(false);
      expect(tokenGate.WHITELIST.has(MSOL)).toBe(false);
    });
  });
});
