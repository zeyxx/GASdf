import { describe, it, expect } from 'vitest';
import { GasdfClient } from './client';

describe('GasdfClient (subscription)', () => {
  it('instantiates with gateway URL', () => {
    const client = new GasdfClient({ gatewayUrl: 'https://relay.talaria.build' });
    expect(client).toBeDefined();
  });

  it('queries live quote from relay.talaria.build', async () => {
    const client = new GasdfClient({ gatewayUrl: 'https://relay.talaria.build', timeoutMs: 10000 });
    try {
      const quote = await client.getLiveQuote('USDC', 'pro-monthly', 'trenchscanner');
      expect(quote.status).toBe('valid');
      expect(quote.inputSymbol).toBe('USDC');
      expect(quote.targetAsdfFormatted).toBe(30000);
      expect(quote.inputAmountFormatted).toBeGreaterThan(0);
      expect(quote.ttlSeconds).toBe(45);
    } catch (err: any) {
      if (err.message?.includes('429')) {
        expect(true).toBe(true);
      } else {
        throw err;
      }
    }
  });
});
