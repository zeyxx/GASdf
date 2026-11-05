#!/usr/bin/env node
const tests = ['test-health.js'];

async function main() {
  console.log(`API: ${process.env.API_URL || 'https://relay.talaria.build'}`);
  for (const test of tests) {
    console.log(`\n--- ${test} ---`);
    const { execSync } = await import('node:child_process');
    try {
      execSync(`node scripts/e2e/${test}`, { stdio: 'inherit' });
    } catch (e) {
      console.error(`${test} failed`);
    }
  }
}

main();
