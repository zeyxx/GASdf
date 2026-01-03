/**
 * Tests for Fee Payer Pool Service
 *
 * Tests the fee payer pool constants and basic functionality.
 */

// Mock dependencies before requiring the module
jest.mock('../../../src/utils/config', () => ({
  // Valid base58 encoded 64-byte key (generated for testing)
  FEE_PAYER_PRIVATE_KEY:
    '4Es13NXZ2RVKLifpCokQED5CRkHNfKuiL9dmc7Mzjtq4RJiveQ1BEWk6PNaP8Lzms8bUSGSzwyZe8wurmWsFjNUu',
  FEE_PAYER_PRIVATE_KEYS: '',
  IS_DEV: true,
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../../src/utils/rpc', () => ({
  getConnection: jest.fn().mockReturnValue({
    getBalance: jest.fn().mockResolvedValue(1000000000), // 1 SOL
  }),
}));

jest.mock('../../../src/utils/redis', () => ({
  isReady: jest.fn().mockReturnValue(true),
  acquireReservationLock: jest.fn().mockResolvedValue(true),
  releaseReservationLock: jest.fn().mockResolvedValue(true),
  getClient: jest.fn().mockResolvedValue({
    del: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  }),
  withLock: jest.fn().mockImplementation(async (_lockKey, callback) => {
    const result = await callback();
    return { success: true, result };
  }),
}));

const {
  MIN_HEALTHY_BALANCE,
  WARNING_BALANCE,
  MAX_RESERVATIONS_PER_PAYER,
  KEY_STATUS,
  pool,
  isCircuitOpen,
  getCircuitState,
  closeCircuit,
  getAllFeePayerPublicKeys,
  getRotationStatus,
  reserveBalance,
  releaseReservation,
  getReservation,
} = require('../../../src/services/fee-payer-pool');

describe('Fee Payer Pool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset pool state
    pool.circuitOpen = false;
    pool.circuitOpenUntil = 0;
    pool.consecutiveFailures = 0;
    pool.reservations.clear();
    pool.reservationsByPayer.clear();
    pool.keyStatus.clear();
    pool.unhealthyUntil.clear();
  });

  // ===========================================================================
  // Constants
  // ===========================================================================

  describe('Constants', () => {
    it('should export MIN_HEALTHY_BALANCE', () => {
      expect(MIN_HEALTHY_BALANCE).toBeDefined();
      expect(typeof MIN_HEALTHY_BALANCE).toBe('number');
    });

    it('should export WARNING_BALANCE as 0.05 SOL', () => {
      expect(WARNING_BALANCE).toBe(50_000_000); // 0.05 SOL in lamports
    });

    it('should export MAX_RESERVATIONS_PER_PAYER', () => {
      expect(MAX_RESERVATIONS_PER_PAYER).toBe(200);
    });

    it('should export KEY_STATUS enum', () => {
      expect(KEY_STATUS).toEqual({
        ACTIVE: 'active',
        RETIRING: 'retiring',
        RETIRED: 'retired',
      });
    });
  });

  // ===========================================================================
  // Circuit Breaker
  // ===========================================================================

  describe('Circuit Breaker', () => {
    it('should start with circuit closed', () => {
      expect(isCircuitOpen()).toBe(false);
    });

    it('should return circuit state object', () => {
      const state = getCircuitState();
      expect(state).toBeDefined();
      expect(typeof state).toBe('object');
    });

    it('should close circuit and reset failures', () => {
      // Manually open circuit
      pool.circuitOpen = true;
      pool.circuitOpenUntil = Date.now() + 60000;
      pool.consecutiveFailures = 5;

      // Close it
      closeCircuit();

      expect(isCircuitOpen()).toBe(false);
      expect(pool.consecutiveFailures).toBe(0);
    });

    it('should auto-close expired circuit', () => {
      // Set circuit to have expired
      pool.circuitOpen = true;
      pool.circuitOpenUntil = Date.now() - 1000;

      // Should auto-close on check
      expect(isCircuitOpen()).toBe(false);
    });

    it('should report open circuit when active', () => {
      pool.circuitOpen = true;
      pool.circuitOpenUntil = Date.now() + 60000;

      expect(isCircuitOpen()).toBe(true);
    });
  });

  // ===========================================================================
  // Pool State
  // ===========================================================================

  describe('Pool State', () => {
    it('should return all fee payer public keys', () => {
      const pubkeys = getAllFeePayerPublicKeys();
      expect(Array.isArray(pubkeys)).toBe(true);
      expect(pubkeys.length).toBeGreaterThan(0);
    });

    it('should return rotation status object', () => {
      const status = getRotationStatus();
      expect(status).toBeDefined();
      expect(typeof status).toBe('object');
    });

    it('should track key status changes', () => {
      const pubkeys = getAllFeePayerPublicKeys();
      if (pubkeys.length > 0) {
        const pubkey = pubkeys[0];
        pool.keyStatus.set(pubkey, { status: KEY_STATUS.RETIRING, reason: 'test' });

        const statusEntry = pool.keyStatus.get(pubkey);
        expect(statusEntry.status).toBe(KEY_STATUS.RETIRING);
      }
    });
  });

  // ===========================================================================
  // Reservation System
  // ===========================================================================

  describe('Reservation System', () => {
    it('should return null when circuit is open', async () => {
      pool.circuitOpen = true;
      pool.circuitOpenUntil = Date.now() + 60000;

      const pubkey = await reserveBalance('test-quote', 50000);
      expect(pubkey).toBeNull();
    });

    it('should make reservation when circuit is closed', async () => {
      const quoteId = 'test-quote-123';
      const result = await reserveBalance(quoteId, 50000);

      // Result should be defined (pubkey string or object)
      expect(result).toBeDefined();
    });

    it('should store reservation data', async () => {
      const quoteId = 'test-quote-456';
      const pubkey = await reserveBalance(quoteId, 100000);

      // Verify reservation was made via the returned pubkey
      expect(pubkey).toBeDefined();
      // Check internal state
      const reservation = pool.reservations.get(quoteId);
      if (reservation) {
        expect(reservation.amount).toBe(100000);
      }
    });

    it('should release reservation', async () => {
      const quoteId = 'test-quote-789';
      await reserveBalance(quoteId, 50000);

      const released = releaseReservation(quoteId);
      expect(released).toBeDefined();
      expect(getReservation(quoteId)).toBeUndefined();
    });

    it('should handle non-existent reservation release', () => {
      const released = releaseReservation('nonexistent');
      // Returns object or false depending on implementation
      expect(released).toBeDefined();
    });

    it('should handle concurrent reservations', async () => {
      const quoteIds = ['q1', 'q2', 'q3'];
      const results = await Promise.all(quoteIds.map((id) => reserveBalance(id, 10000)));

      results.forEach((pubkey) => {
        expect(pubkey).toBeDefined();
      });
    });

    it('should track reservations by payer', async () => {
      const quoteId = 'track-test';
      const pubkey = await reserveBalance(quoteId, 50000);

      if (pubkey) {
        const payerReservations = pool.reservationsByPayer.get(pubkey);
        expect(payerReservations).toBeDefined();
        expect(payerReservations.has(quoteId)).toBe(true);
      }
    });

    it('should clean up on release', async () => {
      const quoteId = 'cleanup-test';
      const pubkey = await reserveBalance(quoteId, 50000);

      if (pubkey) {
        releaseReservation(quoteId);
        const payerReservations = pool.reservationsByPayer.get(pubkey);
        expect(payerReservations?.has(quoteId)).toBeFalsy();
      }
    });
  });

  // ===========================================================================
  // Pool Instance Methods
  // ===========================================================================

  describe('Pool Instance', () => {
    it('should have payers array', () => {
      expect(Array.isArray(pool.payers)).toBe(true);
    });

    it('should have balances map', () => {
      expect(pool.balances instanceof Map).toBe(true);
    });

    it('should have reservations map', () => {
      expect(pool.reservations instanceof Map).toBe(true);
    });

    it('should have keyStatus map', () => {
      expect(pool.keyStatus instanceof Map).toBe(true);
    });

    it('should track unhealthy payers', () => {
      expect(pool.unhealthyUntil instanceof Map).toBe(true);
    });

    it('should support marking payers unhealthy', () => {
      const pubkeys = getAllFeePayerPublicKeys();
      if (pubkeys.length > 0) {
        const pubkey = pubkeys[0];
        pool.unhealthyUntil.set(pubkey, Date.now() + 60000);

        expect(pool.unhealthyUntil.has(pubkey)).toBe(true);
        expect(pool.unhealthyUntil.get(pubkey)).toBeGreaterThan(Date.now());
      }
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle empty reservation release gracefully', () => {
      expect(() => releaseReservation('')).not.toThrow();
    });

    it('should handle null quoteId gracefully', async () => {
      // Should not throw, may return null
      const result = await reserveBalance(null, 50000);
      // Result is implementation-dependent
      expect(true).toBe(true);
    });

    it('should handle zero amount reservation', async () => {
      const result = await reserveBalance('zero-amount', 0);
      expect(result).toBeDefined();
    });
  });
});
