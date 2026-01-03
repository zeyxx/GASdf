#!/usr/bin/env node
/**
 * E2E Test: Quote Flow
 *
 * Tests the quote endpoint against production API.
 * Run: node scripts/e2e/test-quote-flow.js
 */

const API_URL = process.env.API_URL || 'https://gasdf-43r8.onrender.com';

// Test wallet (has $ASDF for tier testing)
const TEST_WALLET = '3eW3WbKpWAu6aNAd3boubvfpXLfTbHzYZpVifNgDTRbn';

// Known tokens
const TOKENS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  SOL: 'So11111111111111111111111111111111111111112',
  ASDF: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return { status: response.status, data: await response.json() };
}

async function testHealth() {
  console.log('\n=== Test: Health Check ===');
  const { status, data } = await fetchJson(`${API_URL}/health`);

  console.log(`Status: ${status}`);
  console.log(`API Status: ${data.status}`);
  console.log(`Version: ${data.version}`);
  console.log(`Redis: ${data.redis?.connected ? 'connected' : 'disconnected'}`);

  if (status !== 200 || !['ok', 'healthy'].includes(data.status)) {
    throw new Error(`Health check failed: ${data.status}`);
  }
  console.log('✓ Health check passed');
}

async function testQuoteUSDC() {
  console.log('\n=== Test: Quote with USDC ===');
  const { status, data } = await fetchJson(`${API_URL}/quote`, {
    method: 'POST',
    body: JSON.stringify({
      paymentToken: TOKENS.USDC,
      userPubkey: TEST_WALLET,
    }),
  });

  console.log(`Status: ${status}`);

  if (status !== 200) {
    console.log('Error:', data.error);
    throw new Error(`Quote failed with status ${status}`);
  }

  console.log(`Quote ID: ${data.quoteId}`);
  console.log(`Fee Payer: ${data.feePayer?.slice(0, 12)}...`);
  console.log(`Fee Amount: ${data.feeFormatted}`);
  console.log(`Tier: ${data.holderTier?.tier} ${data.holderTier?.emoji || ''}`);
  console.log(`Expires: ${new Date(data.expiresAt).toISOString()}`);

  // Validate response structure
  const required = ['quoteId', 'feePayer', 'feeAmount', 'expiresAt', 'holderTier'];
  for (const field of required) {
    if (!data[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  console.log('✓ USDC quote passed');
  return data;
}

async function testQuoteSOL() {
  console.log('\n=== Test: Quote with SOL (native) ===');
  const { status, data } = await fetchJson(`${API_URL}/quote`, {
    method: 'POST',
    body: JSON.stringify({
      paymentToken: TOKENS.SOL,
      userPubkey: TEST_WALLET,
    }),
  });

  console.log(`Status: ${status}`);

  if (status !== 200) {
    console.log('Error:', data.error);
    throw new Error(`SOL quote failed with status ${status}`);
  }

  console.log(`Fee Amount: ${data.feeFormatted}`);
  console.log('✓ SOL quote passed');
  return data;
}

async function testQuoteASDF() {
  console.log('\n=== Test: Quote with $ASDF (purist channel) ===');
  const { status, data } = await fetchJson(`${API_URL}/quote`, {
    method: 'POST',
    body: JSON.stringify({
      paymentToken: TOKENS.ASDF,
      userPubkey: TEST_WALLET,
    }),
  });

  console.log(`Status: ${status}`);

  if (status !== 200) {
    console.log('Error:', data.error);
    throw new Error(`ASDF quote failed with status ${status}`);
  }

  console.log(`Fee Amount: ${data.feeFormatted}`);
  console.log('✓ $ASDF quote passed');
  return data;
}

async function testQuoteWithComputeUnits() {
  console.log('\n=== Test: Quote with custom compute units ===');
  const { status, data } = await fetchJson(`${API_URL}/quote`, {
    method: 'POST',
    body: JSON.stringify({
      paymentToken: TOKENS.USDC,
      userPubkey: TEST_WALLET,
      estimatedComputeUnits: 500000,
    }),
  });

  console.log(`Status: ${status}`);

  if (status !== 200) {
    throw new Error(`Custom CU quote failed with status ${status}`);
  }

  console.log(`Fee Amount: ${data.feeFormatted}`);
  console.log('✓ Custom compute units quote passed');
  return data;
}

async function testInvalidToken() {
  console.log('\n=== Test: Invalid token rejection ===');
  const { status, data } = await fetchJson(`${API_URL}/quote`, {
    method: 'POST',
    body: JSON.stringify({
      paymentToken: 'InvalidToken11111111111111111111111111111',
      userPubkey: TEST_WALLET,
    }),
  });

  console.log(`Status: ${status}`);
  console.log(`Error: ${data.error}`);

  if (status !== 400) {
    throw new Error(`Expected 400, got ${status}`);
  }

  console.log('✓ Invalid token correctly rejected');
}

async function testStats() {
  console.log('\n=== Test: Stats endpoint ===');
  const { status, data } = await fetchJson(`${API_URL}/stats`);

  console.log(`Status: ${status}`);

  if (status !== 200) {
    throw new Error(`Stats failed with status ${status}`);
  }

  console.log(`Total Burned: ${data.totalBurned || 0}`);
  console.log(`Transactions: ${data.transactions || 0}`);
  console.log('✓ Stats endpoint passed');
}

async function main() {
  console.log('========================================');
  console.log('GASdf E2E Tests');
  console.log(`API: ${API_URL}`);
  console.log(`Test Wallet: ${TEST_WALLET.slice(0, 12)}...`);
  console.log('========================================');

  const results = { passed: 0, failed: 0, errors: [] };

  const tests = [
    testHealth,
    testQuoteUSDC,
    testQuoteSOL,
    testQuoteASDF,
    testQuoteWithComputeUnits,
    testInvalidToken,
    testStats,
  ];

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
    console.log('\nFailures:');
    for (const { test, error } of results.errors) {
      console.log(`  - ${test}: ${error}`);
    }
    process.exit(1);
  }

  console.log('\n✓ All E2E tests passed!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
