/**
 * Tests for the hybrid fee schedule (pure, offline).
 */

const { computeFeeBreakdown, DEFAULTS } = require('../../../src/services/fee-schedule');

test('flat fee for a light tx', () => {
  const f = computeFeeBreakdown({ requestedCus: 200000, priorityFeeLamports: 200 });
  expect(f.accepted).toBe(true);
  expect(f.cus).toBe(200000);
  expect(f.cuCharge).toBe(200 * DEFAULTS.CU_PRICE_PER_KCU_LAMPORTS);
  expect(f.total).toBe(f.base + f.cuCharge + 200);
});

test('compute-heavy tx pays proportionally more', () => {
  const light = computeFeeBreakdown({ requestedCus: 50000, priorityFeeLamports: 0 });
  const heavy = computeFeeBreakdown({ requestedCus: 400000, priorityFeeLamports: 0 });
  expect(heavy.total).toBeGreaterThan(light.total);
  expect(heavy.cuCharge).toBe(8 * light.cuCharge);
});

test('above protocol max is refused, never overcharged', () => {
  const f = computeFeeBreakdown({ requestedCus: 1400001, priorityFeeLamports: 0 });
  expect(f.accepted).toBe(false);
  expect(f.code).toBe('CU_OVER_CAP');
});

test('invalid CU input fails closed', () => {
  expect(computeFeeBreakdown({ requestedCus: 0 }).accepted).toBe(false);
  expect(computeFeeBreakdown({ requestedCus: -5 }).accepted).toBe(false);
});
