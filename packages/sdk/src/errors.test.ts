import { describe, it, expect } from 'vitest';
import {
  GASdfError,
  QuoteExpiredError,
  QuoteNotFoundError,
  ValidationError,
  TransactionError,
  RateLimitError,
  NetworkError,
  parseApiError,
} from './errors';

describe('GASdfError', () => {
  it('should create error with message and code', () => {
    const error = new GASdfError('Test error', 'TEST_CODE');
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.name).toBe('GASdfError');
  });

  it('should include statusCode when provided', () => {
    const error = new GASdfError('Test error', 'TEST_CODE', 500);
    expect(error.statusCode).toBe(500);
  });
});

describe('QuoteExpiredError', () => {
  it('should create error with quote ID', () => {
    const error = new QuoteExpiredError('quote-123');
    expect(error.message).toBe('Quote quote-123 has expired');
    expect(error.code).toBe('QUOTE_EXPIRED');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('QuoteExpiredError');
  });
});

describe('QuoteNotFoundError', () => {
  it('should create error with quote ID', () => {
    const error = new QuoteNotFoundError('quote-456');
    expect(error.message).toBe('Quote quote-456 not found');
    expect(error.code).toBe('QUOTE_NOT_FOUND');
    expect(error.statusCode).toBe(404);
    expect(error.name).toBe('QuoteNotFoundError');
  });
});

describe('ValidationError', () => {
  it('should create error with message', () => {
    const error = new ValidationError('Invalid input');
    expect(error.message).toBe('Invalid input');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.errors).toEqual([]);
  });

  it('should include validation errors array', () => {
    const error = new ValidationError('Invalid input', ['field1 required', 'field2 invalid']);
    expect(error.errors).toEqual(['field1 required', 'field2 invalid']);
  });
});

describe('TransactionError', () => {
  it('should create error with message', () => {
    const error = new TransactionError('Transaction failed');
    expect(error.message).toBe('Transaction failed');
    expect(error.code).toBe('TRANSACTION_ERROR');
    expect(error.statusCode).toBe(500);
  });

  it('should include signature when provided', () => {
    const error = new TransactionError('Failed', 'sig123');
    expect(error.signature).toBe('sig123');
  });
});

describe('RateLimitError', () => {
  it('should create error with default message', () => {
    const error = new RateLimitError();
    expect(error.message).toBe('Rate limit exceeded');
    expect(error.code).toBe('RATE_LIMIT');
    expect(error.statusCode).toBe(429);
  });

  it('should include retryAfter when provided', () => {
    const error = new RateLimitError(30);
    expect(error.retryAfter).toBe(30);
  });
});

describe('NetworkError', () => {
  it('should create error with message', () => {
    const error = new NetworkError('Connection refused');
    expect(error.message).toBe('Connection refused');
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.name).toBe('NetworkError');
  });
});

describe('parseApiError', () => {
  it('should parse 400 with expired as QuoteExpiredError', () => {
    const error = parseApiError(400, { error: 'Quote expired', quoteId: 'q123' });
    expect(error).toBeInstanceOf(QuoteExpiredError);
  });

  it('should parse 400 as ValidationError', () => {
    const error = parseApiError(400, { error: 'Invalid', errors: ['bad'] });
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors).toEqual(['bad']);
  });

  it('should parse 404 with quote as QuoteNotFoundError', () => {
    const error = parseApiError(404, { error: 'Quote not found' });
    expect(error).toBeInstanceOf(QuoteNotFoundError);
  });

  it('should parse 404 as generic NOT_FOUND', () => {
    const error = parseApiError(404, { error: 'Resource not found' });
    expect(error.code).toBe('NOT_FOUND');
  });

  it('should parse 429 as RateLimitError', () => {
    const error = parseApiError(429, { error: 'Too many requests' });
    expect(error).toBeInstanceOf(RateLimitError);
  });

  it('should parse 500/502/503 as SERVER_ERROR', () => {
    expect(parseApiError(500, {}).code).toBe('SERVER_ERROR');
    expect(parseApiError(502, {}).code).toBe('SERVER_ERROR');
    expect(parseApiError(503, {}).code).toBe('SERVER_ERROR');
  });

  it('should parse unknown status as UNKNOWN_ERROR', () => {
    const error = parseApiError(418, { error: 'Teapot' });
    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.statusCode).toBe(418);
  });

  it('should handle string body', () => {
    const error = parseApiError(400, 'Plain error');
    expect(error.message).toBe('Plain error');
  });
});
