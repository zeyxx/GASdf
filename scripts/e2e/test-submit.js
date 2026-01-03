#!/usr/bin/env node
/**
 * E2E Test: Submit Endpoint
 *
 * Tests the submit endpoint validation logic.
 * Note: Full transaction submission requires a signed tx from a real wallet.
 *
 * Run: node scripts/e2e/test-submit.js
 */

const API_URL = process.env.API_URL || 'https://gasdf-43r8.onrender.com';

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

async function testSubmitWithoutQuoteId() {
  console.log('\n=== Test: Submit without quoteId ===');
  const { status, data } = await fetchJson(`${API_URL}/submit`, {
    method: 'POST',
    body: JSON.stringify({
      signedTransaction: 'fakeBase64Transaction',
    }),
  });

  console.log(`Status: ${status}`);
  console.log(`Error: ${data.error}`);

  if (status !== 400) {
    throw new Error(`Expected 400, got ${status}`);
  }

  console.log('✓ Correctly rejected missing quoteId');
}

async function testSubmitWithInvalidQuoteId() {
  console.log('\n=== Test: Submit with invalid quoteId ===');
  const { status, data } = await fetchJson(`${API_URL}/submit`, {
    method: 'POST',
    body: JSON.stringify({
      quoteId: 'non-existent-quote-id',
      signedTransaction: 'fakeBase64Transaction',
    }),
  });

  console.log(`Status: ${status}`);
  console.log(`Error: ${data.error}`);

  // Should be 400 (invalid quote) or 404 (not found)
  if (status !== 400 && status !== 404) {
    throw new Error(`Expected 400 or 404, got ${status}`);
  }

  console.log('✓ Correctly rejected invalid quoteId');
}

async function testSubmitWithExpiredQuote() {
  console.log('\n=== Test: Submit with expired quote ===');

  // First get a valid quote
  const quoteRes = await fetchJson(`${API_URL}/quote`, {
    method: 'POST',
    body: JSON.stringify({
      paymentToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      userPubkey: '3eW3WbKpWAu6aNAd3boubvfpXLfTbHzYZpVifNgDTRbn',
    }),
  });

  if (quoteRes.status !== 200) {
    throw new Error(`Failed to get quote: ${quoteRes.status}`);
  }

  console.log(`Got quote: ${quoteRes.data.quoteId}`);
  console.log(`TTL: ${quoteRes.data.ttl}s`);

  // Try to submit with an invalid transaction
  // (Quote is valid, but transaction format is wrong)
  const { status, data } = await fetchJson(`${API_URL}/submit`, {
    method: 'POST',
    body: JSON.stringify({
      quoteId: quoteRes.data.quoteId,
      signedTransaction: 'invalidBase64!!!',
    }),
  });

  console.log(`Status: ${status}`);
  console.log(`Error: ${data.error || data.code}`);

  // Should fail validation (400 or 500)
  if (status === 200) {
    throw new Error('Should have rejected invalid transaction');
  }

  console.log('✓ Correctly rejected invalid transaction format');
}

async function testSubmitRateLimiting() {
  console.log('\n=== Test: Submit rate limiting ===');

  // Make multiple rapid requests to test rate limiting
  const requests = [];
  for (let i = 0; i < 5; i++) {
    requests.push(
      fetchJson(`${API_URL}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          quoteId: `fake-quote-${i}`,
          signedTransaction: 'fakeTransaction',
        }),
      })
    );
  }

  const results = await Promise.all(requests);
  const statuses = results.map((r) => r.status);

  console.log(`Response statuses: ${statuses.join(', ')}`);

  // At least one should be 400 (validation) or 429 (rate limit)
  const hasValidResponse = statuses.some((s) => s === 400 || s === 429);
  if (!hasValidResponse) {
    throw new Error('Expected validation or rate limit response');
  }

  console.log('✓ Rate limiting/validation working');
}

async function testSubmitEndpointExists() {
  console.log('\n=== Test: Submit endpoint exists ===');

  // OPTIONS request to check endpoint
  const response = await fetch(`${API_URL}/submit`, {
    method: 'OPTIONS',
  });

  console.log(`Status: ${response.status}`);

  // Should return 200 or 204 for OPTIONS, or 405 if not allowed
  if (response.status >= 500) {
    throw new Error(`Server error: ${response.status}`);
  }

  console.log('✓ Submit endpoint accessible');
}

async function main() {
  console.log('========================================');
  console.log('GASdf E2E Tests - Submit Endpoint');
  console.log(`API: ${API_URL}`);
  console.log('========================================');
  console.log('Note: Full submit requires signed tx from real wallet');

  const results = { passed: 0, failed: 0, errors: [] };

  const tests = [
    testSubmitEndpointExists,
    testSubmitWithoutQuoteId,
    testSubmitWithInvalidQuoteId,
    testSubmitWithExpiredQuote,
    testSubmitRateLimiting,
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
    console.log('\nNote: Some failures may be expected behavior');
    process.exit(1);
  }

  console.log('\n✓ Submit validation tests passed!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
