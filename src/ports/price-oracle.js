/**
 * Port: PriceOracle
 *
 * Contract for converting a fee amount from lamports to a payment token.
 * Implemented by adapters (Jupiter, mock, etc.).
 *
 * @typedef {Object} FeeInToken
 * @property {number} inputAmount - amount in token base units
 * @property {string} symbol - token symbol
 * @property {number} decimals - token decimals
 *
 * @interface PriceOracle
 * @method {Promise<FeeInToken>} getFeeInToken(mint: string, lamports: number)
 */

// Port is an interface (JSDoc). No implementation here.
module.exports = {};