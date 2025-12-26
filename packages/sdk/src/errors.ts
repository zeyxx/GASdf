/**
 * Base error class for GASdf SDK
 */
export class GASdfError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'GASdfError';
  }
}

/**
 * Quote has expired - request a new one
 */
export class QuoteExpiredError extends GASdfError {
  constructor(quoteId: string) {
    super(`Quote ${quoteId} has expired`, 'QUOTE_EXPIRED', 400);
    this.name = 'QuoteExpiredError';
  }
}

/**
 * Quote not found - may have been used or never existed
 */
export class QuoteNotFoundError extends GASdfError {
  constructor(quoteId: string) {
    super(`Quote ${quoteId} not found`, 'QUOTE_NOT_FOUND', 404);
    this.name = 'QuoteNotFoundError';
  }
}

/**
 * Transaction validation failed
 */
export class ValidationError extends GASdfError {
  constructor(
    message: string,
    public readonly errors: string[] = [],
  ) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

/**
 * Transaction was rejected by the network
 */
export class TransactionError extends GASdfError {
  constructor(
    message: string,
    public readonly signature?: string,
  ) {
    super(message, 'TRANSACTION_ERROR', 500);
    this.name = 'TransactionError';
  }
}

/**
 * Rate limit exceeded
 */
export class RateLimitError extends GASdfError {
  constructor(public readonly retryAfter?: number) {
    super('Rate limit exceeded', 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
  }
}

/**
 * Network or connection error
 */
export class NetworkError extends GASdfError {
  constructor(message: string) {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

/**
 * Parse API error response into appropriate error class
 */
export function parseApiError(
  status: number,
  body: { error?: string; errors?: string[]; quoteId?: string } | string,
): GASdfError {
  const data = typeof body === 'string' ? { error: body } : body;
  const message = data.error || 'Unknown error';

  switch (status) {
    case 400:
      if (message.includes('expired')) {
        return new QuoteExpiredError(data.quoteId || 'unknown');
      }
      return new ValidationError(message, data.errors);
    case 404:
      if (message.includes('quote') || message.includes('Quote')) {
        return new QuoteNotFoundError(data.quoteId || 'unknown');
      }
      return new GASdfError(message, 'NOT_FOUND', 404);
    case 429:
      return new RateLimitError();
    case 500:
    case 502:
    case 503:
      return new GASdfError(message, 'SERVER_ERROR', status);
    default:
      return new GASdfError(message, 'UNKNOWN_ERROR', status);
  }
}
