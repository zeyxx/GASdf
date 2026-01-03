/**
 * k6 Load Test for GASdf Quote Endpoint
 *
 * Install: brew install k6 (or see https://k6.io/docs/getting-started/installation/)
 *
 * Run:
 *   k6 run scripts/load-test/k6-quote.js
 *   k6 run --vus 10 --duration 30s scripts/load-test/k6-quote.js
 *   k6 run --env API_URL=http://localhost:3000 scripts/load-test/k6-quote.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const quoteDuration = new Trend('quote_duration');

// Configuration
const API_URL = __ENV.API_URL || 'https://gasdf-43r8.onrender.com';

// Test tokens
const TOKENS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  SOL: 'So11111111111111111111111111111111111111112',
  ASDF: '9zB5wRarXMj86MymwLumSKA1Dx35zPqqKfcZtK1Spump',
};

// Test wallets (random-ish valid pubkeys for load testing)
const TEST_WALLETS = [
  '3eW3WbKpWAu6aNAd3boubvfpXLfTbHzYZpVifNgDTRbn',
  '5YourWa11et1111111111111111111111111111111',
  '6AnotherWa11et11111111111111111111111111111',
  '7TestWa11etPubkey111111111111111111111111',
  '8LoadTestWa11et111111111111111111111111111',
];

// Load test options
export const options = {
  // Ramp up pattern
  stages: [
    { duration: '10s', target: 5 }, // Ramp up to 5 users
    { duration: '30s', target: 10 }, // Stay at 10 users
    { duration: '10s', target: 20 }, // Spike to 20 users
    { duration: '30s', target: 10 }, // Back to 10 users
    { duration: '10s', target: 0 }, // Ramp down
  ],

  // Thresholds (test fails if not met)
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'], // Less than 1% errors
    errors: ['rate<0.05'], // Less than 5% custom errors
  },
};

// Main test function
export default function () {
  // Random token and wallet for each request
  const tokenKeys = Object.keys(TOKENS);
  const token = TOKENS[tokenKeys[Math.floor(Math.random() * tokenKeys.length)]];
  const wallet = TEST_WALLETS[Math.floor(Math.random() * TEST_WALLETS.length)];

  const payload = JSON.stringify({
    paymentToken: token,
    userPubkey: wallet,
    estimatedComputeUnits: 200000 + Math.floor(Math.random() * 300000),
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const startTime = Date.now();
  const res = http.post(`${API_URL}/quote`, payload, params);
  const duration = Date.now() - startTime;

  // Record custom metrics
  quoteDuration.add(duration);

  // Check response
  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'has quoteId': (r) => {
      try {
        const body = JSON.parse(r.body);
        return !!body.quoteId;
      } catch {
        return false;
      }
    },
    'has feePayer': (r) => {
      try {
        const body = JSON.parse(r.body);
        return !!body.feePayer;
      } catch {
        return false;
      }
    },
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!success);

  // Small delay between requests
  sleep(0.1 + Math.random() * 0.2);
}

// Setup - runs once before test
export function setup() {
  // Verify API is reachable
  const healthRes = http.get(`${API_URL}/health`);
  if (healthRes.status !== 200) {
    throw new Error(`API not healthy: ${healthRes.status}`);
  }

  console.log(`\n🚀 Starting load test against ${API_URL}\n`);

  return { startTime: Date.now() };
}

// Teardown - runs once after test
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`\n✅ Load test completed in ${duration.toFixed(1)}s\n`);
}
