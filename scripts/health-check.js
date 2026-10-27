#!/usr/bin/env node
// Health check for GASdf relay-gateway services.
// Exit 0 if all healthy, exit 1 if any degraded.
// Usage: node scripts/health-check.js
// Cron: */5 * * * * node /path/to/scripts/health-check.js

const endpoints = [
  { name: 'relay', url: 'http://10.10.10.127:3000/health' },
  { name: 'facilitator', url: 'http://10.10.10.127:4021/health' },
];

async function check() {
  const results = [];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, { signal: AbortSignal.timeout(5000) });
      const body = await res.json();
      const ok = res.ok && body.status === 'ok';
      results.push({ name: ep.name, ok, status: body.status ?? 'unknown', checks: body.checks ?? {} });
    } catch (err) {
      results.push({ name: ep.name, ok: false, status: 'unreachable', error: err.message });
    }
  }

  const allOk = results.every(r => r.ok);
  const summary = results.map(r => `${r.name}: ${r.ok ? 'OK' : 'FAIL'} (${r.status})`).join(', ');

  if (!allOk) {
    console.error(`[ALERT] GASdf degraded: ${summary}`);
    // OS notification (Linux)
    try {
      const { execSync } = await import('node:child_process');
      execSync(`notify-send "GASdf Alert" "${summary}" 2>/dev/null || true`);
    } catch { /* ignore */ }
    process.exit(1);
  }

  console.log(`[OK] GASdf healthy: ${summary}`);
  process.exit(0);
}

check();
