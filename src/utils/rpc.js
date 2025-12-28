// Multi-RPC failover for reliability
// Design: Primary → Secondary → Fallback with circuit breakers per endpoint

const { Connection } = require('@solana/web3.js');
const config = require('./config');
const logger = require('./logger');
const { CircuitBreaker } = require('./circuit-breaker');

// =============================================================================
// RPC Endpoint Pool
// =============================================================================

class RpcEndpoint {
  constructor(name, url, priority = 100) {
    this.name = name;
    this.url = url;
    this.priority = priority; // Lower = higher priority
    this.connection = null;

    // Health tracking
    this.health = {
      totalRequests: 0,
      successfulRequests: 0,
      lastSuccess: null,
      lastError: null,
      latencySamples: [],
      avgLatencyMs: 0,
    };

    // Circuit breaker per endpoint
    this.breaker = new CircuitBreaker({
      name: `rpc:${name}`,
      failureThreshold: 3,
      resetTimeout: 15000, // 15 seconds
      isFailure: (error) => {
        const msg = error.message?.toLowerCase() || '';
        return msg.includes('timeout') ||
               msg.includes('econnrefused') ||
               msg.includes('enotfound') ||
               msg.includes('service unavailable') ||
               msg.includes('429') ||
               msg.includes('too many requests') ||
               msg.includes('failed to fetch');
      },
    });
  }

  getConnection() {
    if (!this.connection) {
      this.connection = new Connection(this.url, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 30000,
      });
    }
    return this.connection;
  }

  async execute(operation) {
    const startTime = Date.now();
    this.health.totalRequests++;

    try {
      const result = await this.breaker.execute(async () => {
        return await operation(this.getConnection());
      });

      // Track success
      const latency = Date.now() - startTime;
      this.trackLatency(latency);
      this.health.successfulRequests++;
      this.health.lastSuccess = Date.now();

      return result;
    } catch (error) {
      this.health.lastError = { time: Date.now(), message: error.message };
      throw error;
    }
  }

  trackLatency(latencyMs) {
    this.health.latencySamples.push(latencyMs);
    if (this.health.latencySamples.length > 50) {
      this.health.latencySamples.shift();
    }
    this.health.avgLatencyMs = Math.round(
      this.health.latencySamples.reduce((a, b) => a + b, 0) / this.health.latencySamples.length
    );
  }

  isHealthy() {
    return this.breaker.canExecute();
  }

  getStatus() {
    const successRate = this.health.totalRequests > 0
      ? ((this.health.successfulRequests / this.health.totalRequests) * 100).toFixed(1)
      : 0;

    return {
      name: this.name,
      url: this.url.replace(/api-key=[^&]+/, 'api-key=***'),
      priority: this.priority,
      healthy: this.isHealthy(),
      circuitState: this.breaker.state,
      successRate: `${successRate}%`,
      avgLatencyMs: this.health.avgLatencyMs,
      lastSuccess: this.health.lastSuccess,
      lastError: this.health.lastError,
    };
  }
}

// =============================================================================
// RPC Pool Manager
// =============================================================================

class RpcPool {
  constructor() {
    this.endpoints = [];
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;

    // Detect mainnet from config or explicit RPC_URL
    const isMainnet = config.NETWORK === 'mainnet' ||
                      config.USE_MAINNET ||
                      (config.RPC_URL && config.RPC_URL.includes('mainnet'));
    const heliusKey = config.HELIUS_API_KEY;

    // Build endpoint list based on available config
    const endpointConfigs = [];

    // Primary: Helius (if configured)
    if (heliusKey) {
      const heliusUrl = isMainnet
        ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
        : `https://devnet.helius-rpc.com/?api-key=${heliusKey}`;
      endpointConfigs.push({ name: 'helius', url: heliusUrl, priority: 1 });
    }

    // Secondary: Custom RPC (if different from Helius)
    if (config.RPC_URL && !config.RPC_URL.includes('helius')) {
      endpointConfigs.push({ name: 'custom', url: config.RPC_URL, priority: 2 });
    }

    // Tertiary: Triton (if configured)
    if (process.env.TRITON_API_KEY) {
      const tritonUrl = isMainnet
        ? `https://mainnet.triton.one/?api-key=${process.env.TRITON_API_KEY}`
        : `https://devnet.triton.one/?api-key=${process.env.TRITON_API_KEY}`;
      endpointConfigs.push({ name: 'triton', url: tritonUrl, priority: 3 });
    }

    // Fallback: Public RPCs (always available, lowest priority)
    const publicUrl = isMainnet
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com';
    endpointConfigs.push({ name: 'public', url: publicUrl, priority: 100 });

    // Create endpoints
    for (const cfg of endpointConfigs) {
      this.endpoints.push(new RpcEndpoint(cfg.name, cfg.url, cfg.priority));
    }

    // Sort by priority
    this.endpoints.sort((a, b) => a.priority - b.priority);

    logger.info('RPC_POOL', 'Initialized', {
      endpoints: this.endpoints.map(e => e.name),
      primary: this.endpoints[0]?.name,
    });

    this.initialized = true;
  }

  getHealthyEndpoints() {
    return this.endpoints.filter(e => e.isHealthy());
  }

  getPrimaryEndpoint() {
    const healthy = this.getHealthyEndpoints();
    if (healthy.length === 0) {
      // All circuits open - force try primary anyway
      logger.warn('RPC_POOL', 'All endpoints unhealthy, forcing primary');
      return this.endpoints[0];
    }
    return healthy[0];
  }

  async executeWithFailover(operation, operationName = 'rpc_call') {
    this.initialize();

    const tried = new Set();
    let lastError = null;

    // Try endpoints in priority order
    for (const endpoint of this.endpoints) {
      if (tried.has(endpoint.name)) continue;
      if (!endpoint.isHealthy() && tried.size < this.endpoints.length - 1) {
        // Skip unhealthy unless it's our last option
        continue;
      }

      tried.add(endpoint.name);

      try {
        const result = await endpoint.execute(operation);

        if (tried.size > 1) {
          logger.info('RPC_POOL', 'Failover succeeded', {
            operation: operationName,
            endpoint: endpoint.name,
            attemptNumber: tried.size,
          });
        }

        return result;
      } catch (error) {
        lastError = error;

        logger.warn('RPC_POOL', 'Endpoint failed', {
          operation: operationName,
          endpoint: endpoint.name,
          error: error.message,
          willRetry: tried.size < this.endpoints.length,
        });

        // Continue to next endpoint
      }
    }

    // All endpoints failed
    logger.error('RPC_POOL', 'All endpoints failed', {
      operation: operationName,
      tried: Array.from(tried),
      lastError: lastError?.message,
    });

    throw lastError || new Error('All RPC endpoints failed');
  }

  getStatus() {
    this.initialize();

    const healthyCount = this.getHealthyEndpoints().length;
    const primary = this.getPrimaryEndpoint();

    return {
      status: healthyCount === 0 ? 'CRITICAL' : healthyCount < this.endpoints.length ? 'DEGRADED' : 'HEALTHY',
      totalEndpoints: this.endpoints.length,
      healthyEndpoints: healthyCount,
      primary: primary?.name,
      endpoints: this.endpoints.map(e => e.getStatus()),
    };
  }

  // Direct connection access for specific use cases
  getConnection() {
    this.initialize();
    return this.getPrimaryEndpoint().getConnection();
  }
}

// Singleton pool
const pool = new RpcPool();

// =============================================================================
// Exported Functions (backwards compatible API)
// =============================================================================

function getConnection() {
  return pool.getConnection();
}

async function getLatestBlockhash() {
  return pool.executeWithFailover(
    async (conn) => conn.getLatestBlockhash('confirmed'),
    'getLatestBlockhash'
  );
}

async function sendTransaction(signedTx) {
  return pool.executeWithFailover(
    async (conn) => {
      const signature = await conn.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });
      return signature;
    },
    'sendTransaction'
  );
}

async function confirmTransaction(signature, blockhash, lastValidBlockHeight) {
  return pool.executeWithFailover(
    async (conn) => {
      const result = await conn.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed'
      );
      return result;
    },
    'confirmTransaction'
  );
}

async function getBalance(pubkey) {
  return pool.executeWithFailover(
    async (conn) => conn.getBalance(pubkey),
    'getBalance'
  );
}

async function getTokenBalance(pubkey, mint) {
  return pool.executeWithFailover(
    async (conn) => {
      const tokenAccounts = await conn.getTokenAccountsByOwner(pubkey, { mint });
      if (tokenAccounts.value.length === 0) return 0;

      const balance = await conn.getTokenAccountBalance(tokenAccounts.value[0].pubkey);
      return parseInt(balance.value.amount);
    },
    'getTokenBalance'
  );
}

async function isBlockhashValid(blockhash) {
  try {
    const result = await pool.executeWithFailover(
      async (conn) => conn.isBlockhashValid(blockhash, { commitment: 'confirmed' }),
      'isBlockhashValid'
    );
    return result.value;
  } catch (error) {
    // If RPC fails, we can't determine validity - reject for safety
    return false;
  }
}

async function simulateTransaction(signedTx) {
  try {
    const result = await pool.executeWithFailover(
      async (conn) => {
        return conn.simulateTransaction(signedTx, {
          sigVerify: true,
          commitment: 'confirmed',
        });
      },
      'simulateTransaction'
    );

    if (result.value.err) {
      return {
        success: false,
        error: JSON.stringify(result.value.err),
        logs: result.value.logs || [],
        unitsConsumed: result.value.unitsConsumed,
      };
    }

    return {
      success: true,
      logs: result.value.logs || [],
      unitsConsumed: result.value.unitsConsumed,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      logs: [],
    };
  }
}

// Health check for /health endpoint
function getRpcHealth() {
  return pool.getStatus();
}

module.exports = {
  getConnection,
  getLatestBlockhash,
  sendTransaction,
  confirmTransaction,
  getBalance,
  getTokenBalance,
  isBlockhashValid,
  simulateTransaction,
  getRpcHealth,

  // Expose pool for advanced use cases
  pool,
};
