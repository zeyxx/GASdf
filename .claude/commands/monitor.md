# Monitor GASdf Services

Check health and metrics for all GASdf services.

```bash
echo "=== API Health ==="
curl -s https://gasdf-43r8.onrender.com/health | jq '{status, uptime: .uptime, redis: .redis.connected, version: .version}'

echo -e "\n=== Stats ==="
curl -s https://gasdf-43r8.onrender.com/stats | jq '{totalBurned: .totalBurned, transactions: .transactions, lastBurn: .lastBurn}'

echo -e "\n=== Treasury ==="
curl -s https://gasdf-43r8.onrender.com/stats/treasury | jq '{balance: .balance, pendingBurns: .pendingBurns}'
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
