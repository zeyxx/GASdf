/**
 * Tests for Audit Service
 */

const {
  auditService,
  AUDIT_EVENTS,
  hashPII,
  anonymizeWallet,
  anonymizeIP,
  anonymizeToken,
  logQuoteCreated,
  logQuoteRejected,
  logSubmitSuccess,
  logSubmitRejected,
  logSecurityEvent,
} = require('../../../src/services/audit');

// Mock dependencies
jest.mock('../../../src/utils/config', () => ({
  IS_DEV: true,
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/utils/redis', () => ({
  appendAuditLog: jest.fn().mockResolvedValue(true),
  getAuditLog: jest.fn().mockResolvedValue([]),
  searchAuditLog: jest.fn().mockResolvedValue([]),
}));

describe('Audit Service', () => {
  describe('AUDIT_EVENTS', () => {
    describe('Quote events', () => {
      it('should define QUOTE_CREATED', () => {
        expect(AUDIT_EVENTS.QUOTE_CREATED).toBe('quote.created');
      });

      it('should define QUOTE_EXPIRED', () => {
        expect(AUDIT_EVENTS.QUOTE_EXPIRED).toBe('quote.expired');
      });

      it('should define QUOTE_REJECTED', () => {
        expect(AUDIT_EVENTS.QUOTE_REJECTED).toBe('quote.rejected');
      });
    });

    describe('Submit events', () => {
      it('should define SUBMIT_SUCCESS', () => {
        expect(AUDIT_EVENTS.SUBMIT_SUCCESS).toBe('submit.success');
      });

      it('should define SUBMIT_FAILED', () => {
        expect(AUDIT_EVENTS.SUBMIT_FAILED).toBe('submit.failed');
      });

      it('should define SUBMIT_REJECTED', () => {
        expect(AUDIT_EVENTS.SUBMIT_REJECTED).toBe('submit.rejected');
      });
    });

    describe('Security events', () => {
      it('should define REPLAY_ATTACK_DETECTED', () => {
        expect(AUDIT_EVENTS.REPLAY_ATTACK_DETECTED).toBe('security.replay_attack');
      });

      it('should define BLOCKHASH_EXPIRED', () => {
        expect(AUDIT_EVENTS.BLOCKHASH_EXPIRED).toBe('security.blockhash_expired');
      });

      it('should define SIMULATION_FAILED', () => {
        expect(AUDIT_EVENTS.SIMULATION_FAILED).toBe('security.simulation_failed');
      });

      it('should define FEE_PAYER_MISMATCH', () => {
        expect(AUDIT_EVENTS.FEE_PAYER_MISMATCH).toBe('security.fee_payer_mismatch');
      });

      it('should define VALIDATION_FAILED', () => {
        expect(AUDIT_EVENTS.VALIDATION_FAILED).toBe('security.validation_failed');
      });
    });

    describe('Rate limiting events', () => {
      it('should define IP_RATE_LIMITED', () => {
        expect(AUDIT_EVENTS.IP_RATE_LIMITED).toBe('ratelimit.ip');
      });

      it('should define WALLET_RATE_LIMITED', () => {
        expect(AUDIT_EVENTS.WALLET_RATE_LIMITED).toBe('ratelimit.wallet');
      });
    });

    describe('Circuit breaker events', () => {
      it('should define CIRCUIT_OPENED', () => {
        expect(AUDIT_EVENTS.CIRCUIT_OPENED).toBe('circuit.opened');
      });

      it('should define CIRCUIT_CLOSED', () => {
        expect(AUDIT_EVENTS.CIRCUIT_CLOSED).toBe('circuit.closed');
      });
    });

    describe('Fee payer events', () => {
      it('should define PAYER_RESERVATION_FAILED', () => {
        expect(AUDIT_EVENTS.PAYER_RESERVATION_FAILED).toBe('payer.reservation_failed');
      });

      it('should define PAYER_BALANCE_LOW', () => {
        expect(AUDIT_EVENTS.PAYER_BALANCE_LOW).toBe('payer.balance_low');
      });

      it('should define PAYER_MARKED_UNHEALTHY', () => {
        expect(AUDIT_EVENTS.PAYER_MARKED_UNHEALTHY).toBe('payer.marked_unhealthy');
      });
    });
  });

  describe('PII Anonymization', () => {
    describe('hashPII()', () => {
      it('should return null for null input', () => {
        expect(hashPII(null)).toBeNull();
      });

      it('should return null for undefined input', () => {
        expect(hashPII(undefined)).toBeNull();
      });

      it('should return null for empty string', () => {
        expect(hashPII('')).toBeNull();
      });

      it('should hash string data', () => {
        const result = hashPII('test-data');
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
        expect(result.length).toBe(16);
      });

      it('should add prefix when provided', () => {
        const result = hashPII('test-data', 'prefix:');
        expect(result).toMatch(/^prefix:/);
      });

      it('should produce consistent hashes', () => {
        const hash1 = hashPII('same-data');
        const hash2 = hashPII('same-data');
        expect(hash1).toBe(hash2);
      });

      it('should produce different hashes for different data', () => {
        const hash1 = hashPII('data-1');
        const hash2 = hashPII('data-2');
        expect(hash1).not.toBe(hash2);
      });
    });

    describe('anonymizeWallet()', () => {
      it('should prefix with w:', () => {
        const result = anonymizeWallet('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        expect(result).toMatch(/^w:/);
      });

      it('should return consistent hash for same wallet', () => {
        const wallet = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
        expect(anonymizeWallet(wallet)).toBe(anonymizeWallet(wallet));
      });

      it('should return null for null input', () => {
        expect(anonymizeWallet(null)).toBeNull();
      });
    });

    describe('anonymizeIP()', () => {
      it('should prefix with ip:', () => {
        const result = anonymizeIP('192.168.1.1');
        expect(result).toMatch(/^ip:/);
      });

      it('should return consistent hash for same IP', () => {
        const ip = '10.0.0.1';
        expect(anonymizeIP(ip)).toBe(anonymizeIP(ip));
      });

      it('should return null for null input', () => {
        expect(anonymizeIP(null)).toBeNull();
      });
    });

    describe('anonymizeToken()', () => {
      it('should prefix with t:', () => {
        const result = anonymizeToken('So11111111111111111111111111111111111111112');
        expect(result).toMatch(/^t:/);
      });

      it('should return consistent hash for same token', () => {
        const token = 'So11111111111111111111111111111111111111112';
        expect(anonymizeToken(token)).toBe(anonymizeToken(token));
      });

      it('should return null for null input', () => {
        expect(anonymizeToken(null)).toBeNull();
      });
    });
  });

  describe('auditService', () => {
    it('should be defined', () => {
      expect(auditService).toBeDefined();
    });

    it('should have enabled property', () => {
      expect(typeof auditService.enabled).toBe('boolean');
    });

    describe('start()', () => {
      it('should have start method', () => {
        expect(typeof auditService.start).toBe('function');
      });
    });

    describe('stop()', () => {
      it('should have stop method', () => {
        expect(typeof auditService.stop).toBe('function');
      });

      it('should not throw if not started', () => {
        expect(() => auditService.stop()).not.toThrow();
      });
    });

    describe('log()', () => {
      it('should have log method', () => {
        expect(typeof auditService.log).toBe('function');
      });

      it('should not throw when logging event', () => {
        expect(() => {
          auditService.log(AUDIT_EVENTS.QUOTE_CREATED, {
            wallet: 'testWallet',
            ip: '127.0.0.1',
          });
        }).not.toThrow();
      });
    });

    describe('flush()', () => {
      it('should have flush method', () => {
        expect(typeof auditService.flush).toBe('function');
      });

      it('should not throw when called', async () => {
        await expect(auditService.flush()).resolves.not.toThrow();
      });
    });

    describe('getSecuritySummary()', () => {
      it('should have getSecuritySummary method', () => {
        expect(typeof auditService.getSecuritySummary).toBe('function');
      });

      it('should return security summary object', () => {
        const summary = auditService.getSecuritySummary(5);
        expect(summary).toBeDefined();
        expect(typeof summary).toBe('object');
      });
    });
  });

  describe('Convenience functions', () => {
    describe('logQuoteCreated()', () => {
      it('should be a function', () => {
        expect(typeof logQuoteCreated).toBe('function');
      });

      it('should not throw when called', () => {
        expect(() => {
          logQuoteCreated({
            quoteId: 'test-quote-id',
            wallet: 'testWallet',
            paymentToken: 'testToken',
            feeInLamports: 5000,
            ip: '127.0.0.1',
          });
        }).not.toThrow();
      });
    });

    describe('logQuoteRejected()', () => {
      it('should be a function', () => {
        expect(typeof logQuoteRejected).toBe('function');
      });

      it('should not throw when called', () => {
        expect(() => {
          logQuoteRejected({
            wallet: 'testWallet',
            reason: 'test reason',
            ip: '127.0.0.1',
          });
        }).not.toThrow();
      });
    });

    describe('logSubmitSuccess()', () => {
      it('should be a function', () => {
        expect(typeof logSubmitSuccess).toBe('function');
      });

      it('should not throw when called', () => {
        expect(() => {
          logSubmitSuccess({
            quoteId: 'test-quote-id',
            wallet: 'testWallet',
            signature: 'testSignature',
            ip: '127.0.0.1',
          });
        }).not.toThrow();
      });
    });

    describe('logSubmitRejected()', () => {
      it('should be a function', () => {
        expect(typeof logSubmitRejected).toBe('function');
      });

      it('should not throw when called', () => {
        expect(() => {
          logSubmitRejected({
            quoteId: 'test-quote-id',
            wallet: 'testWallet',
            reason: 'test reason',
            ip: '127.0.0.1',
          });
        }).not.toThrow();
      });
    });

    describe('logSecurityEvent()', () => {
      it('should be a function', () => {
        expect(typeof logSecurityEvent).toBe('function');
      });

      it('should not throw when called', () => {
        expect(() => {
          logSecurityEvent(AUDIT_EVENTS.REPLAY_ATTACK_DETECTED, {
            wallet: 'testWallet',
            ip: '127.0.0.1',
            details: 'test details',
          });
        }).not.toThrow();
      });
    });
  });
});
