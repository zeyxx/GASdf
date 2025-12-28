/**
 * Safe Math Utilities
 * Prevents numeric overflow, underflow, and precision issues
 */

// JavaScript's max safe integer: 9,007,199,254,740,991
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const MIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER;

// Solana-specific limits
const MAX_LAMPORTS = 18_446_744_073_709_551_615n; // u64 max
const MAX_COMPUTE_UNITS = 1_400_000;
const MAX_TOKEN_AMOUNT = BigInt('18446744073709551615'); // u64 max for token amounts

/**
 * Check if a number is within safe integer range
 */
function isSafeInteger(value) {
  return Number.isSafeInteger(value);
}

/**
 * Safe multiplication with overflow check
 * Returns null if result would overflow
 */
function safeMul(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') {
    return null;
  }

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }

  const result = a * b;

  if (!Number.isFinite(result)) {
    return null;
  }

  // Check for precision loss on large integers
  if (Number.isInteger(a) && Number.isInteger(b) && !Number.isSafeInteger(result)) {
    return null;
  }

  return result;
}

/**
 * Safe division with zero check
 * Returns null if divisor is zero or result is invalid
 */
function safeDiv(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') {
    return null;
  }

  if (b === 0) {
    return null;
  }

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }

  const result = a / b;

  if (!Number.isFinite(result)) {
    return null;
  }

  return result;
}

/**
 * Safe addition with overflow check
 */
function safeAdd(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') {
    return null;
  }

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }

  const result = a + b;

  if (!Number.isFinite(result)) {
    return null;
  }

  return result;
}

/**
 * Safe subtraction with underflow check
 */
function safeSub(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') {
    return null;
  }

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }

  const result = a - b;

  if (!Number.isFinite(result)) {
    return null;
  }

  return result;
}

/**
 * Clamp a value between min and max
 */
function clamp(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * Safe ceiling that handles edge cases
 * Returns null for invalid inputs
 */
function safeCeil(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  if (value < 0) {
    // For negative values, ceil goes toward zero
    return Math.ceil(value);
  }

  const result = Math.ceil(value);

  if (!Number.isSafeInteger(result) && result > MAX_SAFE_INTEGER) {
    return null;
  }

  return result;
}

/**
 * Safe floor that handles edge cases
 */
function safeFloor(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const result = Math.floor(value);

  if (!Number.isSafeInteger(result) && Math.abs(result) > MAX_SAFE_INTEGER) {
    return null;
  }

  return result;
}

/**
 * Calculate fee with bounds checking
 * @param {number} computeUnits - Compute units (clamped to MAX_COMPUTE_UNITS)
 * @param {number} baseFee - Base fee in lamports
 * @param {number} multiplier - Fee multiplier
 * @returns {{ fee: number, capped: boolean } | null}
 */
function calculateFee(computeUnits, baseFee, multiplier = 1) {
  // Clamp compute units to valid range
  const clampedCU = clamp(computeUnits, 0, MAX_COMPUTE_UNITS);
  const capped = clampedCU !== computeUnits;

  // Priority fee: CU * micro-lamports rate
  // 0.000001 SOL per CU = 1000 lamports per CU at standard rate
  // We use 0.000001 * 1e9 = 1000 lamports per 1M CU = 0.001 lamports per CU
  const priorityFee = safeMul(clampedCU, 0.001); // lamports
  if (priorityFee === null) return null;

  const totalBase = safeAdd(baseFee, priorityFee);
  if (totalBase === null) return null;

  const adjustedFee = safeMul(totalBase, multiplier);
  if (adjustedFee === null) return null;

  const fee = safeCeil(adjustedFee);
  if (fee === null) return null;

  return { fee, capped };
}

/**
 * Safe token amount conversion
 * Converts between lamports and token units with precision handling
 * @param {number} lamports - Amount in lamports
 * @param {number} tokenDecimals - Token decimals (e.g., 6 for USDC, 9 for SOL)
 * @param {number} rate - Exchange rate (tokens per SOL)
 * @returns {number | null}
 */
function lamportsToTokens(lamports, tokenDecimals, rate) {
  if (lamports <= 0 || rate <= 0) {
    return 0;
  }

  // Convert lamports to SOL, then multiply by rate and token decimals
  // lamports / 1e9 * rate * 10^decimals
  const solAmount = safeDiv(lamports, 1e9);
  if (solAmount === null) return null;

  const tokenBase = safeMul(solAmount, rate);
  if (tokenBase === null) return null;

  const tokenUnits = safeMul(tokenBase, Math.pow(10, tokenDecimals));
  if (tokenUnits === null) return null;

  return safeCeil(tokenUnits);
}

/**
 * Safe proportional calculation with division-by-zero protection
 * Calculates: (a * b) / c
 * @returns {number | null}
 */
function safeProportion(a, b, c) {
  if (c === 0 || c === null || c === undefined) {
    return null;
  }

  const numerator = safeMul(a, b);
  if (numerator === null) return null;

  return safeDiv(numerator, c);
}

/**
 * Calculate 80/20 split with precision
 * Ensures no lamports are lost in the split
 * @param {number} total - Total amount in lamports
 * @param {number} burnRatio - Ratio for burn (e.g., 0.8)
 * @returns {{ burnAmount: number, treasuryAmount: number }}
 */
function calculateTreasurySplit(total, burnRatio = 0.8) {
  if (total <= 0 || !Number.isFinite(total)) {
    return { burnAmount: 0, treasuryAmount: 0 };
  }

  // Use floor for burn to ensure we don't over-burn
  const burnAmount = Math.floor(total * burnRatio);

  // Treasury gets the remainder - ensures no lamports lost
  const treasuryAmount = total - burnAmount;

  return { burnAmount, treasuryAmount };
}

/**
 * Validate a numeric value is within acceptable range for Solana
 * @param {number} value - Value to validate
 * @param {string} name - Name for error messages
 * @returns {{ valid: boolean, error?: string, value: number }}
 */
function validateSolanaAmount(value, name = 'amount') {
  if (typeof value !== 'number') {
    return { valid: false, error: `${name} must be a number`, value: 0 };
  }

  if (!Number.isFinite(value)) {
    return { valid: false, error: `${name} must be finite`, value: 0 };
  }

  if (value < 0) {
    return { valid: false, error: `${name} cannot be negative`, value: 0 };
  }

  if (!Number.isSafeInteger(value) && value > MAX_SAFE_INTEGER) {
    return { valid: false, error: `${name} exceeds safe integer range`, value: 0 };
  }

  return { valid: true, value };
}

module.exports = {
  // Constants
  MAX_SAFE_INTEGER,
  MIN_SAFE_INTEGER,
  MAX_LAMPORTS,
  MAX_COMPUTE_UNITS,
  MAX_TOKEN_AMOUNT,

  // Basic safe operations
  isSafeInteger,
  safeMul,
  safeDiv,
  safeAdd,
  safeSub,
  safeCeil,
  safeFloor,
  clamp,

  // Domain-specific helpers
  calculateFee,
  lamportsToTokens,
  safeProportion,
  calculateTreasurySplit,
  validateSolanaAmount,
};
