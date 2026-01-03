/**
 * Unit Tests for Revenue Channels
 */

const {
  REVENUE_SOURCE,
  CHANNEL,
  BURN_TYPE,
  TREASURY_EVENT,
  PROOF_TYPE,
  createRevenueEvent,
  calculateFlowDistribution,
  formatFlowLog,
} = require('../../../src/utils/revenue-channels');

describe('Revenue Channels', () => {
  // ==========================================================================
  // Constants/Enums
  // ==========================================================================

  describe('Constants', () => {
    describe('REVENUE_SOURCE', () => {
      it('should have FEE_ASDF', () => {
        expect(REVENUE_SOURCE.FEE_ASDF).toBe('fee_asdf');
      });

      it('should have FEE_TOKEN', () => {
        expect(REVENUE_SOURCE.FEE_TOKEN).toBe('fee_token');
      });
    });

    describe('CHANNEL', () => {
      it('should have PURIST', () => {
        expect(CHANNEL.PURIST).toBe('purist');
      });

      it('should have UNIFIED', () => {
        expect(CHANNEL.UNIFIED).toBe('unified');
      });
    });

    describe('BURN_TYPE', () => {
      it('should have DIRECT', () => {
        expect(BURN_TYPE.DIRECT).toBe('burn_direct');
      });

      it('should have SWAP', () => {
        expect(BURN_TYPE.SWAP).toBe('burn_swap');
      });

      it('should have ECOSYSTEM', () => {
        expect(BURN_TYPE.ECOSYSTEM).toBe('burn_ecosystem');
      });
    });

    describe('TREASURY_EVENT', () => {
      it('should have RETAIN', () => {
        expect(TREASURY_EVENT.RETAIN).toBe('treasury_retain');
      });

      it('should have REFILL', () => {
        expect(TREASURY_EVENT.REFILL).toBe('treasury_refill');
      });
    });

    describe('PROOF_TYPE', () => {
      it('should have BURN_BATCH', () => {
        expect(PROOF_TYPE.BURN_BATCH).toBe('burn_batch');
      });

      it('should have SWAP_TO_ASDF', () => {
        expect(PROOF_TYPE.SWAP_TO_ASDF).toBe('swap_to_asdf');
      });

      it('should have TREASURY_SWAP', () => {
        expect(PROOF_TYPE.TREASURY_SWAP).toBe('treasury_swap');
      });
    });
  });

  // ==========================================================================
  // createRevenueEvent
  // ==========================================================================

  describe('createRevenueEvent', () => {
    it('should create a basic revenue event', () => {
      const event = createRevenueEvent({
        source: REVENUE_SOURCE.FEE_ASDF,
        channel: CHANNEL.PURIST,
        tokenMint: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
        tokenSymbol: 'ASDF',
        inputAmount: 1000000,
      });

      expect(event).toHaveProperty('timestamp');
      expect(event.source).toBe('fee_asdf');
      expect(event.channel).toBe('purist');
      expect(event.input.mint).toBe('9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump');
      expect(event.input.symbol).toBe('ASDF');
      expect(event.input.amount).toBe(1000000);
    });

    it('should include burns array', () => {
      const event = createRevenueEvent({
        source: REVENUE_SOURCE.FEE_TOKEN,
        channel: CHANNEL.UNIFIED,
        tokenMint: 'USDC',
        tokenSymbol: 'USDC',
        inputAmount: 100000,
        burns: [
          { type: BURN_TYPE.SWAP, mint: 'ASDF', amount: 76400 },
          { type: BURN_TYPE.ECOSYSTEM, mint: 'USDC', amount: 0 },
        ],
      });

      expect(event.burns).toHaveLength(2);
      expect(event.burns[0]).toEqual({
        type: 'burn_swap',
        mint: 'ASDF',
        amount: 76400,
      });
    });

    it('should include treasury amount when provided', () => {
      const event = createRevenueEvent({
        source: REVENUE_SOURCE.FEE_TOKEN,
        channel: CHANNEL.UNIFIED,
        tokenMint: 'USDC',
        tokenSymbol: 'USDC',
        inputAmount: 100000,
        treasuryAmount: 23600,
      });

      expect(event.treasury.amount).toBe(23600);
      expect(event.treasury.type).toBe('treasury_retain');
    });

    it('should have null treasury type when amount is 0', () => {
      const event = createRevenueEvent({
        source: REVENUE_SOURCE.FEE_ASDF,
        channel: CHANNEL.PURIST,
        tokenMint: 'ASDF',
        tokenSymbol: 'ASDF',
        inputAmount: 100000,
        treasuryAmount: 0,
      });

      expect(event.treasury.amount).toBe(0);
      expect(event.treasury.type).toBeNull();
    });

    it('should include signatures when provided', () => {
      const event = createRevenueEvent({
        source: REVENUE_SOURCE.FEE_TOKEN,
        channel: CHANNEL.UNIFIED,
        tokenMint: 'USDC',
        tokenSymbol: 'USDC',
        inputAmount: 100000,
        signatures: ['sig1', 'sig2'],
      });

      expect(event.signatures).toEqual(['sig1', 'sig2']);
    });
  });

  // ==========================================================================
  // calculateFlowDistribution
  // ==========================================================================

  describe('calculateFlowDistribution', () => {
    it('should calculate with default burn ratio (76.4%)', () => {
      const result = calculateFlowDistribution(1000000);

      expect(result.input).toBe(1000000);
      expect(result.flows[BURN_TYPE.ECOSYSTEM]).toBe(0);
      expect(result.flows[BURN_TYPE.SWAP]).toBe(764000);
      expect(result.flows[TREASURY_EVENT.RETAIN]).toBe(236000);
      expect(result.totals.burned).toBe(764000);
      expect(result.totals.treasury).toBe(236000);
    });

    it('should calculate with ecosystem burn', () => {
      const result = calculateFlowDistribution(1000000, 0.382); // 38.2% ecosystem

      expect(result.flows[BURN_TYPE.ECOSYSTEM]).toBe(382000);
      // Remaining 618000 goes to swap
      // 618000 * 0.764 = 472152
      expect(result.flows[BURN_TYPE.SWAP]).toBe(472152);
      expect(result.flows[TREASURY_EVENT.RETAIN]).toBe(618000 - 472152);
    });

    it('should return correct burn percentage', () => {
      const result = calculateFlowDistribution(1000000);

      expect(result.totals.burnPercent).toBe('76.4');
    });

    it('should handle zero amount', () => {
      const result = calculateFlowDistribution(0);

      expect(result.input).toBe(0);
      expect(result.totals.burned).toBe(0);
      expect(result.totals.treasury).toBe(0);
    });

    it('should handle custom burn ratio', () => {
      const result = calculateFlowDistribution(1000000, 0, 0.8); // 80% burn

      expect(result.flows[BURN_TYPE.SWAP]).toBe(800000);
      expect(result.flows[TREASURY_EVENT.RETAIN]).toBe(200000);
    });

    it('should floor amounts to integers', () => {
      const result = calculateFlowDistribution(1000001);

      // All amounts should be integers
      expect(Number.isInteger(result.flows[BURN_TYPE.ECOSYSTEM])).toBe(true);
      expect(Number.isInteger(result.flows[BURN_TYPE.SWAP])).toBe(true);
      expect(Number.isInteger(result.flows[TREASURY_EVENT.RETAIN])).toBe(true);
    });
  });

  // ==========================================================================
  // formatFlowLog
  // ==========================================================================

  describe('formatFlowLog', () => {
    it('should format flow for logging', () => {
      const distribution = calculateFlowDistribution(1000000);
      const log = formatFlowLog(REVENUE_SOURCE.FEE_TOKEN, CHANNEL.UNIFIED, distribution);

      expect(log).toEqual({
        source: 'fee_token',
        channel: 'unified',
        input: 1000000,
        ecosystem_burn: 0,
        swap_burn: 764000,
        treasury: 236000,
        total_burned: 764000,
        burn_percent: '76.4%',
      });
    });

    it('should include ecosystem burn when present', () => {
      const distribution = calculateFlowDistribution(1000000, 0.1); // 10% ecosystem
      const log = formatFlowLog(REVENUE_SOURCE.FEE_TOKEN, CHANNEL.UNIFIED, distribution);

      expect(log.ecosystem_burn).toBe(100000);
      expect(log.input).toBe(1000000);
    });

    it('should format purist channel correctly', () => {
      const distribution = {
        input: 1000000,
        flows: {
          [BURN_TYPE.DIRECT]: 1000000,
        },
        totals: {
          burned: 1000000,
          treasury: 0,
          burnPercent: '100.0',
        },
      };

      const log = formatFlowLog(REVENUE_SOURCE.FEE_ASDF, CHANNEL.PURIST, distribution);

      expect(log.source).toBe('fee_asdf');
      expect(log.channel).toBe('purist');
      expect(log.ecosystem_burn).toBe(0);
      expect(log.swap_burn).toBe(0);
      expect(log.treasury).toBe(0);
    });
  });
});
