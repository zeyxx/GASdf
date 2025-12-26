const logger = require('./logger');

// =============================================================================
// Circuit Breaker States
// =============================================================================

const STATE = {
  CLOSED: 'closed',     // Normal operation
  OPEN: 'open',         // Failures threshold reached, fast-fail
  HALF_OPEN: 'half-open', // Testing if service recovered
};

// =============================================================================
// Circuit Breaker
// =============================================================================

class CircuitBreaker {
  /**
   * @param {Object} options
   * @param {string} options.name - Name for logging
   * @param {number} options.failureThreshold - Number of failures before opening (default: 5)
   * @param {number} options.resetTimeout - Time in ms before trying again (default: 30000)
   * @param {number} options.halfOpenMaxRequests - Requests allowed in half-open state (default: 1)
   * @param {Function} options.isFailure - Function to determine if error is a failure (optional)
   */
  constructor(options = {}) {
    this.name = options.name || 'default';
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 30000;
    this.halfOpenMaxRequests = options.halfOpenMaxRequests || 1;
    this.isFailure = options.isFailure || (() => true);

    this.state = STATE.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailure = null;
    this.openedAt = null;
    this.halfOpenRequests = 0;

    // Statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0,
      stateChanges: [],
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute(fn) {
    this.stats.totalRequests++;

    // Check if we should allow the request
    if (!this.canExecute()) {
      this.stats.rejectedRequests++;
      const error = new Error(`Circuit breaker '${this.name}' is open`);
      error.code = 'CIRCUIT_OPEN';
      error.circuitBreaker = this.name;
      throw error;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      // Check if this error should count as a failure
      if (this.isFailure(error)) {
        this.onFailure(error);
      }
      throw error;
    }
  }

  /**
   * Check if request can be executed
   */
  canExecute() {
    switch (this.state) {
      case STATE.CLOSED:
        return true;

      case STATE.OPEN:
        // Check if reset timeout has passed
        if (Date.now() - this.openedAt >= this.resetTimeout) {
          this.transitionTo(STATE.HALF_OPEN);
          return true;
        }
        return false;

      case STATE.HALF_OPEN:
        // Allow limited requests in half-open state
        if (this.halfOpenRequests < this.halfOpenMaxRequests) {
          this.halfOpenRequests++;
          return true;
        }
        return false;

      default:
        return false;
    }
  }

  /**
   * Handle successful execution
   */
  onSuccess() {
    this.stats.successfulRequests++;

    switch (this.state) {
      case STATE.HALF_OPEN:
        this.successes++;
        // After one success in half-open, close the circuit
        if (this.successes >= 1) {
          this.transitionTo(STATE.CLOSED);
        }
        break;

      case STATE.CLOSED:
        // Reset failure count on success
        this.failures = 0;
        break;
    }
  }

  /**
   * Handle failed execution
   */
  onFailure(error) {
    this.stats.failedRequests++;
    this.failures++;
    this.lastFailure = {
      at: Date.now(),
      error: error.message,
    };

    switch (this.state) {
      case STATE.HALF_OPEN:
        // Any failure in half-open reopens the circuit
        this.transitionTo(STATE.OPEN);
        break;

      case STATE.CLOSED:
        if (this.failures >= this.failureThreshold) {
          this.transitionTo(STATE.OPEN);
        }
        break;
    }
  }

  /**
   * Transition to a new state
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;

    logger.info('CIRCUIT_BREAKER', `State change: ${oldState} -> ${newState}`, {
      name: this.name,
      failures: this.failures,
    });

    this.stats.stateChanges.push({
      from: oldState,
      to: newState,
      at: Date.now(),
    });

    // Reset counters based on new state
    switch (newState) {
      case STATE.OPEN:
        this.openedAt = Date.now();
        break;

      case STATE.HALF_OPEN:
        this.halfOpenRequests = 0;
        this.successes = 0;
        break;

      case STATE.CLOSED:
        this.failures = 0;
        this.successes = 0;
        this.openedAt = null;
        break;
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset() {
    this.transitionTo(STATE.CLOSED);
  }

  /**
   * Force open the circuit
   */
  forceOpen() {
    this.transitionTo(STATE.OPEN);
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      failureThreshold: this.failureThreshold,
      resetTimeout: this.resetTimeout,
      lastFailure: this.lastFailure,
      openedAt: this.openedAt,
      timeUntilRetry: this.state === STATE.OPEN
        ? Math.max(0, this.resetTimeout - (Date.now() - this.openedAt))
        : 0,
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalRequests > 0
        ? (this.stats.successfulRequests / this.stats.totalRequests * 100).toFixed(2) + '%'
        : 'N/A',
      recentStateChanges: this.stats.stateChanges.slice(-5),
    };
  }
}

// =============================================================================
// Circuit Breaker Registry
// =============================================================================

const breakers = new Map();

/**
 * Get or create a circuit breaker
 */
function getBreaker(name, options = {}) {
  if (!breakers.has(name)) {
    breakers.set(name, new CircuitBreaker({ name, ...options }));
  }
  return breakers.get(name);
}

/**
 * Get all circuit breakers status
 */
function getAllStatus() {
  const status = {};
  for (const [name, breaker] of breakers) {
    status[name] = breaker.getStatus();
  }
  return status;
}

/**
 * Reset all circuit breakers
 */
function resetAll() {
  for (const breaker of breakers.values()) {
    breaker.reset();
  }
}

// =============================================================================
// Pre-configured Breakers
// =============================================================================

// Jupiter API circuit breaker
const jupiterBreaker = new CircuitBreaker({
  name: 'jupiter',
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds
  isFailure: (error) => {
    const msg = error.message?.toLowerCase() || '';
    // Don't count client errors as failures
    return !msg.includes('invalid') && !msg.includes('not found');
  },
});

// RPC circuit breaker
const rpcBreaker = new CircuitBreaker({
  name: 'rpc',
  failureThreshold: 3,
  resetTimeout: 15000, // 15 seconds - RPC should recover faster
  isFailure: (error) => {
    const msg = error.message?.toLowerCase() || '';
    // Only count network/service errors
    return msg.includes('timeout') ||
           msg.includes('econnrefused') ||
           msg.includes('service unavailable') ||
           msg.includes('too many requests');
  },
});

module.exports = {
  CircuitBreaker,
  STATE,
  getBreaker,
  getAllStatus,
  resetAll,

  // Pre-configured breakers
  jupiterBreaker,
  rpcBreaker,
};
