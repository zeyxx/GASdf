# GASdf Monitoring Setup

> Prometheus metrics + alerting for production

## Quick Start

```bash
# Check health (JSON output for N8n/cron)
npm run monitor

# Run E2E tests
npm run test:e2e

# Load test with k6
k6 run scripts/load-test/k6-quote.js
```

## Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `/health` | None | Full system status (JSON) |
| `/status` | None | Simple status for uptime monitors |
| `/metrics` | API Key | Prometheus format metrics |

## Prometheus Metrics

The `/metrics` endpoint requires authentication:

```bash
curl -H "x-metrics-key: YOUR_METRICS_API_KEY" \
  https://asdfasdfa.tech/metrics
```

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `gasdf_http_request_duration_seconds` | Histogram | Request latency by route |
| `gasdf_http_requests_total` | Counter | Total requests by route/status |
| `gasdf_quotes_total` | Counter | Quote requests |
| `gasdf_submits_total` | Counter | Submit requests |
| `gasdf_burns_total` | Counter | Burn operations |
| `gasdf_fee_payer_balance_sol` | Gauge | Fee payer SOL balance |

## Grafana Cloud Setup

### 1. Create Account

Sign up at [grafana.com](https://grafana.com) for a free cloud account.

### 2. Configure Prometheus Agent

Create a `prometheus.yml` config:

```yaml
global:
  scrape_interval: 30s

scrape_configs:
  - job_name: 'gasdf'
    scheme: https
    static_configs:
      - targets: ['asdfasdfa.tech']
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: YOUR_METRICS_API_KEY
    # Or use header directly:
    # params:
    #   x-metrics-key: ['YOUR_METRICS_API_KEY']
```

### 3. Run Prometheus Agent

```bash
# Docker
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  -v ./prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus

# Or use Grafana Agent
```

### 4. Remote Write to Grafana Cloud

Add to `prometheus.yml`:

```yaml
remote_write:
  - url: https://prometheus-us-central1.grafana.net/api/prom/push
    basic_auth:
      username: YOUR_GRAFANA_USER_ID
      password: YOUR_GRAFANA_API_KEY
```

## Alerting Rules

Example Prometheus alerting rules:

```yaml
groups:
  - name: gasdf
    rules:
      # High latency
      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(gasdf_http_request_duration_seconds_bucket[5m])) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "P95 latency above 500ms"

      # Low fee payer balance
      - alert: LowFeePayerBalance
        expr: gasdf_fee_payer_balance_sol < 0.1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Fee payer balance below 0.1 SOL"

      # High error rate
      - alert: HighErrorRate
        expr: rate(gasdf_http_requests_total{status=~"5.."}[5m]) / rate(gasdf_http_requests_total[5m]) > 0.01
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Error rate above 1%"

      # No burns in 24h
      - alert: NoBurns
        expr: increase(gasdf_burns_total[24h]) == 0
        for: 1h
        labels:
          severity: info
        annotations:
          summary: "No burns in last 24 hours"
```

## N8n Workflow Integration

The health check script outputs JSON for easy N8n integration:

```bash
npm run monitor
```

Output format:
```json
{
  "status": "healthy",
  "timestamp": "2026-01-03T12:00:00.000Z",
  "checks": {
    "api": { "status": "healthy", "latency_ms": 150 },
    "fee_payer": { "status": "healthy", "balance_sol": 0.5 },
    "burn_worker": { "status": "healthy", "last_burn_age_hours": 2 }
  }
}
```

### N8n Workflow Example

1. **Schedule Trigger**: Every 5 minutes
2. **Execute Command**: `npm run monitor`
3. **IF Node**: Check `$.status != "healthy"`
4. **Discord Webhook**: Send alert

## Redis Monitoring

Check Redis memory usage:

```bash
redis-cli INFO memory | grep used_memory_human
```

Key metrics to track:
- `used_memory_human`: Current memory usage
- `maxmemory`: Memory limit
- `evicted_keys`: Keys evicted due to memory limit

## Load Testing

Run k6 load test:

```bash
# Install k6
brew install k6  # macOS
# or: apt install k6  # Linux

# Run test
k6 run scripts/load-test/k6-quote.js

# With custom options
k6 run --vus 50 --duration 5m scripts/load-test/k6-quote.js
```

Target thresholds:
- P95 latency < 500ms
- Error rate < 1%
- 100+ RPS sustained

## Uptime Monitoring

External uptime monitors should hit:
- Primary: `https://asdfasdfa.tech/health`
- Simple: `https://asdfasdfa.tech/status`

Recommended services:
- [UptimeRobot](https://uptimerobot.com) (free tier)
- [Better Uptime](https://betteruptime.com)
- Custom Upptime page: `https://status.asdfasdfa.tech`
