/**
 * GASdf SDK - Gasless transactions for Solana
 * Minimal SDK for easy integration
 */

const DEFAULT_BASE_URL = 'https://api.gasdf.io';

class GASdf {
  /**
   * @param {Object} options
   * @param {string} options.baseUrl - API base URL (default: https://api.gasdf.io)
   * @param {number} options.timeout - Request timeout in ms (default: 30000)
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.timeout = options.timeout || 30000;
  }

  /**
   * Get a fee quote for a gasless transaction
   * @param {string} paymentToken - Token mint address to pay fees with
   * @param {string} userPubkey - User's wallet public key
   * @param {Object} options - Optional parameters
   * @param {number} options.priorityLevel - Priority level (0-3)
   * @returns {Promise<Quote>}
   */
  async quote(paymentToken, userPubkey, options = {}) {
    const response = await this._fetch('/v1/quote', {
      method: 'POST',
      body: JSON.stringify({
        paymentToken,
        userPubkey,
        ...options,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new GASdfError(error.error || 'Quote failed', error.code, response.status);
    }

    return response.json();
  }

  /**
   * Submit a signed transaction
   * @param {string} quoteId - Quote ID from quote()
   * @param {string} signedTransaction - Base64 encoded signed transaction
   * @returns {Promise<SubmitResult>}
   */
  async submit(quoteId, signedTransaction) {
    const response = await this._fetch('/v1/submit', {
      method: 'POST',
      body: JSON.stringify({
        quoteId,
        signedTransaction,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new GASdfError(error.error || 'Submit failed', error.code, response.status);
    }

    return response.json();
  }

  /**
   * Get supported payment tokens
   * @returns {Promise<Token[]>}
   */
  async tokens() {
    const response = await this._fetch('/v1/tokens');
    if (!response.ok) {
      throw new GASdfError('Failed to fetch tokens', 'FETCH_ERROR', response.status);
    }
    return response.json();
  }

  /**
   * Get burn statistics
   * @returns {Promise<Stats>}
   */
  async stats() {
    const response = await this._fetch('/v1/stats');
    if (!response.ok) {
      throw new GASdfError('Failed to fetch stats', 'FETCH_ERROR', response.status);
    }
    return response.json();
  }

  /**
   * Get burn proofs (verifiable on-chain)
   * @param {number} limit - Number of proofs to fetch (default: 50)
   * @returns {Promise<BurnProofs>}
   */
  async burnProofs(limit = 50) {
    const response = await this._fetch(`/v1/stats/burns?limit=${limit}`);
    if (!response.ok) {
      throw new GASdfError('Failed to fetch burn proofs', 'FETCH_ERROR', response.status);
    }
    return response.json();
  }

  /**
   * Verify a burn by signature
   * @param {string} signature - Burn transaction signature
   * @returns {Promise<BurnProof>}
   */
  async verifyBurn(signature) {
    const response = await this._fetch(`/v1/stats/burns/${signature}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new GASdfError(error.error || 'Burn not found', 'NOT_FOUND', response.status);
    }
    return response.json();
  }

  /**
   * Check service health
   * @returns {Promise<Health>}
   */
  async health() {
    const response = await this._fetch('/v1/health');
    return response.json();
  }

  /**
   * Internal fetch wrapper
   */
  async _fetch(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * GASdf Error class
 */
class GASdfError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'GASdfError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Helper: Create transaction with GASdf fee payer
 * @param {Connection} connection - Solana connection
 * @param {Quote} quote - Quote from gasdf.quote()
 * @param {TransactionInstruction[]} instructions - Your transaction instructions
 * @returns {Transaction}
 */
function createGaslessTransaction(connection, quote, instructions) {
  const { Transaction, PublicKey } = require('@solana/web3.js');

  const transaction = new Transaction({
    feePayer: new PublicKey(quote.feePayer),
    recentBlockhash: quote.blockhash,
  });

  // Add fee payment instruction first
  if (quote.feeInstruction) {
    const { createTransferInstruction } = require('@solana/spl-token');
    const feeIx = createTransferInstruction(
      new PublicKey(quote.feeInstruction.source),
      new PublicKey(quote.feeInstruction.destination),
      new PublicKey(quote.feeInstruction.authority),
      BigInt(quote.feeInstruction.amount)
    );
    transaction.add(feeIx);
  }

  // Add user instructions
  for (const ix of instructions) {
    transaction.add(ix);
  }

  return transaction;
}

// CommonJS exports
module.exports = { GASdf, GASdfError, createGaslessTransaction };

// ESM named exports for bundlers
module.exports.GASdf = GASdf;
module.exports.GASdfError = GASdfError;
module.exports.createGaslessTransaction = createGaslessTransaction;
