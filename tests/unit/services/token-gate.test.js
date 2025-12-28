/**
 * Tests for Token Gate Service
 */

jest.mock('../../../src/utils/config', () => ({
  ASDF_MINT: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/services/holdex', () => ({
  isVerifiedCommunity: jest.fn(),
}));

describe('Token Gate Service', () => {
  let tokenGate;
  let holdex;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    holdex = require('../../../src/services/holdex');
    logger = require('../../../src/utils/logger');
    tokenGate = require('../../../src/services/token-gate');
  });

  describe('isTokenAccepted()', () => {
    describe('TRUSTED_TOKENS', () => {
      it('should accept SOL', async () => {
        const result = await tokenGate.isTokenAccepted('So11111111111111111111111111111111111111112');

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('trusted');
        expect(holdex.isVerifiedCommunity).not.toHaveBeenCalled();
      });

      it('should accept USDC', async () => {
        const result = await tokenGate.isTokenAccepted('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('trusted');
      });

      it('should accept USDT', async () => {
        const result = await tokenGate.isTokenAccepted('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('trusted');
      });

      it('should accept mSOL', async () => {
        const result = await tokenGate.isTokenAccepted('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('trusted');
      });

      it('should accept jitoSOL', async () => {
        const result = await tokenGate.isTokenAccepted('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('trusted');
      });

      it('should accept $ASDF', async () => {
        const result = await tokenGate.isTokenAccepted('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('trusted');
      });
    });

    describe('HolDex verification with K-score', () => {
      const unknownMint = 'UnknownMint1111111111111111111111111111111';

      it('should accept HolDex verified tokens with sufficient K-score', async () => {
        holdex.isVerifiedCommunity.mockResolvedValue({
          verified: true,
          kScore: 70,
          cached: false,
        });

        const result = await tokenGate.isTokenAccepted(unknownMint);

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('holdex_verified');
        expect(result.kScore).toBe(70);
        expect(holdex.isVerifiedCommunity).toHaveBeenCalledWith(unknownMint);
      });

      it('should reject HolDex verified tokens with low K-score', async () => {
        holdex.isVerifiedCommunity.mockResolvedValue({
          verified: true,
          kScore: 30, // Below MIN_KSCORE (50)
          cached: false,
        });

        const result = await tokenGate.isTokenAccepted(unknownMint);

        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('low_kscore');
        expect(result.kScore).toBe(30);
      });

      it('should accept tokens with K-score exactly at minimum', async () => {
        holdex.isVerifiedCommunity.mockResolvedValue({
          verified: true,
          kScore: 50, // Exactly MIN_KSCORE
          cached: false,
        });

        const result = await tokenGate.isTokenAccepted(unknownMint);

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('holdex_verified');
      });

      it('should reject unverified tokens regardless of K-score', async () => {
        holdex.isVerifiedCommunity.mockResolvedValue({
          verified: false,
          kScore: 80, // High K-score but not verified
          cached: false,
        });

        const result = await tokenGate.isTokenAccepted(unknownMint);

        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('not_verified');
      });

      it('should reject tokens when HolDex returns error', async () => {
        holdex.isVerifiedCommunity.mockResolvedValue({
          verified: false,
          kScore: 0,
          cached: false,
          error: 'API error',
        });

        const result = await tokenGate.isTokenAccepted(unknownMint);

        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('verification_failed');
      });

      it('should log rejection for low K-score tokens', async () => {
        holdex.isVerifiedCommunity.mockResolvedValue({
          verified: true,
          kScore: 40,
          cached: false,
        });

        await tokenGate.isTokenAccepted(unknownMint);

        expect(logger.info).toHaveBeenCalledWith(
          'TOKEN_GATE',
          'Token rejected: K-score too low',
          expect.objectContaining({
            kScore: 40,
            minRequired: 50,
          })
        );
      });

      it('should log acceptance for HolDex verified tokens with K-score', async () => {
        holdex.isVerifiedCommunity.mockResolvedValue({
          verified: true,
          kScore: 75,
          cached: false,
        });

        await tokenGate.isTokenAccepted(unknownMint);

        expect(logger.debug).toHaveBeenCalledWith(
          'TOKEN_GATE',
          'Token accepted via HolDex',
          expect.objectContaining({ kScore: 75 })
        );
      });
    });
  });

  describe('isTrustedToken()', () => {
    it('should return true for trusted tokens', () => {
      expect(tokenGate.isTrustedToken('So11111111111111111111111111111111111111112')).toBe(true);
      expect(tokenGate.isTrustedToken('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    });

    it('should return false for non-trusted tokens', () => {
      expect(tokenGate.isTrustedToken('RandomMint111111111111111111111111111111111')).toBe(false);
    });

    it('should include $ASDF in trusted tokens', () => {
      expect(tokenGate.isTrustedToken('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump')).toBe(true);
    });
  });

  describe('getAcceptedTokensList()', () => {
    it('should return list of trusted tokens', () => {
      const tokens = tokenGate.getAcceptedTokensList();

      expect(tokens).toBeInstanceOf(Array);
      expect(tokens.length).toBeGreaterThanOrEqual(5);

      // Check structure
      const sol = tokens.find(t => t.symbol === 'SOL');
      expect(sol).toBeDefined();
      expect(sol.mint).toBe('So11111111111111111111111111111111111111112');
      expect(sol.decimals).toBe(9);
      expect(sol.trusted).toBe(true);
    });

    it('should include $ASDF when configured', () => {
      const tokens = tokenGate.getAcceptedTokensList();

      const asdf = tokens.find(t => t.symbol === 'ASDF');
      expect(asdf).toBeDefined();
      expect(asdf.mint).toBe('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');
    });

    it('should include all major stablecoins', () => {
      const tokens = tokenGate.getAcceptedTokensList();

      expect(tokens.find(t => t.symbol === 'USDC')).toBeDefined();
      expect(tokens.find(t => t.symbol === 'USDT')).toBeDefined();
    });

    it('should include liquid staking tokens', () => {
      const tokens = tokenGate.getAcceptedTokensList();

      expect(tokens.find(t => t.symbol === 'mSOL')).toBeDefined();
      expect(tokens.find(t => t.symbol === 'jitoSOL')).toBeDefined();
    });
  });

  describe('TRUSTED_TOKENS', () => {
    it('should be exported as a Set', () => {
      expect(tokenGate.TRUSTED_TOKENS).toBeInstanceOf(Set);
    });

    it('should contain the core trusted tokens', () => {
      expect(tokenGate.TRUSTED_TOKENS.has('So11111111111111111111111111111111111111112')).toBe(true);
      expect(tokenGate.TRUSTED_TOKENS.has('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    });
  });

  describe('MIN_KSCORE', () => {
    it('should be exported with default value of 50', () => {
      expect(tokenGate.MIN_KSCORE).toBe(50);
    });

    it('should be a number between 0 and 100', () => {
      expect(typeof tokenGate.MIN_KSCORE).toBe('number');
      expect(tokenGate.MIN_KSCORE).toBeGreaterThanOrEqual(0);
      expect(tokenGate.MIN_KSCORE).toBeLessThanOrEqual(100);
    });
  });
});
