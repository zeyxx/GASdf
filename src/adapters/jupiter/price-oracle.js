/**
 * Adapter: Jupiter PriceOracle
 *
 * Implements the PriceOracle port using the Jupiter service.
 */

const jupiter = require('../../services/jupiter');

/**
 * @param {string} mint - payment token mint
 * @param {number} lamports - fee in lamports
 * @returns {Promise<{inputAmount: number, symbol: string, decimals: number}>}
 */
async function getFeeInToken(mint, lamports) {
  return jupiter.getFeeInToken(mint, lamports);
}

module.exports = { getFeeInToken };