/**
 * Port: TokenListProvider
 *
 * Contract for fetching a list of tokens from an external source (HolDex).
 *
 * @typedef {Object} TokenListItem
 * @property {string} mint
 * @property {string} symbol
 * @property {string} [name]
 * @property {number} [decimals]
 *
 * @interface TokenListProvider
 * @method {Promise<TokenListItem[]>} fetchTokens(url: string)
 */

module.exports = {};