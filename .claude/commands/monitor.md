# Monitor GASdf Services

Check health and metrics for all GASdf services.

```bash
# Quick health check
curl -s https://gasdf-43r8.onrender.com/health | jq '{status, version, feePayer: .checks.feePayer.summary}'

# Burn stats
curl -s https://gasdf-43r8.onrender.com/stats | jq '{totalBurned: .burnedFormatted, transactions: .totalTransactions, burnRatio: .treasury.burnRatio}'
```

## Full Burn Worker Monitor

```bash
node scripts/e2e/test-burn-worker.js
```

## Endpoints

| Service | URL |
|---------|-----|
| API | https://gasdf-43r8.onrender.com |
| Status | https://status.asdfasdfa.tech |
| Metrics | https://gasdf-43r8.onrender.com/health (Prometheus at bottom) |

## Alerts

- Discord webhook configured in GitHub Actions
- Upptime monitors uptime every 5 minutes
