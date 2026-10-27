/**
 * Tests for validation domain (pure, offline).
 */

const { isValidSolanaAddress, isValidBase64, isValidUUID } = require('../../../../src/domain/validation/validation');
const { SolanaAddress, Base64String, Uuid } = require('../../../../src/domain/validation/value-objects');

test('isValidSolanaAddress returns true for valid address', () => {
  expect(isValidSolanaAddress('So11111111111111111111111111111111111111112')).toBe(true);
  expect(isValidSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
});

test('isValidSolanaAddress returns false for invalid input', () => {
  expect(isValidSolanaAddress('invalid')).toBe(false);
  expect(isValidSolanaAddress(null)).toBe(false);
  expect(isValidSolanaAddress(123)).toBe(false);
  expect(isValidSolanaAddress('')).toBe(false);
});

test('isValidBase64 returns true for valid base64', () => {
  expect(isValidBase64(Buffer.from('hello').toString('base64'))).toBe(true);
});

test('isValidBase64 returns false for invalid input', () => {
  expect(isValidBase64('not-base64!!!')).toBe(false);
  expect(isValidBase64(null)).toBe(false);
  expect(isValidBase64('')).toBe(false);
});

test('isValidUUID returns true for valid UUID v4', () => {
  expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
});

test('isValidUUID returns false for invalid UUID', () => {
  expect(isValidUUID('not-a-uuid')).toBe(false);
  expect(isValidUUID(null)).toBe(false);
});

test('SolanaAddress value object validates at construction', () => {
  const a = new SolanaAddress('So11111111111111111111111111111111111111112');
  expect(a.value).toBe('So11111111111111111111111111111111111111112');
  expect(Object.isFrozen(a)).toBe(true);
  expect(() => new SolanaAddress('invalid')).toThrow();
});

test('Base64String value object validates at construction', () => {
  const b = new Base64String(Buffer.from('hi').toString('base64'));
  expect(b.value).toBe(Buffer.from('hi').toString('base64'));
  expect(() => new Base64String('!!!')).toThrow();
});

test('Uuid value object validates at construction', () => {
  const u = new Uuid('550e8400-e29b-41d4-a716-446655440000');
  expect(u.value).toBe('550e8400-e29b-41d4-a716-446655440000');
  expect(() => new Uuid('bad')).toThrow();
});