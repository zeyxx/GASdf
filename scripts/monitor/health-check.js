#!/usr/bin/env node
/**
 * Health Check Script for N8n / Cron
 *
 * Outputs JSON for easy integration with N8n workflows.
 * Exit codes: 0 = healthy, 1 = warning, 2 = critical
 *
 * Usage:
 *   node scripts/monitor/health-check.js
 *   node scripts/monitor/health-check.js --webhook https://discord.com/api/webhooks/...
 */

const API_URL = process.env.API_URL || 'https://gasdf-43r8.onrender.com';
const METRICS_KEY = process.env.METRICS_API_KEY || '';

// Thresholds
const THRESHOLDS = {
  feePayerMinSol: 0.1, // Warning if below
  feePayerCriticalSol: 0.05, // Critical if below
  maxBurnAgeHours: 24, // Warning if no burn in 24h
  minUptimeSeconds: 60, // Just started, might be unstable
};

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function checkHealth() {
  const result = {
    timestamp: new Date().toISOString(),
    api: API_URL,
    status: 'healthy',
    checks: {},
    alerts: [],
    metrics: {},
  };

  try {
    // 1. Health endpoint
    const health = await fetchJson(`${API_URL}/health`);
    result.checks.api = {
      status: health.status === 'ok' ? 'ok' : 'error',
      version: health.version,
      uptime: health.uptime,
    };

    if (health.uptime < THRESHOLDS.minUptimeSeconds) {
      result.alerts.push({
        level: 'info',
        message: `Service recently restarted (uptime: ${health.uptime}s)`,
      });
    }

    // 2. Fee payer balance
    const feePayer = health.checks?.feePayer;
    if (feePayer?.payers?.[0]) {
      const balance = parseFloat(feePayer.payers[0].balance);
      result.metrics.feePayerBalance = balance;

      if (balance < THRESHOLDS.feePayerCriticalSol) {
        result.status = 'critical';
        result.alerts.push({
          level: 'critical',
          message: `Fee payer balance critically low: ${balance} SOL`,
        });
      } else if (balance < THRESHOLDS.feePayerMinSol) {
        if (result.status !== 'critical') result.status = 'warning';
        result.alerts.push({
          level: 'warning',
          message: `Fee payer balance low: ${balance} SOL`,
        });
      }

      result.checks.feePayer = {
        status: feePayer.status,
        balance: balance,
        healthy: feePayer.summary?.healthy || 0,
      };
    }

    // 3. Redis
    result.checks.redis = {
      status: health.checks?.redis?.status || 'unknown',
      state: health.checks?.redis?.state || 'unknown',
    };

    if (health.checks?.redis?.status !== 'ok') {
      result.status = 'critical';
      result.alerts.push({
        level: 'critical',
        message: 'Redis connection issue',
      });
    }

    // 4. RPC Pool
    result.checks.rpc = {
      status: health.rpcPool?.status || 'unknown',
      healthy: health.rpcPool?.healthyEndpoints || 0,
      total: health.rpcPool?.totalEndpoints || 0,
    };

    // 5. Burns
    const stats = await fetchJson(`${API_URL}/stats`);
    result.metrics.totalBurned = stats.totalBurned;
    result.metrics.totalTransactions = stats.totalTransactions;
    result.metrics.burnRatio = stats.treasury?.burnRatio;

    // Check last burn age
    const burns = await fetchJson(`${API_URL}/stats/burns?limit=1`);
    if (burns.burns?.[0]) {
      const lastBurnAge = (Date.now() - burns.burns[0].timestamp) / (1000 * 60 * 60);
      result.metrics.lastBurnAgeHours = Math.round(lastBurnAge * 10) / 10;

      if (lastBurnAge > THRESHOLDS.maxBurnAgeHours) {
        if (result.status !== 'critical') result.status = 'warning';
        result.alerts.push({
          level: 'warning',
          message: `No burns in ${result.metrics.lastBurnAgeHours}h`,
        });
      }

      result.checks.burnWorker = {
        status: lastBurnAge < THRESHOLDS.maxBurnAgeHours ? 'ok' : 'stale',
        lastBurn: burns.burns[0].amountFormatted,
        age: burns.burns[0].age,
      };
    }

    // 6. Prometheus metrics (if key available)
    if (METRICS_KEY) {
      try {
        const metricsText = await fetch(`${API_URL}/metrics`, {
          headers: { 'x-metrics-key': METRICS_KEY },
        }).then((r) => r.text());

        // Parse some key metrics
        const heapMatch = metricsText.match(/nodejs_heap_size_used_bytes (\d+)/);
        if (heapMatch) {
          result.metrics.heapUsedMb = Math.round(parseInt(heapMatch[1]) / 1024 / 1024);
        }
      } catch (_e) {
        // Metrics optional
      }
    }
  } catch (error) {
    result.status = 'critical';
    result.checks.api = { status: 'error', error: error.message };
    result.alerts.push({
      level: 'critical',
      message: `API unreachable: ${error.message}`,
    });
  }

  return result;
}

async function sendWebhook(url, data) {
  const color = data.status === 'critical' ? 0xff0000 : data.status === 'warning' ? 0xffaa00 : 0x00ff00;
  const emoji = data.status === 'critical' ? '🚨' : data.status === 'warning' ? '⚠️' : '✅';

  const payload = {
    embeds: [
      {
        title: `${emoji} GASdf Health: ${data.status.toUpperCase()}`,
        color,
        fields: [
          {
            name: 'API',
            value: `${data.checks.api?.status || 'unknown'} (v${data.checks.api?.version || '?'})`,
            inline: true,
          },
          {
            name: 'Fee Payer',
            value: `${data.metrics.feePayerBalance || '?'} SOL`,
            inline: true,
          },
          {
            name: 'Last Burn',
            value: data.checks.burnWorker?.age || 'N/A',
            inline: true,
          },
        ],
        footer: { text: data.timestamp },
      },
    ],
  };

  if (data.alerts.length > 0) {
    payload.embeds[0].fields.push({
      name: 'Alerts',
      value: data.alerts.map((a) => `${a.level}: ${a.message}`).join('\n'),
    });
  }

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function main() {
  const result = await checkHealth();

  // Output JSON
  console.log(JSON.stringify(result, null, 2));

  // Send webhook if provided
  const webhookArg = process.argv.find((a) => a.startsWith('--webhook='));
  const webhookUrl = webhookArg?.split('=')[1] || process.env.ALERT_WEBHOOK;

  if (webhookUrl && result.status !== 'healthy') {
    await sendWebhook(webhookUrl, result);
  }

  // Exit code based on status
  if (result.status === 'critical') process.exit(2);
  if (result.status === 'warning') process.exit(1);
  process.exit(0);
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'error', error: error.message }));
  process.exit(2);
});
