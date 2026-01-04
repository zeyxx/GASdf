/**
 * Resilient fetch utility with timeout, retry, and correlation IDs
 * Mirrors the patterns from @solana/keychain-core for unified resilience
 */

import { NetworkError, GASdfError } from './errors';
import type { RetryConfig } from './types';

export type { RetryConfig };

/** Options for fetchWithTimeout */
export interface FetchOptions extends RequestInit {
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Retry configuration */
  retry?: Partial<RetryConfig>;
  /** Correlation ID for request tracing */
  correlationId?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5_000,
  // 429 is NOT included - let client handle rate limiting via RateLimitError
  // Only retry on transient server errors
  retryableStatusCodes: [500, 502, 503, 504],
};

/**
 * Generate a correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `gasdf_${timestamp}_${random}`;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateBackoff(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * config.baseDelayMs;
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout, automatic retry, and correlation IDs
 *
 * @param url - Request URL
 * @param options - Fetch options with timeout and retry config
 * @returns Response object
 * @throws NetworkError on timeout or network failure
 * @throws RateLimitError on 429 after max retries
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryConfig: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...options.retry,
  };
  const correlationId = options.correlationId ?? generateCorrelationId();

  // Add correlation ID to headers (preserve original headers structure)
  const headersInit = options.headers instanceof Headers
    ? options.headers
    : options.headers || {};
  const headers: HeadersInit = {
    ...(headersInit as Record<string, string>),
    'x-correlation-id': correlationId,
  };

  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check if we should retry based on status code (transient server errors)
      if (
        retryConfig.retryableStatusCodes.includes(response.status) &&
        attempt < retryConfig.maxRetries
      ) {
        lastResponse = response;
        await sleep(calculateBackoff(attempt, retryConfig));
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      // Network errors (fetch throws) are not retried - throw immediately
      // Only HTTP status codes (429, 500, etc.) trigger retries
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new NetworkError(`Request timeout after ${timeoutMs}ms`);
        }
        throw new NetworkError(error.message);
      }
      throw new NetworkError('Unknown network error');
    }
  }

  // If we exhausted retries on a transient server error, throw
  if (lastResponse) {
    throw new GASdfError(
      `Request failed with status ${lastResponse.status} after ${retryConfig.maxRetries + 1} attempts`,
      'MAX_RETRIES_EXCEEDED',
      lastResponse.status,
    );
  }

  // Should never reach here, but just in case
  throw new NetworkError('Network error');
}
