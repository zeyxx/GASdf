#!/usr/bin/env node
/**
 * E2E Test Runner
 *
 * Runs all E2E tests against production API.
 * Run: npm run test:e2e
 */

const { execSync } = require('child_process');
const path = require('path');

const E2E_DIR = __dirname;

const tests = ['test-quote-flow.js', 'test-tokens.js', 'test-burn-worker.js'];

console.log('========================================');
console.log('GASdf E2E Test Suite');
console.log(`API: ${process.env.API_URL || 'https://gasdf-43r8.onrender.com'}`);
console.log('========================================\n');

let passed = 0;
let failed = 0;
const failures = [];

for (const test of tests) {
  const testPath = path.join(E2E_DIR, test);
  console.log(`\n>>> Running ${test}...\n`);

  try {
    execSync(`node ${testPath}`, { stdio: 'inherit' });
    passed++;
  } catch (_error) {
    failed++;
    failures.push(test);
  }
}

console.log('\n========================================');
console.log('E2E Suite Summary');
console.log('========================================');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
  process.exit(1);
}

console.log('\n✓ All E2E test suites passed!');
