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

  it('should include optional status code', () => {
    const error = new GASdfError('Test', 'TEST', 400);
    expect(error.statusCode).toBe(400);
  });
});

describe('QuoteExpiredError', () => {
  it('should create error with quote ID', () => {
    const error = new QuoteExpiredError('abc-123');
    expect(error.message).toContain('abc-123');
    expect(error.code).toBe('QUOTE_EXPIRED');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('QuoteExpiredError');
  });
});

describe('QuoteNotFoundError', () => {
  it('should create error with quote ID', () => {
    const error = new QuoteNotFoundError('abc-123');
    expect(error.message).toContain('abc-123');
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
    const error = new ValidationError('Invalid', ['field1 required', 'field2 invalid']);
    expect(error.errors).toEqual(['field1 required', 'field2 invalid']);
  });
});

describe('TransactionError', () => {
  it('should create error with message', () => {
    const error = new TransactionError('TX failed');
    expect(error.message).toBe('TX failed');
    expect(error.code).toBe('TRANSACTION_ERROR');
    expect(error.statusCode).toBe(500);
  });

  it('should include optional signature', () => {
    const error = new TransactionError('Failed', 'abc123sig');
    expect(error.signature).toBe('abc123sig');
  });
});

describe('RateLimitError', () => {
  it('should create error with retry info', () => {
    const error = new RateLimitError(60);
    expect(error.code).toBe('RATE_LIMIT');
    expect(error.statusCode).toBe(429);
    expect(error.retryAfter).toBe(60);
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
  it('should parse 400 expired quote error', () => {
    const error = parseApiError(400, { error: 'Quote has expired', quoteId: 'q123' });
    expect(error).toBeInstanceOf(QuoteExpiredError);
  });

  it('should parse 400 validation error', () => {
    const error = parseApiError(400, { error: 'Invalid input', errors: ['bad field'] });
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors).toEqual(['bad field']);
  });

  it('should parse 404 quote not found', () => {
    const error = parseApiError(404, { error: 'Quote not found', quoteId: 'q123' });
    expect(error).toBeInstanceOf(QuoteNotFoundError);
  });

  it('should parse 404 generic not found', () => {
    const error = parseApiError(404, { error: 'Resource not found' });
    expect(error).toBeInstanceOf(GASdfError);
    expect(error.code).toBe('NOT_FOUND');
  });

  it('should parse 429 rate limit', () => {
    const error = parseApiError(429, { error: 'Too many requests' });
    expect(error).toBeInstanceOf(RateLimitError);
  });

  it('should parse 500 server error', () => {
    const error = parseApiError(500, { error: 'Internal error' });
    expect(error).toBeInstanceOf(GASdfError);
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.statusCode).toBe(500);
  });

  it('should parse 502 gateway error', () => {
    const error = parseApiError(502, { error: 'Bad gateway' });
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.statusCode).toBe(502);
  });

  it('should parse 503 service unavailable', () => {
    const error = parseApiError(503, { error: 'Unavailable' });
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.statusCode).toBe(503);
  });

  it('should handle unknown status codes', () => {
    const error = parseApiError(418, { error: "I'm a teapot" });
    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.statusCode).toBe(418);
  });

  it('should handle string body', () => {
    const error = parseApiError(400, 'String error message');
    expect(error.message).toBe('String error message');
  });

  it('should handle missing error field', () => {
    const error = parseApiError(500, {});
    expect(error.message).toBe('Unknown error');
  });
});
