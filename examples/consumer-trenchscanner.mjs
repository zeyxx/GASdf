#!/usr/bin/env node
// Integration consumer test modeling the @gcrtrd (TrenchScanner) consumer.

import { GasdfClient } from '../sdk/dist/client.js';

const GATEWAY = 'https://relay.talaria.build';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const EXPECTED_TARGET_ASDF = 30000;

async function main() {
  const client = new GasdfClient({ gatewayUrl: GATEWAY, timeoutMs: 15000 });

  const healthRes = await fetch(`${GATEWAY}/health`);
  const health = await healthRes.json();
  console.log('HEALTH:', JSON.stringify(health, null, 2));
  if (!health.gitSha || health.status !== 'ok') {
    throw new Error(`gitSha mismatch: got ${health.gitSha}, expected 2e02299`);
  }

  const quote = await client.getLiveQuote('USDC', 'pro-monthly', 'trenchscanner');
  console.log('QUOTE RECEIPT:', JSON.stringify(quote, null, 2));

  const checks = {
    statusValid: quote.status === 'valid',
    priceImpactFinite: Number.isFinite(quote.priceImpactPct),
    priceImpactReasonable: quote.priceImpactPct >= 0 && quote.priceImpactPct < 5,
    ttlPositive: quote.ttlSeconds > 0,
    ttlExpected: quote.ttlSeconds === 45,
    validUntilAfterQuotedAt: quote.validUntil > quote.quotedAt,
    inputMintUsdc: quote.inputMint === USDC_MINT,
    targetAsdf: quote.targetAsdfFormatted === EXPECTED_TARGET_ASDF,
    inputAmountPositive: quote.inputAmountFormatted > 0,
  };

  console.log('VALIDATION CHECKS:', JSON.stringify(checks, null, 2));

  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (failed.length) {
    throw new Error(`Quote validation failed: ${failed.join(', ')}`);
  }

  console.log('CONSUMER FLOW: PASS — quote valid, all fields verified.');
  console.log('PROOF OF CONSUMPTION:', JSON.stringify({
    gitSha: health.gitSha,
    appId: 'trenchscanner',
    planId: 'pro-monthly',
    token: 'USDC',
    inputMint: quote.inputMint,
    inputAmountFormatted: quote.inputAmountFormatted,
    targetAsdfFormatted: quote.targetAsdfFormatted,
    priceImpactPct: quote.priceImpactPct,
    ttlSeconds: quote.ttlSeconds,
    validUntil: quote.validUntil,
    quotedAt: quote.quotedAt,
  }, null, 2));
}

main().catch((err) => {
  console.error('CONSUMER TEST FAILED:', err?.message || err);
  process.exit(1);
});
