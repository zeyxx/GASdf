/**
 * Redis utility — Phase 0 in-memory fallback.
 *
 * No stateful server in Phase 0: every method below is an ephemeral,
 * single-process implementation of the interface the routes expect.
 * A real Redis client can replace this module later without touching
 * callers, once a phase actually needs persistence.
 */

const quotes = new Map();
const rateLimits = new Map();
const stats = { burnTotal: 0, burnProofs: [], treasuryEvents: [], txVelocity: [] };

async function ping() {
  return { connected: false, fallback: 'memory' };
}

async function getQuote(id) {
  return quotes.get(id) || null;
}

async function setQuote(id, value) {
  quotes.set(id, value);
  return true;
}

async function deleteQuote(id) {
  return quotes.delete(id);
}

async function incrWalletRateLimit(wallet, type) {
  const key = `${wallet}:${type}`;
  const count = (rateLimits.get(key) || 0) + 1;
  rateLimits.set(key, count);
  return count;
}

async function getCachedJupiterQuote() {
  return null;
}

async function cacheJupiterQuote() {
  return true;
}

function getJupiterCacheStats() {
  return { hits: 0, misses: 0, fallback: 'memory' };
}

async function withLock(_name, fn) {
  return fn();
}

async function incrBurnTotal(amount) {
  stats.burnTotal += amount;
  return stats.burnTotal;
}

async function recordBurnProof(proof) {
  stats.burnProofs.push(proof);
  return true;
}

async function getBurnerCount() {
  return 0;
}

async function getTreasuryBalance() {
  return 0;
}

async function getVelocityMetrics() {
  return { required: 0, fallback: 'memory' };
}

async function calculateVelocityBasedBuffer() {
  return null;
}

async function recordTransactionVelocity(entry) {
  stats.txVelocity.push(entry);
  return true;
}

async function recordTreasuryEvent(event) {
  stats.treasuryEvents.push(event);
  return true;
}

function getStats() {
  return { burnTotal: stats.burnTotal, fallback: 'memory' };
}

function getClient() {
  return null;
}

module.exports = {
  ping,
  getQuote,
  setQuote,
  deleteQuote,
  incrWalletRateLimit,
  getCachedJupiterQuote,
  cacheJupiterQuote,
  getJupiterCacheStats,
  withLock,
  incrBurnTotal,
  recordBurnProof,
  getBurnerCount,
  getTreasuryBalance,
  getVelocityMetrics,
  calculateVelocityBasedBuffer,
  recordTransactionVelocity,
  recordTreasuryEvent,
  getStats,
  getClient,
};
