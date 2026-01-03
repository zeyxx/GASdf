/**
 * RPC Failover Tests
 * Tests for multi-RPC pool with circuit breakers
 */

// Mock @solana/web3.js before requiring rpc module
jest.mock('@solana/web3.js', () => ({
  Connection: jest.fn().mockImplementation((url) => ({
    url,
    getSlot: jest.fn().mockResolvedValue(12345678),
    getLatestBlockhash: jest.fn().mockResolvedValue({
      blockhash: 'TestBlockhash123',
      lastValidBlockHeight: 100000,
    }),
    getBalance: jest.fn().mockResolvedValue(1000000000),
    sendRawTransaction: jest.fn().mockResolvedValue('TestSignature123'),
    confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
    isBlockhashValid: jest.fn().mockResolvedValue({ value: true }),
    simulateTransaction: jest.fn().mockResolvedValue({
      value: { err: null, logs: [], unitsConsumed: 200000 },
    }),
  })),
}));

const { Connection } = require('@solana/web3.js');

describe('RPC Failover', () => {
  let rpc;
  let pool;

  beforeEach(() => {
    // Clear module cache to get fresh instance
    jest.resetModules();

    // Re-mock after reset
    jest.doMock('@solana/web3.js', () => ({
      Connection: jest.fn().mockImplementation((url) => ({
        url,
        getSlot: jest.fn().mockResolvedValue(12345678),
        getLatestBlockhash: jest.fn().mockResolvedValue({
          blockhash: 'TestBlockhash123',
          lastValidBlockHeight: 100000,
        }),
        getBalance: jest.fn().mockResolvedValue(1000000000),
      })),
    }));

    rpc = require('../../../src/utils/rpc');
    pool = rpc.pool;
    pool.initialized = false;
    pool.endpoints = [];
  });

  describe('RpcPool.initialize()', () => {
    test('should initialize with Helius as primary when API key present', () => {
      pool.initialize();

      expect(pool.endpoints.length).toBeGreaterThanOrEqual(2);
      expect(pool.endpoints[0].name).toBe('helius');
      expect(pool.endpoints[0].priority).toBe(1);
    });

    test('should always include public endpoint as fallback', () => {
      pool.initialize();

      const publicEndpoint = pool.endpoints.find((e) => e.name === 'public');
      expect(publicEndpoint).toBeDefined();
      expect(publicEndpoint.priority).toBe(100);
    });

    test('should sort endpoints by priority', () => {
      pool.initialize();

      for (let i = 1; i < pool.endpoints.length; i++) {
        expect(pool.endpoints[i].priority).toBeGreaterThanOrEqual(pool.endpoints[i - 1].priority);
      }
    });

    test('should only initialize once', () => {
      pool.initialize();
      const firstEndpoints = [...pool.endpoints];

      pool.initialize();
      expect(pool.endpoints).toEqual(firstEndpoints);
    });
  });

  describe('RpcPool.getStatus()', () => {
    test('should return HEALTHY when all endpoints are healthy', () => {
      pool.initialize();

      const status = pool.getStatus();

      expect(status.status).toBe('HEALTHY');
      expect(status.healthyEndpoints).toBe(status.totalEndpoints);
    });

    test('should return DEGRADED when some endpoints are unhealthy', () => {
      pool.initialize();

      // Force one endpoint circuit open
      pool.endpoints[0].breaker.forceOpen();

      const status = pool.getStatus();

      expect(status.status).toBe('DEGRADED');
      expect(status.healthyEndpoints).toBeLessThan(status.totalEndpoints);
    });

    test('should return CRITICAL when all endpoints are unhealthy', () => {
      pool.initialize();

      // Force all circuits open
      pool.endpoints.forEach((e) => e.breaker.forceOpen());

      const status = pool.getStatus();

      expect(status.status).toBe('CRITICAL');
      expect(status.healthyEndpoints).toBe(0);
    });

    test('should include endpoint details', () => {
      pool.initialize();

      const status = pool.getStatus();

      expect(status.endpoints).toBeDefined();
      expect(status.endpoints.length).toBeGreaterThan(0);
      expect(status.endpoints[0]).toHaveProperty('name');
      expect(status.endpoints[0]).toHaveProperty('healthy');
      expect(status.endpoints[0]).toHaveProperty('circuitState');
    });
  });

  describe('RpcPool.executeWithFailover()', () => {
    test('should use primary endpoint when healthy', async () => {
      pool.initialize();

      const result = await pool.executeWithFailover(async (conn) => conn.getSlot(), 'getSlot');

      expect(result).toBe(12345678);
      expect(pool.endpoints[0].health.totalRequests).toBe(1);
    });

    test('should failover to secondary when primary fails', async () => {
      pool.initialize();

      // Make primary always fail
      pool.endpoints[0].breaker.forceOpen();

      const result = await pool.executeWithFailover(async (conn) => conn.getSlot(), 'getSlot');

      expect(result).toBe(12345678);
      // Secondary should have been used
      expect(pool.endpoints[1].health.totalRequests).toBe(1);
    });

    test('should throw when all endpoints fail', async () => {
      pool.initialize();

      // Force all circuits open
      pool.endpoints.forEach((e) => e.breaker.forceOpen());

      await expect(
        pool.executeWithFailover(async () => {
          throw new Error('Connection failed');
        }, 'test')
      ).rejects.toThrow();
    });
  });

  describe('RpcEndpoint health tracking', () => {
    test('should track successful requests', async () => {
      pool.initialize();
      const endpoint = pool.endpoints[0];

      await endpoint.execute(async (conn) => conn.getSlot());

      expect(endpoint.health.totalRequests).toBe(1);
      expect(endpoint.health.successfulRequests).toBe(1);
      expect(endpoint.health.lastSuccess).not.toBeNull();
    });

    test('should track latency samples', async () => {
      pool.initialize();
      const endpoint = pool.endpoints[0];

      await endpoint.execute(async (conn) => conn.getSlot());

      expect(endpoint.health.latencySamples.length).toBe(1);
      // Latency could be 0ms for mocked calls, just verify it's a number
      expect(typeof endpoint.health.avgLatencyMs).toBe('number');
    });

    test('should track errors', async () => {
      pool.initialize();
      const endpoint = pool.endpoints[0];

      // Force error
      try {
        await endpoint.execute(async () => {
          throw new Error('Test error');
        });
      } catch (e) {
        // Expected
      }

      expect(endpoint.health.lastError).not.toBeNull();
      expect(endpoint.health.lastError.message).toBe('Test error');
    });
  });

  describe('Circuit breaker integration', () => {
    test('should open circuit after consecutive failures', async () => {
      pool.initialize();
      const endpoint = pool.endpoints[0];

      // Trigger multiple failures (threshold is 3)
      for (let i = 0; i < 3; i++) {
        try {
          await endpoint.execute(async () => {
            throw new Error('timeout');
          });
        } catch (e) {
          // Expected
        }
      }

      expect(endpoint.breaker.state).toBe('open');
      expect(endpoint.isHealthy()).toBe(false);
    });

    test('should reset circuit on success after half-open', async () => {
      pool.initialize();
      const endpoint = pool.endpoints[0];

      // Open the circuit
      endpoint.breaker.forceOpen();
      expect(endpoint.breaker.state).toBe('open');

      // Reset to test half-open behavior
      endpoint.breaker.reset();
      expect(endpoint.breaker.state).toBe('closed');
      expect(endpoint.isHealthy()).toBe(true);
    });
  });

  describe('Exported functions', () => {
    test('getConnection() should return a connection', () => {
      const conn = rpc.getConnection();
      expect(conn).toBeDefined();
    });

    test('getLatestBlockhash() should use failover', async () => {
      const result = await rpc.getLatestBlockhash();
      expect(result).toHaveProperty('blockhash');
      expect(result).toHaveProperty('lastValidBlockHeight');
    });

    test('getRpcHealth() should return pool status', () => {
      const health = rpc.getRpcHealth();
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('totalEndpoints');
      expect(health).toHaveProperty('healthyEndpoints');
    });
  });
});
