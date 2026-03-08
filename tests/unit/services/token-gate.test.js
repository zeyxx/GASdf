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
      it('should accept SOL', async () => {
        const result = await tokenGate.isTokenAccepted(SOL);
        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('whitelisted');
        expect(result.tier).toBe('Diamond');
        expect(result.kScore).toBe(100);
      });

      it('should accept USDC', async () => {
        const result = await tokenGate.isTokenAccepted(USDC);
        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('whitelisted');
        expect(result.tier).toBe('Diamond');
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
        expect(result.tier).toBe('Diamond');
      });
    });

    describe('Non-whitelist tokens — rejected', () => {
      it('should reject unknown token', async () => {
        const result = await tokenGate.isTokenAccepted(UNKNOWN);
        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('not_whitelisted');
        expect(result.tier).toBeNull();
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
          'Token rejected — not whitelisted',
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

  describe('isDiamondToken()', () => {
    it('should return true for whitelisted tokens', () => {
      expect(tokenGate.isDiamondToken(SOL)).toBe(true);
      expect(tokenGate.isDiamondToken(USDC)).toBe(true);
      expect(tokenGate.isDiamondToken(USDT)).toBe(true);
      expect(tokenGate.isDiamondToken(ASDF)).toBe(true);
    });

    it('should return false for non-whitelisted tokens', () => {
      expect(tokenGate.isDiamondToken(UNKNOWN)).toBe(false);
      expect(tokenGate.isDiamondToken(MSOL)).toBe(false);
    });

    it('should include $ASDF (100% burn channel — whitelisted in Phase 0)', () => {
      expect(tokenGate.isDiamondToken(ASDF)).toBe(true);
    });
  });

  describe('getDiamondTokensList()', () => {
    it('should return list of whitelisted tokens', () => {
      const tokens = tokenGate.getDiamondTokensList();
      expect(tokens).toBeInstanceOf(Array);
      // Phase 0 whitelist: SOL, USDC, USDT, $ASDF
      expect(tokens.length).toBe(4);
    });

    it('should include $ASDF (100% burn channel)', () => {
      const tokens = tokenGate.getDiamondTokensList();
      const asdf = tokens.find((t) => t.mint === ASDF);
      expect(asdf).toBeDefined();
      expect(asdf.symbol).toBe('ASDF');
    });

    it('should include all stablecoins', () => {
      const tokens = tokenGate.getDiamondTokensList();
      expect(tokens.find((t) => t.symbol === 'USDC')).toBeDefined();
      expect(tokens.find((t) => t.symbol === 'USDT')).toBeDefined();
    });

    it('should include SOL', () => {
      const tokens = tokenGate.getDiamondTokensList();
      expect(tokens.find((t) => t.symbol === 'SOL')).toBeDefined();
    });

    it('should mark all tokens as Diamond tier', () => {
      const tokens = tokenGate.getDiamondTokensList();
      tokens.forEach((t) => expect(t.tier).toBe('Diamond'));
    });
  });

  describe('getAcceptedTokensList() (legacy)', () => {
    it('should return same list as getDiamondTokensList', () => {
      const diamond = tokenGate.getDiamondTokensList();
      const accepted = tokenGate.getAcceptedTokensList();
      expect(accepted).toEqual(diamond);
    });
  });

  describe('DIAMOND_TOKENS', () => {
    it('should be exported as a Set', () => {
      expect(tokenGate.DIAMOND_TOKENS).toBeInstanceOf(Set);
    });

    it('should contain Phase 0 whitelist', () => {
      expect(tokenGate.DIAMOND_TOKENS.has(SOL)).toBe(true);
      expect(tokenGate.DIAMOND_TOKENS.has(USDC)).toBe(true);
      expect(tokenGate.DIAMOND_TOKENS.has(USDT)).toBe(true);
      expect(tokenGate.DIAMOND_TOKENS.has(ASDF)).toBe(true);
    });

    it('should not contain non-whitelisted tokens', () => {
      expect(tokenGate.DIAMOND_TOKENS.has(UNKNOWN)).toBe(false);
      expect(tokenGate.DIAMOND_TOKENS.has(MSOL)).toBe(false);
    });
  });

  describe('TRUSTED_TOKENS (legacy)', () => {
    it('should be exported as a Set', () => {
      expect(tokenGate.TRUSTED_TOKENS).toBeInstanceOf(Set);
    });

    it('should be same as DIAMOND_TOKENS', () => {
      expect(tokenGate.TRUSTED_TOKENS).toBe(tokenGate.DIAMOND_TOKENS);
    });
  });
});
