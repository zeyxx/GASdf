/**
 * Value objects for the GASdf fee domain.
 *
 * Immutable, self-validating. No I/O, no side effects.
 */

class Lamports {
  /**
   * @param {number} value - non-negative integer lamports
   */
  constructor(value) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Lamports must be a non-negative integer, got ${value}`);
    }
    this._value = value;
    Object.freeze(this);
  }

  get value() {
    return this._value;
  }

  add(other) {
    if (!(other instanceof Lamports)) throw new Error('Lamports.add expects Lamports');
    return new Lamports(this._value + other._value);
  }

  toString() {
    return `${this._value} lamports`;
  }

  equals(other) {
    return other instanceof Lamports && other._value === this._value;
  }
}

class ComputeUnits {
  /**
   * @param {number} value - integer CU in [1, 1_400_000]
   */
  constructor(value) {
    const v = Math.floor(value);
    if (!Number.isFinite(v) || v < 1 || v > 1_400_000) {
      throw new Error(`ComputeUnits must be in [1, 1400000], got ${value}`);
    }
    this._value = v;
    Object.freeze(this);
  }

  get value() {
    return this._value;
  }

  toString() {
    return `${this._value} CU`;
  }

  equals(other) {
    return other instanceof ComputeUnits && other._value === this._value;
  }
}

module.exports = { Lamports, ComputeUnits };