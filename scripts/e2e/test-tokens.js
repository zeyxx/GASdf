#!/usr/bin/env node
/**
 * E2E Test: Tokens Endpoint
 *
 * Tests token listing and tier checking.
 * Run: node scripts/e2e/test-tokens.js
 */

const API_URL = process.env.API_URL || 'https://gasdf-43r8.onrender.com';

const TOKENS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  ASDF: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
};

// Test wallet with $ASDF holdings
const TEST_WALLET = '3eW3WbKpWAu6aNAd3boubvfpXLfTbHzYZpVifNgDTRbn';

async function fetchJson(url) {
  const response = await fetch(url);
  return { status: response.status, data: await response.json() };
}

async function testTokensList() {
  console.log('\n=== Test: List Tokens ===');
  const { status, data } = await fetchJson(`${API_URL}/tokens`);

  console.log(`Status: ${status}`);

  if (status !== 200) {
    throw new Error(`Tokens list failed with status ${status}`);
  }

  console.log(`Tokens count: ${data.tokens?.length || 0}`);

  // Check for expected tokens
  const hasUSDC = data.tokens?.some((t) => t.mint === TOKENS.USDC);
  const hasASDF = data.tokens?.some((t) => t.mint === TOKENS.ASDF);

  console.log(`Has USDC: ${hasUSDC}`);
  console.log(`Has $ASDF: ${hasASDF}`);

  if (!hasUSDC) {
    throw new Error('USDC not in token list');
  }

  console.log('✓ Token list passed');
}

async function testTokenCheck() {
  console.log('\n=== Test: Check Token (USDC) ===');
  const { status, data } = await fetchJson(`${API_URL}/tokens/${TOKENS.USDC}/check`);

  console.log(`Status: ${status}`);

  if (status !== 200) {
    throw new Error(`Token check failed with status ${status}`);
  }

  console.log(`Accepted: ${data.accepted}`);
  console.log(`Reason: ${data.reason}`);
  console.log(`Symbol: ${data.symbol || 'N/A'}`);

  if (!data.accepted) {
    throw new Error('USDC should be accepted');
  }

  console.log('✓ Token check passed');
}

async function testTiers() {
  console.log('\n=== Test: Holder Tiers ===');
  const { status, data } = await fetchJson(`${API_URL}/tokens/tiers`);

  console.log(`Status: ${status}`);

  if (status !== 200) {
    throw new Error(`Tiers failed with status ${status}`);
  }

  console.log(`Tiers: ${data.tiers?.map((t) => t.name).join(', ')}`);

  if (!data.tiers || data.tiers.length === 0) {
    throw new Error('No tiers returned');
  }

  console.log('✓ Tiers list passed');
}

async function testWalletTier() {
  console.log('\n=== Test: Wallet Tier ===');
  const { status, data } = await fetchJson(`${API_URL}/tokens/tiers/${TEST_WALLET}`);

  console.log(`Status: ${status}`);

  if (status !== 200) {
    throw new Error(`Wallet tier failed with status ${status}`);
  }

  console.log(`Tier: ${data.tier} ${data.emoji || ''}`);
  console.log(`Balance: ${data.balance || 0} $ASDF`);
  console.log(`Discount: ${data.discountPercent || 0}%`);

  console.log('✓ Wallet tier passed');
}

async function main() {
  console.log('========================================');
  console.log('GASdf E2E Tests - Tokens');
  console.log(`API: ${API_URL}`);
  console.log('========================================');

  const results = { passed: 0, failed: 0, errors: [] };

  const tests = [testTokensList, testTokenCheck, testTiers, testWalletTier];

  for (const test of tests) {
    try {
      await test();
      results.passed++;
    } catch (error) {
      results.failed++;
      results.errors.push({ test: test.name, error: error.message });
      console.log(`✗ ${test.name} failed: ${error.message}`);
    }
  }

  console.log('\n========================================');
  console.log(`Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('========================================');

  if (results.failed > 0) {
    process.exit(1);
  }

  console.log('\n✓ All token tests passed!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
