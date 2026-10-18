/**
 * Value objects for the GASdf validation domain.
 */

const { PublicKey } = require('@solana/web3.js');

class SolanaAddress {
  constructor(value) {
    if (typeof value !== 'string' || value === '') {
      throw new Error(`SolanaAddress must be a non-empty string, got ${value}`);
    }
    try {
      new PublicKey(value);
    } catch {
      throw new Error(`SolanaAddress must be a valid Solana public key, got ${value}`);
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
    return other instanceof SolanaAddress && other._value === this._value;
  }
}

class Base64String {
  constructor(value) {
    if (typeof value !== 'string' || value === '') {
      throw new Error(`Base64String must be a non-empty string`);
    }
    try {
      if (Buffer.from(value, 'base64').toString('base64') !== value) {
        throw new Error('invalid base64');
      }
    } catch {
      throw new Error(`Base64String must be valid base64, got ${value.slice(0, 20)}`);
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
    return other instanceof Base64String && other._value === this._value;
  }
}

class Uuid {
  constructor(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error(`Uuid must be a valid UUID v4, got ${value}`);
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
    return other instanceof Uuid && other._value === this._value;
  }
}

module.exports = { SolanaAddress, Base64String, Uuid };