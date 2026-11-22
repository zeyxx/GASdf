import { afterEach, describe, expect, it, vi } from 'vitest';
import { GasdfClient } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GasdfClient (subscription)', () => {
  it('instantiates with gateway URL', () => {
    const client = new GasdfClient({ gatewayUrl: 'https://gasdf.talaria.build' });
    expect(client).toBeDefined();
  });

  it('requests and parses a live quote without contacting production', async () => {
    const quoteResponse = {
      status: 'valid',
      inputSymbol: 'USDC',
      targetAsdfFormatted: 30000,
      inputAmountFormatted: 4.54,
      ttlSeconds: 45,
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => quoteResponse,
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new GasdfClient({ gatewayUrl: 'https://gasdf.talaria.build', timeoutMs: 10000 });
    const quote = await client.getLiveQuote('USDC', 'pro-monthly', 'trenchscanner');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gasdf.talaria.build/subscription/quote/live?token=USDC&planId=pro-monthly&appId=trenchscanner',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(quote).toMatchObject(quoteResponse);
  });

  it('rejects a rate-limited quote instead of treating HTTP 429 as success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Rate limited' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new GasdfClient({ gatewayUrl: 'https://gasdf.talaria.build' });
    await expect(client.getLiveQuote('USDC', 'pro-monthly', 'trenchscanner')).rejects.toThrow(
      /GASdf API error \(429\): Rate limited/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
