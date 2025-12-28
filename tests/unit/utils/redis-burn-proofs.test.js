/**
 * Burn Proofs Tests
 * Tests for burn proof storage and retrieval
 */

// These are unit tests - don't load the app
jest.mock('../../../src/index', () => ({}));

describe('Burn Proofs', () => {
  let redis;

  beforeEach(() => {
    // Clear module cache
    jest.resetModules();

    // Force memory fallback for tests
    process.env.REDIS_URL = '';
    process.env.NODE_ENV = 'test';

    redis = require('../../../src/utils/redis');
  });

  const mockProof = {
    burnSignature: '5XzL8mK9vN2pQ7wR4tU6yH3jF8gC1bD9aE0iO5kM2nP3qS4rT7uV6wX8yZ1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT',
    swapSignature: '4WyK7lJ8uM1oP6vQ3sT5xG2iE7fB0aC8zD9hN4jL1mO2pR3qS6tU5wV7xY0zA1bC2dE3fG4hI5jK6lM7nO8pQ9rS',
    amountBurned: 1500000000,
    solAmount: 50000000,
    treasuryAmount: 12500000,
    method: 'jupiter',
    network: 'devnet',
  };

  describe('recordBurnProof()', () => {
    test('should record a burn proof successfully', async () => {
      const result = await redis.recordBurnProof(mockProof);

      expect(result).toHaveProperty('burnSignature', mockProof.burnSignature);
      expect(result).toHaveProperty('swapSignature', mockProof.swapSignature);
      expect(result).toHaveProperty('amountBurned', mockProof.amountBurned);
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('explorerUrl');
    });

    test('should add timestamp automatically', async () => {
      const before = Date.now();
      const result = await redis.recordBurnProof(mockProof);
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });

    test('should generate correct explorer URL', async () => {
      const result = await redis.recordBurnProof(mockProof);

      expect(result.explorerUrl).toBe(
        `https://solscan.io/tx/${mockProof.burnSignature}`
      );
    });

    test('should include network in proof', async () => {
      const result = await redis.recordBurnProof(mockProof);

      expect(result.network).toBe('devnet');
    });

    test('should default network to mainnet-beta', async () => {
      const proofWithoutNetwork = { ...mockProof };
      delete proofWithoutNetwork.network;

      const result = await redis.recordBurnProof(proofWithoutNetwork);

      expect(result.network).toBe('mainnet-beta');
    });
  });

  describe('getBurnProofs()', () => {
    beforeEach(async () => {
      // Record multiple proofs
      for (let i = 0; i < 5; i++) {
        await redis.recordBurnProof({
          ...mockProof,
          burnSignature: `sig${i}${'x'.repeat(80)}`,
          amountBurned: 1000000 * (i + 1),
        });
      }
    });

    test('should return proofs array', async () => {
      const result = await redis.getBurnProofs(10);

      expect(result).toHaveProperty('proofs');
      expect(Array.isArray(result.proofs)).toBe(true);
    });

    test('should return total count', async () => {
      const result = await redis.getBurnProofs(10);

      expect(result).toHaveProperty('totalCount');
      expect(result.totalCount).toBeGreaterThanOrEqual(5);
    });

    test('should respect limit parameter', async () => {
      const result = await redis.getBurnProofs(3);

      expect(result.proofs.length).toBeLessThanOrEqual(3);
    });

    test('should return proofs in chronological order (newest first)', async () => {
      const result = await redis.getBurnProofs(10);

      for (let i = 1; i < result.proofs.length; i++) {
        expect(result.proofs[i - 1].timestamp).toBeGreaterThanOrEqual(
          result.proofs[i].timestamp
        );
      }
    });
  });

  describe('getBurnProofBySignature()', () => {
    test('should return proof when found', async () => {
      await redis.recordBurnProof(mockProof);

      const result = await redis.getBurnProofBySignature(mockProof.burnSignature);

      expect(result).not.toBeNull();
      expect(result.burnSignature).toBe(mockProof.burnSignature);
    });

    test('should return null when not found', async () => {
      const result = await redis.getBurnProofBySignature('nonexistent_signature');

      expect(result).toBeNull();
    });

    test('should return complete proof data', async () => {
      await redis.recordBurnProof(mockProof);

      const result = await redis.getBurnProofBySignature(mockProof.burnSignature);

      expect(result).toHaveProperty('burnSignature');
      expect(result).toHaveProperty('swapSignature');
      expect(result).toHaveProperty('amountBurned');
      expect(result).toHaveProperty('solAmount');
      expect(result).toHaveProperty('treasuryAmount');
      expect(result).toHaveProperty('method');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('network');
      expect(result).toHaveProperty('explorerUrl');
    });
  });

  describe('Memory fallback', () => {
    test('should work without Redis connection', async () => {
      // In test mode without REDIS_URL, should use memory fallback
      // Just verify the operations work
      const result = await redis.recordBurnProof({
        ...mockProof,
        burnSignature: `fallback_test_${Date.now()}${'x'.repeat(60)}`,
      });
      expect(result).toHaveProperty('burnSignature');

      const proofs = await redis.getBurnProofs(10);
      expect(proofs).toHaveProperty('proofs');
      expect(proofs).toHaveProperty('totalCount');
    });
  });
});
