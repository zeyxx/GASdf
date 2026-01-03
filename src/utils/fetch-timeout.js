/**
 * Fetch with Timeout Utility
 * Prevents HTTP requests from hanging indefinitely
 */

const logger = require('./logger');

// Default timeouts (in milliseconds)
const DEFAULT_TIMEOUT = 10_000; // 10 seconds for general requests
const JUPITER_TIMEOUT = 15_000; // 15 seconds for Jupiter API (can be slow)
const WEBHOOK_TIMEOUT = 5_000; // 5 seconds for webhooks
const HEALTH_CHECK_TIMEOUT = 3_000; // 3 seconds for health checks

/**
 * Fetch with timeout protection
 * @param {string} url - URL to fetch
 * @param {RequestInit} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>}
 * @throws {Error} - Throws 'Request timeout' error on timeout
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
      timeoutError.code = 'TIMEOUT';
      timeoutError.url = url;
      timeoutError.timeoutMs = timeoutMs;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch JSON with timeout protection
 * Combines fetch + JSON parsing with single timeout
 * @param {string} url - URL to fetch
 * @param {RequestInit} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<any>} - Parsed JSON response
 */
async function fetchJsonWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const response = await fetchWithTimeout(url, options, timeoutMs);

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
    error.status = response.status;
    error.statusText = response.statusText;
    error.url = url;
    throw error;
  }

  return response.json();
}

/**
 * Create a promise that rejects after timeout
 * Useful for racing against long-running operations
 * @param {number} ms - Timeout in milliseconds
 * @param {string} operation - Name of operation (for error message)
 * @returns {Promise<never>}
 */
function timeoutPromise(ms, operation = 'Operation') {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const error = new Error(`${operation} timeout after ${ms}ms`);
      error.code = 'TIMEOUT';
      error.timeoutMs = ms;
      reject(error);
    }, ms);
  });
}

/**
 * Race a promise against a timeout
 * @param {Promise<T>} promise - Promise to race
 * @param {number} ms - Timeout in milliseconds
 * @param {string} operation - Name of operation (for error message)
 * @returns {Promise<T>}
 */
async function withTimeout(promise, ms, operation = 'Operation') {
  return Promise.race([promise, timeoutPromise(ms, operation)]);
}

/**
 * Retry a function with timeout on each attempt
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Max number of retries (default: 3)
 * @param {number} options.timeoutMs - Timeout per attempt (default: DEFAULT_TIMEOUT)
 * @param {number} options.delayMs - Delay between retries (default: 1000)
 * @param {string} options.operation - Operation name for logging
 * @returns {Promise<any>}
 */
async function retryWithTimeout(fn, options = {}) {
  const {
    maxRetries = 3,
    timeoutMs = DEFAULT_TIMEOUT,
    delayMs = 1000,
    operation = 'Operation',
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, operation);
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        logger.debug('FETCH', `${operation} attempt ${attempt} failed, retrying...`, {
          error: error.message,
          nextAttemptIn: delayMs,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

module.exports = {
  // Core functions
  fetchWithTimeout,
  fetchJsonWithTimeout,
  withTimeout,
  timeoutPromise,
  retryWithTimeout,

  // Default timeouts
  DEFAULT_TIMEOUT,
  JUPITER_TIMEOUT,
  WEBHOOK_TIMEOUT,
  HEALTH_CHECK_TIMEOUT,
};
