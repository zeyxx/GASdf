#!/usr/bin/env node
/**
 * E2E Test: Burn Worker Monitoring
 *
 * Monitors burn worker health and activity.
 * Run: node scripts/e2e/test-burn-worker.js
 */

const API_URL = process.env.API_URL || 'https://gasdf-43r8.onrender.com';

async function fetchJson(url) {
  const response = await fetch(url);
  return { status: response.status, data: await response.json() };
}

async function testTreasuryBalance() {
  console.log('\n=== Treasury Balance ===');
  const { status, data } = await fetchJson(`${API_URL}/stats/treasury`);

  if (status !== 200) {
    throw new Error(`Treasury check failed: ${status}`);
  }

  console.log(`SOL: ${data.sol?.formatted || 'N/A'}`);
  console.log(`$ASDF: ${data.asdf?.formatted || 'N/A'}`);
  console.log(`Pending burns: ${data.pendingBurns || 0}`);

  console.log('✓ Treasury check passed');
  return data;
}

async function testRecentBurns() {
  console.log('\n=== Recent Burns ===');
  const { status, data } = await fetchJson(`${API_URL}/stats/burns?limit=3`);

  if (status !== 200) {
    throw new Error(`Burns check failed: ${status}`);
  }

  console.log(`Total burns: ${data.totalBurns}`);

  if (data.burns && data.burns.length > 0) {
    const latest = data.burns[0];
    console.log(`Latest burn: ${latest.amountFormatted}`);
    console.log(`Age: ${latest.age}`);
    console.log(`Tx: ${latest.burnSignature?.slice(0, 20)}...`);

    // Check if burn happened in last 24h
    const ageMs = Date.now() - latest.timestamp;
    const ageHours = ageMs / (1000 * 60 * 60);

    if (ageHours > 24) {
      console.log(`⚠ Warning: No burns in last 24h (last was ${ageHours.toFixed(1)}h ago)`);
    } else {
      console.log(`✓ Burns happening regularly (${ageHours.toFixed(1)}h ago)`);
    }
  } else {
    console.log('No burns recorded yet');
  }

  console.log('✓ Burns check passed');
  return data;
}

async function testBurnStats() {
  console.log('\n=== Burn Statistics ===');
  const { status, data } = await fetchJson(`${API_URL}/stats`);

  if (status !== 200) {
    throw new Error(`Stats check failed: ${status}`);
  }

  console.log(`Total burned: ${data.burnedFormatted}`);
  console.log(`Total transactions: ${data.totalTransactions}`);
  console.log(`Burn ratio: ${(data.treasury?.burnRatio * 100).toFixed(1)}%`);
  console.log(`Treasury ratio: ${(data.treasury?.treasuryRatio * 100).toFixed(1)}%`);

  // Validate burn ratio is ~76.4% (Golden ratio)
  const burnRatio = data.treasury?.burnRatio;
  if (burnRatio && Math.abs(burnRatio - 0.764) > 0.01) {
    console.log(`⚠ Warning: Burn ratio ${burnRatio} differs from expected ~0.764`);
  }

  console.log('✓ Stats check passed');
  return data;
}

async function testFeePayer() {
  console.log('\n=== Fee Payer Health ===');
  const { status, data } = await fetchJson(`${API_URL}/health`);

  if (status !== 200) {
    throw new Error(`Health check failed: ${status}`);
  }

  const fp = data.checks?.feePayer;
  if (!fp) {
    throw new Error('No fee payer info');
  }

  console.log(`Status: ${fp.status}`);
  console.log(`Total payers: ${fp.summary?.total}`);
  console.log(`Healthy: ${fp.summary?.healthy}`);
  console.log(`Warning: ${fp.summary?.warning}`);
  console.log(`Critical: ${fp.summary?.critical}`);

  for (const payer of fp.payers || []) {
    console.log(`  ${payer.pubkey}: ${payer.balance} SOL (${payer.status})`);
  }

  if (fp.summary?.critical > 0) {
    throw new Error('Critical fee payer issue detected');
  }

  console.log('✓ Fee payer check passed');
  return fp;
}

async function main() {
  console.log('========================================');
  console.log('GASdf Burn Worker Monitor');
  console.log(`API: ${API_URL}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('========================================');

  const results = { passed: 0, failed: 0, errors: [] };

  const tests = [testTreasuryBalance, testRecentBurns, testBurnStats, testFeePayer];

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

  // Output JSON for N8n/monitoring
  if (process.env.OUTPUT_JSON) {
    console.log(
      '\n=== JSON Output ===\n' +
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            passed: results.passed,
            failed: results.failed,
            errors: results.errors,
          },
          null,
          2
        )
    );
  }

  if (results.failed > 0) {
    process.exit(1);
  }

  console.log('\n✓ Burn worker healthy!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
