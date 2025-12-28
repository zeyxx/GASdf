/**
 * Tests for Circuit Breaker utility
 */

const {
  CircuitBreaker,
  STATE,
  getBreaker,
  getAllStatus,
  resetAll,
  jupiterBreaker,
  rpcBreaker,
} = require('../../../src/utils/circuit-breaker');

describe('Circuit Breaker', () => {
  describe('CircuitBreaker class', () => {
    let breaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 3,
        resetTimeout: 100,
        halfOpenMaxRequests: 1,
      });
    });

    describe('initial state', () => {
      it('should start in CLOSED state', () => {
        expect(breaker.state).toBe(STATE.CLOSED);
      });

      it('should have zero failures', () => {
        expect(breaker.failures).toBe(0);
      });

      it('should use provided options', () => {
        expect(breaker.name).toBe('test');
        expect(breaker.failureThreshold).toBe(3);
        expect(breaker.resetTimeout).toBe(100);
      });

      it('should use default options when not provided', () => {
        const defaultBreaker = new CircuitBreaker();
        expect(defaultBreaker.name).toBe('default');
        expect(defaultBreaker.failureThreshold).toBe(5);
        expect(defaultBreaker.resetTimeout).toBe(30000);
      });
    });

    describe('execute()', () => {
      it('should execute function in CLOSED state', async () => {
        const result = await breaker.execute(async () => 'success');
        expect(result).toBe('success');
      });

      it('should track successful requests', async () => {
        await breaker.execute(async () => 'success');
        expect(breaker.stats.successfulRequests).toBe(1);
        expect(breaker.stats.totalRequests).toBe(1);
      });

      it('should track failed requests', async () => {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch (e) {
          // expected
        }
        expect(breaker.stats.failedRequests).toBe(1);
      });

      it('should reject requests when circuit is OPEN', async () => {
        breaker.forceOpen();
        await expect(breaker.execute(async () => 'success')).rejects.toThrow(
          "Circuit breaker 'test' is open"
        );
        expect(breaker.stats.rejectedRequests).toBe(1);
      });

      it('should throw error with CIRCUIT_OPEN code when open', async () => {
        breaker.forceOpen();
        try {
          await breaker.execute(async () => 'success');
          fail('Should have thrown');
        } catch (error) {
          expect(error.code).toBe('CIRCUIT_OPEN');
          expect(error.circuitBreaker).toBe('test');
        }
      });
    });

    describe('failure threshold', () => {
      it('should open circuit after reaching failure threshold', async () => {
        for (let i = 0; i < 3; i++) {
          try {
            await breaker.execute(async () => {
              throw new Error('fail');
            });
          } catch (e) {
            // expected
          }
        }

        expect(breaker.state).toBe(STATE.OPEN);
      });

      it('should not open circuit before threshold', async () => {
        for (let i = 0; i < 2; i++) {
          try {
            await breaker.execute(async () => {
              throw new Error('fail');
            });
          } catch (e) {
            // expected
          }
        }

        expect(breaker.state).toBe(STATE.CLOSED);
        expect(breaker.failures).toBe(2);
      });

      it('should reset failure count on success', async () => {
        // Two failures
        for (let i = 0; i < 2; i++) {
          try {
            await breaker.execute(async () => {
              throw new Error('fail');
            });
          } catch (e) {
            // expected
          }
        }
        expect(breaker.failures).toBe(2);

        // One success resets count
        await breaker.execute(async () => 'success');
        expect(breaker.failures).toBe(0);
      });
    });

    describe('state transitions', () => {
      it('should transition to HALF_OPEN after reset timeout', async () => {
        breaker.forceOpen();
        expect(breaker.state).toBe(STATE.OPEN);

        // Wait for reset timeout
        await new Promise((r) => setTimeout(r, 150));

        // Next execute check should transition to HALF_OPEN
        expect(breaker.canExecute()).toBe(true);
        expect(breaker.state).toBe(STATE.HALF_OPEN);
      });

      it('should transition to CLOSED on success in HALF_OPEN', async () => {
        breaker.forceOpen();
        await new Promise((r) => setTimeout(r, 150));

        await breaker.execute(async () => 'success');
        expect(breaker.state).toBe(STATE.CLOSED);
      });

      it('should transition to OPEN on failure in HALF_OPEN', async () => {
        breaker.forceOpen();
        await new Promise((r) => setTimeout(r, 150));

        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch (e) {
          // expected
        }

        expect(breaker.state).toBe(STATE.OPEN);
      });

      it('should track state changes in stats', async () => {
        breaker.forceOpen();
        breaker.reset();

        expect(breaker.stats.stateChanges.length).toBe(2);
        expect(breaker.stats.stateChanges[0].to).toBe(STATE.OPEN);
        expect(breaker.stats.stateChanges[1].to).toBe(STATE.CLOSED);
      });
    });

    describe('canExecute()', () => {
      it('should return true in CLOSED state', () => {
        expect(breaker.canExecute()).toBe(true);
      });

      it('should return false in OPEN state before timeout', () => {
        breaker.forceOpen();
        expect(breaker.canExecute()).toBe(false);
      });

      it('should limit requests in HALF_OPEN state', async () => {
        // Manually transition to half-open (simulating the timeout expiry)
        breaker.forceOpen();
        breaker.transitionTo(STATE.HALF_OPEN);

        // First request allowed
        expect(breaker.canExecute()).toBe(true);

        // Second request rejected (halfOpenMaxRequests = 1)
        expect(breaker.canExecute()).toBe(false);
      });
    });

    describe('reset()', () => {
      it('should reset to CLOSED state', () => {
        breaker.forceOpen();
        breaker.reset();
        expect(breaker.state).toBe(STATE.CLOSED);
      });

      it('should clear failures', () => {
        breaker.failures = 5;
        breaker.reset();
        expect(breaker.failures).toBe(0);
      });
    });

    describe('forceOpen()', () => {
      it('should force circuit to OPEN state', () => {
        breaker.forceOpen();
        expect(breaker.state).toBe(STATE.OPEN);
        expect(breaker.openedAt).not.toBeNull();
      });
    });

    describe('getStatus()', () => {
      it('should return current status', () => {
        const status = breaker.getStatus();
        expect(status.name).toBe('test');
        expect(status.state).toBe(STATE.CLOSED);
        expect(status.failures).toBe(0);
        expect(status.failureThreshold).toBe(3);
        expect(status.timeUntilRetry).toBe(0);
      });

      it('should include time until retry when OPEN', () => {
        breaker.forceOpen();
        const status = breaker.getStatus();
        expect(status.timeUntilRetry).toBeGreaterThan(0);
        expect(status.timeUntilRetry).toBeLessThanOrEqual(100);
      });

      it('should track last failure', async () => {
        try {
          await breaker.execute(async () => {
            throw new Error('test error');
          });
        } catch (e) {
          // expected
        }

        const status = breaker.getStatus();
        expect(status.lastFailure).not.toBeNull();
        expect(status.lastFailure.error).toBe('test error');
      });
    });

    describe('getStats()', () => {
      it('should return statistics', async () => {
        await breaker.execute(async () => 'success');
        await breaker.execute(async () => 'success');

        const stats = breaker.getStats();
        expect(stats.totalRequests).toBe(2);
        expect(stats.successfulRequests).toBe(2);
        expect(stats.successRate).toBe('100.00%');
      });

      it('should show N/A for success rate with no requests', () => {
        const stats = breaker.getStats();
        expect(stats.successRate).toBe('N/A');
      });

      it('should include recent state changes', () => {
        breaker.forceOpen();
        breaker.reset();

        const stats = breaker.getStats();
        expect(stats.recentStateChanges.length).toBe(2);
      });
    });

    describe('isFailure callback', () => {
      it('should use custom isFailure to filter errors', async () => {
        const customBreaker = new CircuitBreaker({
          name: 'custom',
          failureThreshold: 2,
          isFailure: (error) => error.message !== 'ignore me',
        });

        // This error should be ignored
        try {
          await customBreaker.execute(async () => {
            throw new Error('ignore me');
          });
        } catch (e) {
          // expected
        }

        expect(customBreaker.failures).toBe(0);

        // This error should count
        try {
          await customBreaker.execute(async () => {
            throw new Error('count me');
          });
        } catch (e) {
          // expected
        }

        expect(customBreaker.failures).toBe(1);
      });
    });
  });

  describe('Registry functions', () => {
    beforeEach(() => {
      resetAll();
    });

    describe('getBreaker()', () => {
      it('should create new breaker if not exists', () => {
        const breaker = getBreaker('new-breaker');
        expect(breaker).toBeInstanceOf(CircuitBreaker);
        expect(breaker.name).toBe('new-breaker');
      });

      it('should return existing breaker', () => {
        const breaker1 = getBreaker('singleton');
        const breaker2 = getBreaker('singleton');
        expect(breaker1).toBe(breaker2);
      });

      it('should accept options for new breaker', () => {
        const breaker = getBreaker('custom-options', {
          failureThreshold: 10,
          resetTimeout: 5000,
        });
        expect(breaker.failureThreshold).toBe(10);
        expect(breaker.resetTimeout).toBe(5000);
      });
    });

    describe('getAllStatus()', () => {
      it('should return status of all breakers', () => {
        getBreaker('breaker-a');
        getBreaker('breaker-b');

        const status = getAllStatus();
        expect(status['breaker-a']).toBeDefined();
        expect(status['breaker-b']).toBeDefined();
      });
    });

    describe('resetAll()', () => {
      it('should reset all breakers to CLOSED', () => {
        const breaker1 = getBreaker('reset-test-1');
        const breaker2 = getBreaker('reset-test-2');

        breaker1.forceOpen();
        breaker2.forceOpen();

        resetAll();

        expect(breaker1.state).toBe(STATE.CLOSED);
        expect(breaker2.state).toBe(STATE.CLOSED);
      });
    });
  });

  describe('Pre-configured breakers', () => {
    describe('jupiterBreaker', () => {
      beforeEach(() => {
        jupiterBreaker.reset();
      });

      it('should exist and be configured', () => {
        expect(jupiterBreaker).toBeInstanceOf(CircuitBreaker);
        expect(jupiterBreaker.name).toBe('jupiter');
        expect(jupiterBreaker.failureThreshold).toBe(5);
        expect(jupiterBreaker.resetTimeout).toBe(30000);
      });

      it('should not count invalid errors as failures', async () => {
        try {
          await jupiterBreaker.execute(async () => {
            throw new Error('Invalid token address');
          });
        } catch (e) {
          // expected
        }

        expect(jupiterBreaker.failures).toBe(0);
      });

      it('should count network errors as failures', async () => {
        try {
          await jupiterBreaker.execute(async () => {
            throw new Error('Connection timeout');
          });
        } catch (e) {
          // expected
        }

        expect(jupiterBreaker.failures).toBe(1);
      });
    });

    describe('rpcBreaker', () => {
      beforeEach(() => {
        rpcBreaker.reset();
      });

      it('should exist and be configured', () => {
        expect(rpcBreaker).toBeInstanceOf(CircuitBreaker);
        expect(rpcBreaker.name).toBe('rpc');
        expect(rpcBreaker.failureThreshold).toBe(3);
        expect(rpcBreaker.resetTimeout).toBe(15000);
      });

      it('should count timeout errors as failures', async () => {
        try {
          await rpcBreaker.execute(async () => {
            throw new Error('Request timeout');
          });
        } catch (e) {
          // expected
        }

        expect(rpcBreaker.failures).toBe(1);
      });

      it('should count connection refused as failures', async () => {
        try {
          await rpcBreaker.execute(async () => {
            throw new Error('ECONNREFUSED');
          });
        } catch (e) {
          // expected
        }

        expect(rpcBreaker.failures).toBe(1);
      });

      it('should not count generic errors as failures', async () => {
        try {
          await rpcBreaker.execute(async () => {
            throw new Error('Some other error');
          });
        } catch (e) {
          // expected
        }

        expect(rpcBreaker.failures).toBe(0);
      });
    });
  });

  describe('STATE constants', () => {
    it('should export state constants', () => {
      expect(STATE.CLOSED).toBe('closed');
      expect(STATE.OPEN).toBe('open');
      expect(STATE.HALF_OPEN).toBe('half-open');
    });
  });
});
