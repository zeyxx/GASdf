/**
 * Tests for fee domain value objects (pure, offline).
 */

const { Lamports, ComputeUnits } = require('../../../../src/domain/fee/value-objects');

test('Lamports accepts non-negative integers', () => {
  const l = new Lamports(100);
  expect(l.value).toBe(100);
  expect(l.toString()).toBe('100 lamports');
});

test('Lamports rejects negatives and non-integers', () => {
  expect(() => new Lamports(-1)).toThrow();
  expect(() => new Lamports(1.5)).toThrow();
});

test('Lamports is frozen (immutable)', () => {
  const l = new Lamports(5);
  expect(Object.isFrozen(l)).toBe(true);
});

test('Lamports.add returns new instance', () => {
  const a = new Lamports(10);
  const b = new Lamports(20);
  const c = a.add(b);
  expect(c.value).toBe(30);
  expect(a.value).toBe(10); // unchanged
});

test('ComputeUnits accepts [1, 1400000]', () => {
  const c = new ComputeUnits(200000);
  expect(c.value).toBe(200000);
});

test('ComputeUnits rejects out of range', () => {
  expect(() => new ComputeUnits(0)).toThrow();
  expect(() => new ComputeUnits(1400001)).toThrow();
  expect(() => new ComputeUnits(-5)).toThrow();
});

test('ComputeUnits floors fractional input', () => {
  const c = new ComputeUnits(199999.7);
  expect(c.value).toBe(199999);
});