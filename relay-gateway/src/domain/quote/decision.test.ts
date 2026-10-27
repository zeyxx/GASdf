import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideLiveQuote,
  isQuoteExpired,
  type LiveQuoteRequest,
  type JupiterRawQuote,
  DEFAULT_QUOTE_TTL_SECONDS,
} from './decision.js';

test('quote domain: accepts valid quote within safe price impact and sets TTL', () => {
  const req: LiveQuoteRequest = {
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    inputSymbol: 'USDC',
    inputDecimals: 6,
    targetAsdfBaseUnits: 30_000_000_000n, // 30,000 ASDF
    slippageBps: 50,
  };

  const jupQuote: JupiterRawQuote = {
    inAmount: '4540000', // 4.54 USDC
    outAmount: '30000000000',
    priceImpactPct: '0.45',
  };

  const now = 1000000;
  const decision = decideLiveQuote(req, jupQuote, now, 45);

  assert.equal(decision.status, 'valid');
  assert.equal(decision.inputAmountBaseUnits, '4540000');
  assert.equal(decision.inputAmountFormatted, 4.54);
  assert.equal(decision.targetAsdfFormatted, 30000);
  assert.equal(decision.priceImpactPct, 0.45);
  assert.equal(decision.ttlSeconds, 45);
  assert.equal(decision.validUntil, now + 45000);

  // Expiration checks
  assert.equal(isQuoteExpired(decision, now + 10000), false);
  assert.equal(isQuoteExpired(decision, now + 45000), true);
  assert.equal(isQuoteExpired(decision, now + 50000), true);
});

test('quote domain: rejects when price impact is too high (> 2.5%)', () => {
  const req: LiveQuoteRequest = {
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    inputSymbol: 'USDC',
    inputDecimals: 6,
    targetAsdfBaseUnits: 30_000_000_000n,
  };

  const jupQuote: JupiterRawQuote = {
    inAmount: '4540000',
    outAmount: '30000000000',
    priceImpactPct: '3.82', // > 2.5%
  };

  const now = 1000000;
  const decision = decideLiveQuote(req, jupQuote, now);

  assert.equal(decision.status, 'price_impact_too_high');
  assert.match(decision.reason!, /exceeds safe threshold/i);
});

test('quote domain: handles missing route gracefully', () => {
  const req: LiveQuoteRequest = {
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    inputSymbol: 'USDC',
    inputDecimals: 6,
    targetAsdfBaseUnits: 30_000_000_000n,
  };

  const now = 1000000;
  const decision = decideLiveQuote(req, null, now);

  assert.equal(decision.status, 'route_missing');
  assert.match(decision.reason!, /No swap route found/i);
});
