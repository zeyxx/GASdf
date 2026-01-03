/**
 * GASdf Revenue Channels - Clear Nomenclature
 *
 * =============================================================================
 * FLUX MATRIX - $ASDF Ecosystem Economics
 * =============================================================================
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                           REVENUE SOURCES                                   │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │  FEE_ASDF          │ User pays fee in $ASDF token                          │
 * │  FEE_TOKEN         │ User pays fee in other SPL token (USDC, SOL, etc.)    │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *                                      │
 *                                      ▼
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                           PROCESSING CHANNELS                               │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │                                                                             │
 * │  ┌─────────────────────────────────────────────────────────────────────┐   │
 * │  │  CHANNEL: PURIST (FEE_ASDF only)                                    │   │
 * │  │  ─────────────────────────────────────────────────────────────────  │   │
 * │  │  $ASDF Fee ──────────────────────────────────────► BURN_DIRECT      │   │
 * │  │              100% burned (0 swaps, maximum deflation)               │   │
 * │  └─────────────────────────────────────────────────────────────────────┘   │
 * │                                                                             │
 * │  ┌─────────────────────────────────────────────────────────────────────┐   │
 * │  │  CHANNEL: UNIFIED (FEE_TOKEN only)                                  │   │
 * │  │  ─────────────────────────────────────────────────────────────────  │   │
 * │  │                                                                     │   │
 * │  │  Token Fee ─┬─► BURN_ECOSYSTEM (0-38.2%)                            │   │
 * │  │             │   Direct token burn (dual-burn flywheel bonus)        │   │
 * │  │             │                                                       │   │
 * │  │             └─► SWAP_TO_ASDF (61.8-100%)                            │   │
 * │  │                      │                                              │   │
 * │  │                      ├─► BURN_SWAP (76.4% of swap)                  │   │
 * │  │                      │   $ASDF burned from swap proceeds            │   │
 * │  │                      │                                              │   │
 * │  │                      └─► TREASURY_RETAIN (23.6% of swap)            │   │
 * │  │                          $ASDF kept in treasury                     │   │
 * │  └─────────────────────────────────────────────────────────────────────┘   │
 * │                                                                             │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *                                      │
 *                                      ▼
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                           TREASURY OPERATIONS                               │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │  TREASURY_RETAIN   │ $ASDF kept from unified channel (23.6%)               │
 * │  TREASURY_REFILL   │ $ASDF → SOL swap when fee payer < 0.1 SOL             │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *                                      │
 *                                      ▼
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                           BURN DESTINATIONS                                 │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │  BURN_DIRECT       │ $ASDF burned directly (purist channel)                │
 * │  BURN_SWAP         │ $ASDF burned from swap proceeds (unified channel)     │
 * │  BURN_ECOSYSTEM    │ Token burned directly (dual-burn flywheel)            │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * =============================================================================
 * GOLDEN RATIO ECONOMICS (φ = 1.618033988749)
 * =============================================================================
 *
 * Treasury Ratio:    1/φ³ = 23.6%
 * Burn Ratio:        1 - 1/φ³ = 76.4%
 * Max Ecosystem:     1/φ² = 38.2%
 *
 * =============================================================================
 */

// Revenue source types
const REVENUE_SOURCE = {
  FEE_ASDF: 'fee_asdf', // User paid fee in $ASDF
  FEE_TOKEN: 'fee_token', // User paid fee in other token
};

// Processing channels
const CHANNEL = {
  PURIST: 'purist', // $ASDF → 100% burn
  UNIFIED: 'unified', // Token → $ASDF → burn/treasury split
};

// Burn types
const BURN_TYPE = {
  DIRECT: 'burn_direct', // $ASDF burned directly (purist)
  SWAP: 'burn_swap', // $ASDF burned from swap (unified)
  ECOSYSTEM: 'burn_ecosystem', // Token burned directly (flywheel)
};

// Treasury event types
const TREASURY_EVENT = {
  RETAIN: 'treasury_retain', // $ASDF kept from unified channel
  REFILL: 'treasury_refill', // $ASDF → SOL for fee payer
};

// Proof/record types for transparency
const PROOF_TYPE = {
  BURN_BATCH: 'burn_batch', // Batched burn transaction
  SWAP_TO_ASDF: 'swap_to_asdf', // Token → $ASDF swap
  TREASURY_SWAP: 'treasury_swap', // $ASDF → SOL for operations
};

/**
 * Create a standardized revenue event
 */
function createRevenueEvent({
  source,
  channel,
  tokenMint,
  tokenSymbol,
  inputAmount,
  burns = [],
  treasuryAmount = 0,
  signatures = [],
}) {
  return {
    timestamp: Date.now(),
    source,
    channel,
    input: {
      mint: tokenMint,
      symbol: tokenSymbol,
      amount: inputAmount,
    },
    burns: burns.map((b) => ({
      type: b.type,
      mint: b.mint,
      amount: b.amount,
    })),
    treasury: {
      amount: treasuryAmount,
      type: treasuryAmount > 0 ? TREASURY_EVENT.RETAIN : null,
    },
    signatures,
  };
}

/**
 * Calculate flow distribution for a token fee
 * @param {number} amount - Input amount
 * @param {number} ecosystemBurnPct - Ecosystem burn bonus (0-0.382)
 * @param {number} burnRatio - Burn ratio (0.764)
 * @returns {Object} Flow distribution
 */
function calculateFlowDistribution(amount, ecosystemBurnPct = 0, burnRatio = 0.764) {
  const ecosystemBurn = Math.floor(amount * ecosystemBurnPct);
  const toSwap = amount - ecosystemBurn;

  // After swap to $ASDF (assuming 1:1 for calculation)
  const burnFromSwap = Math.floor(toSwap * burnRatio);
  const treasuryRetain = toSwap - burnFromSwap;

  return {
    input: amount,
    flows: {
      [BURN_TYPE.ECOSYSTEM]: ecosystemBurn,
      [BURN_TYPE.SWAP]: burnFromSwap,
      [TREASURY_EVENT.RETAIN]: treasuryRetain,
    },
    totals: {
      burned: ecosystemBurn + burnFromSwap,
      treasury: treasuryRetain,
      burnPercent: (((ecosystemBurn + burnFromSwap) / amount) * 100).toFixed(1),
    },
  };
}

/**
 * Format flow for logging
 */
function formatFlowLog(source, channel, distribution) {
  const { input, flows, totals } = distribution;

  return {
    source,
    channel,
    input,
    ecosystem_burn: flows[BURN_TYPE.ECOSYSTEM] || 0,
    swap_burn: flows[BURN_TYPE.SWAP] || 0,
    treasury: flows[TREASURY_EVENT.RETAIN] || 0,
    total_burned: totals.burned,
    burn_percent: totals.burnPercent + '%',
  };
}

module.exports = {
  // Enums
  REVENUE_SOURCE,
  CHANNEL,
  BURN_TYPE,
  TREASURY_EVENT,
  PROOF_TYPE,

  // Helpers
  createRevenueEvent,
  calculateFlowDistribution,
  formatFlowLog,
};
