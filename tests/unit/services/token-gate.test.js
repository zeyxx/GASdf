/**
 * Tests for Token Gate Service
 *
 * Tier-based token acceptance (Metal Ranks):
 * - Diamond (90+): Hardcoded tokens (SOL, USDC, etc.) → Always accepted locally
 * - Platinum (80+) / Gold (70+): HolDex verified → Accepted
 * - Silver/Bronze/Copper/Iron/Rust (<70): HolDex rejected → Rejected
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
  isTokenAccepted: jest.fn(),
  getKRank: jest.fn((score) => {
    if (score >= 90) return { tier: 'Diamond', icon: '💎', level: 8 };
    if (score >= 80) return { tier: 'Platinum', icon: '💠', level: 7 };
    if (score >= 70) return { tier: 'Gold', icon: '🥇', level: 6 };
    if (score >= 60) return { tier: 'Silver', icon: '🥈', level: 5 };
    if (score >= 50) return { tier: 'Bronze', icon: '🥉', level: 4 };
    if (score >= 40) return { tier: 'Copper', icon: '🟤', level: 3 };
    if (score >= 20) return { tier: 'Iron', icon: '⚫', level: 2 };
    return { tier: 'Rust', icon: '🔩', level: 1 };
  }),
  getCreditRating: jest.fn((score) => {
    if (score >= 90) return { grade: 'A1', label: 'Prime Quality', risk: 'minimal', outlook: 'stable', trajectory: '→ Stable' };
    if (score >= 80) return { grade: 'A2', label: 'Excellent', risk: 'very_low', outlook: 'stable', trajectory: '→ Stable' };
    if (score >= 70) return { grade: 'A3', label: 'Good', risk: 'low', outlook: 'stable', trajectory: '→ Stable' };
    if (score >= 60) return { grade: 'B1', label: 'Fair', risk: 'moderate', outlook: 'stable', trajectory: '→ Stable' };
    if (score >= 50) return { grade: 'B2', label: 'Speculative', risk: 'high', outlook: 'stable', trajectory: '→ Stable' };
    if (score >= 40) return { grade: 'B3', label: 'Very Speculative', risk: 'very_high', outlook: 'stable', trajectory: '→ Stable' };
    if (score >= 20) return { grade: 'C', label: 'Substantial Risk', risk: 'severe', outlook: 'stable', trajectory: '→ Stable' };
    return { grade: 'D', label: 'Default', risk: 'extreme', outlook: 'stable', trajectory: '→ Stable' };
  }),
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
    describe('DIAMOND_TOKENS (local, no network)', () => {
      it('should accept SOL with Diamond tier and credit rating', async () => {
        const result = await tokenGate.isTokenAccepted('So11111111111111111111111111111111111111112');

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('diamond');
        expect(result.tier).toBe('Diamond');
        expect(result.kScore).toBe(100);
        expect(result.kRank.level).toBe(8);
        expect(result.creditRating.grade).toBe('A1');
        expect(holdex.isTokenAccepted).not.toHaveBeenCalled();
      });

      it('should accept USDC with Diamond tier', async () => {
        const result = await tokenGate.isTokenAccepted('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('diamond');
        expect(result.tier).toBe('Diamond');
      });

      it('should accept USDT with Diamond tier', async () => {
        const result = await tokenGate.isTokenAccepted('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('diamond');
        expect(result.tier).toBe('Diamond');
      });

      it('should accept mSOL with Diamond tier', async () => {
        const result = await tokenGate.isTokenAccepted('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('diamond');
        expect(result.tier).toBe('Diamond');
      });

      it('should accept jitoSOL with Diamond tier', async () => {
        const result = await tokenGate.isTokenAccepted('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('diamond');
        expect(result.tier).toBe('Diamond');
      });

      it('should accept $ASDF with Diamond tier', async () => {
        const result = await tokenGate.isTokenAccepted('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('diamond');
        expect(result.tier).toBe('Diamond');
      });
    });

    describe('HolDex tier-based acceptance', () => {
      const unknownMint = 'UnknownMint1111111111111111111111111111111';

      it('should accept Platinum tier tokens with credit rating', async () => {
        holdex.isTokenAccepted.mockResolvedValue({
          accepted: true,
          tier: 'Platinum',
          kScore: 85,
          kRank: { tier: 'Platinum', icon: '💠', level: 7 },
          creditRating: { grade: 'A2', label: 'Excellent', risk: 'very_low', outlook: 'stable' },
          cached: false,
        });

        const result = await tokenGate.isTokenAccepted(unknownMint);

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('tier_accepted');
        expect(result.tier).toBe('Platinum');
        expect(result.kScore).toBe(85);
        expect(result.creditRating.grade).toBe('A2');
        expect(holdex.isTokenAccepted).toHaveBeenCalledWith(unknownMint);
      });

      it('should accept Gold tier tokens with credit rating', async () => {
        holdex.isTokenAccepted.mockResolvedValue({
          accepted: true,
          tier: 'Gold',
          kScore: 75,
          kRank: { tier: 'Gold', icon: '🥇', level: 6 },
          creditRating: { grade: 'A3', label: 'Good', risk: 'low', outlook: 'stable' },
          cached: false,
        });

        const result = await tokenGate.isTokenAccepted(unknownMint);

        expect(result.accepted).toBe(true);
        expect(result.reason).toBe('tier_accepted');
        expect(result.tier).toBe('Gold');
        expect(result.kScore).toBe(75);
        expect(result.creditRating.grade).toBe('A3');
      });

      it('should reject Silver tier tokens', async () => {
        holdex.isTokenAccepted.mockResolvedValue({
          accepted: false,
          tier: 'Silver',
          kScore: 65,
          cached: false,
        });

        const result = await tokenGate.isTokenAccepted(unknownMint);

        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('tier_rejected');
        expect(result.tier).toBe('Silver');
        expect(result.kScore).toBe(65);
      });

      it('should reject Bronze tier tokens', async () => {
        holdex.isTokenAccepted.mockResolvedValue({
          accepted: false,
          tier: 'Bronze',
          kScore: 55,
          cached: false,
        });

        const result = await tokenGate.isTokenAccepted(unknownMint);

        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('tier_rejected');
        expect(result.tier).toBe('Bronze');
      });

      it('should reject Rust tier tokens (lowest tier)', async () => {
        holdex.isTokenAccepted.mockResolvedValue({
          accepted: false,
          tier: 'Rust',
          kScore: 5,
          cached: false,
        });

        const result = await tokenGate.isTokenAccepted(unknownMint);

        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('tier_rejected');
        expect(result.tier).toBe('Rust');
        expect(result.kScore).toBe(5);
      });

      it('should reject tokens when HolDex returns error', async () => {
        holdex.isTokenAccepted.mockResolvedValue({
          accepted: false,
          tier: 'Bronze',
          kScore: 0,
          cached: false,
          error: 'API error',
        });

        const result = await tokenGate.isTokenAccepted(unknownMint);

        expect(result.accepted).toBe(false);
        expect(result.reason).toBe('verification_failed');
      });

      it('should log rejection for non-accepted tiers', async () => {
        holdex.isTokenAccepted.mockResolvedValue({
          accepted: false,
          tier: 'Silver',
          kScore: 65,
          cached: false,
        });

        await tokenGate.isTokenAccepted(unknownMint);

        expect(logger.info).toHaveBeenCalledWith(
          'TOKEN_GATE',
          'Token rejected',
          expect.objectContaining({
            tier: 'Silver',
            kScore: 65,
          })
        );
      });

      it('should log acceptance for accepted tiers', async () => {
        holdex.isTokenAccepted.mockResolvedValue({
          accepted: true,
          tier: 'Gold',
          kScore: 75,
          cached: false,
        });

        await tokenGate.isTokenAccepted(unknownMint);

        expect(logger.debug).toHaveBeenCalledWith(
          'TOKEN_GATE',
          'Token accepted',
          expect.objectContaining({ tier: 'Gold', kScore: 75 })
        );
      });
    });
  });

  describe('isDiamondToken()', () => {
    it('should return true for Diamond tokens', () => {
      expect(tokenGate.isDiamondToken('So11111111111111111111111111111111111111112')).toBe(true);
      expect(tokenGate.isDiamondToken('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    });

    it('should return false for non-Diamond tokens', () => {
      expect(tokenGate.isDiamondToken('RandomMint111111111111111111111111111111111')).toBe(false);
    });

    it('should include $ASDF in Diamond tokens', () => {
      expect(tokenGate.isDiamondToken('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump')).toBe(true);
    });
  });

  describe('isTrustedToken() (legacy)', () => {
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

  describe('getDiamondTokensList()', () => {
    it('should return list of Diamond tier tokens', () => {
      const tokens = tokenGate.getDiamondTokensList();

      expect(tokens).toBeInstanceOf(Array);
      expect(tokens.length).toBeGreaterThanOrEqual(5);

      // Check structure - now uses tier instead of trusted
      const sol = tokens.find(t => t.symbol === 'SOL');
      expect(sol).toBeDefined();
      expect(sol.mint).toBe('So11111111111111111111111111111111111111112');
      expect(sol.decimals).toBe(9);
      expect(sol.tier).toBe('Diamond');
    });

    it('should include $ASDF when configured', () => {
      const tokens = tokenGate.getDiamondTokensList();

      const asdf = tokens.find(t => t.symbol === 'ASDF');
      expect(asdf).toBeDefined();
      expect(asdf.mint).toBe('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');
      expect(asdf.tier).toBe('Diamond');
    });

    it('should include all major stablecoins', () => {
      const tokens = tokenGate.getDiamondTokensList();

      expect(tokens.find(t => t.symbol === 'USDC')).toBeDefined();
      expect(tokens.find(t => t.symbol === 'USDT')).toBeDefined();
    });

    it('should include liquid staking tokens', () => {
      const tokens = tokenGate.getDiamondTokensList();

      expect(tokens.find(t => t.symbol === 'mSOL')).toBeDefined();
      expect(tokens.find(t => t.symbol === 'jitoSOL')).toBeDefined();
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

    it('should contain the core Diamond tokens', () => {
      expect(tokenGate.DIAMOND_TOKENS.has('So11111111111111111111111111111111111111112')).toBe(true);
      expect(tokenGate.DIAMOND_TOKENS.has('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
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
