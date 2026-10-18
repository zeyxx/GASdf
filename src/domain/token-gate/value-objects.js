/**
 * Value objects for the GASdf token-gate domain.
 */

class TokenMint {
  /**
   * @param {string} value - base58 mint address (32-44 chars)
   */
  constructor(value) {
    if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
      throw new Error(`TokenMint must be a valid base58 address (32-44 chars), got ${value}`);
    }
    this._value = value;
    Object.freeze(this);
  }

  get value() {
    return this._value;
  }

  toString() {
    return this._value;
  }

  equals(other) {
    return other instanceof TokenMint && other._value === this._value;
  }
}

module.exports = { TokenMint };