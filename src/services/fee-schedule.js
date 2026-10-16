/**
 * Fee schedule — pure hybrid billing (base + compute + priority).
 *
 * fee = BASE + CU_PRICE_PER_KCU × ceil(min(CUs, CU_CAP) / 1000) + priority
 *
 * No tiers, no scores. All params operator-tunable; this module only
 * computes. CU_CAP refuses abusive transactions instead of overcharging.
 */

const DEFAULTS = {
  BASE_FEE_LAMPORTS: 50000,
  CU_PRICE_PER_KCU_LAMPORTS: 100,
  CU_CAP: 1400000,
};

/**
 * @param {Object} p
 * @param {number} p.baseFeeLamports
 * @param {number} p.cuPricePerKcuLamports
 * @param {number} p.cuCap
 * @param {number} p.requestedCus
 * @param {number} p.priorityFeeLamports
 * @returns {{accepted: boolean, code?: string, cus?: number, base?: number,
 *   cuCharge?: number, priority?: number, total?: number}}
 */
function computeFeeBreakdown(p) {
  const base = p.baseFeeLamports ?? DEFAULTS.BASE_FEE_LAMPORTS;
  const cuPrice = p.cuPricePerKcuLamports ?? DEFAULTS.CU_PRICE_PER_KCU_LAMPORTS;
  const cap = p.cuCap ?? DEFAULTS.CU_CAP;
  const requested = Math.floor(p.requestedCus ?? 200000);
  const priority = Math.max(0, Math.floor(p.priorityFeeLamports ?? 0));

  if (!Number.isFinite(requested) || requested < 1) {
    return { accepted: false, code: 'INVALID_CU' };
  }
  if (requested > cap) {
    return { accepted: false, code: 'CU_OVER_CAP', cus: requested };
  }

  const cus = requested;
  const cuCharge = Math.ceil(cus / 1000) * cuPrice;
  return {
    accepted: true,
    cus,
    base,
    cuCharge,
    priority,
    total: base + cuCharge + priority,
  };
}

module.exports = { computeFeeBreakdown, DEFAULTS };
