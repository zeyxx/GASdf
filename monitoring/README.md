# GASdf Prometheus Monitoring

Grafana Agent setup for scraping GASdf metrics and pushing to Grafana Cloud.

## Quick Start

### 1. Create Grafana Cloud Account

1. Go to [grafana.com](https://grafana.com) and sign up (free)
2. Once logged in, go to **My Account** → **Prometheus** section
3. Note down:
   - **Remote Write URL** (e.g., `https://prometheus-prod-13-prod-us-east-0.grafana.net/api/prom/push`)
   - **User ID** (numeric)
   - **API Key** (create one with "MetricsPublisher" role)

### 2. Get GASdf Metrics API Key

From Render dashboard → gasdf service → Environment:
- Copy the `METRICS_API_KEY` value

### 3. Configure Environment

```bash
cd monitoring
cp .env.example .env
# Edit .env with your credentials
```

### 4. Run Agent

```bash
docker compose up -d
```

### 5. Verify

Check logs:
```bash
docker compose logs -f
```

You should see:
```
level=info msg="Starting Grafana Agent"
level=info msg="Scrape target" job=gasdf-api target=gasdf-43r8.onrender.com
```

## Grafana Dashboard

Import this dashboard JSON or create panels with these queries:

### Request Rate
```promql
rate(gasdf_http_requests_total[5m])
```

### P95 Latency
```promql
histogram_quantile(0.95, rate(gasdf_http_request_duration_seconds_bucket[5m]))
```

### Fee Payer Balance
```promql
gasdf_fee_payer_balance_sol
```

### Error Rate
```promql
rate(gasdf_http_requests_total{status=~"5.."}[5m]) / rate(gasdf_http_requests_total[5m])
```

### Burns
```promql
increase(gasdf_burns_total[24h])
```

## Alerting

Create alerts in Grafana Cloud → Alerting → Alert rules:

| Alert | Condition | Severity |
|-------|-----------|----------|
| Low Balance | `gasdf_fee_payer_balance_sol < 0.1` | Critical |
| High Latency | `P95 > 500ms for 5min` | Warning |
| High Errors | `Error rate > 1% for 5min` | Warning |
| No Burns | `increase(burns[24h]) == 0` | Info |

## Alternative: Run on Render

Deploy the agent as a Render background worker:

1. Fork this repo or create a new service
2. Use Docker runtime with `monitoring/Dockerfile`
3. Set environment variables in Render dashboard

## Troubleshooting

### Agent not scraping

Check if metrics endpoint works:
```bash
curl -H "x-metrics-key: YOUR_KEY" https://gasdf-43r8.onrender.com/metrics
```

### No data in Grafana

1. Verify remote_write URL is correct
2. Check API key has "MetricsPublisher" role
3. Wait 1-2 minutes for data to appear

### High cardinality warning

If you see cardinality warnings, the histogram buckets might be too granular. This is rare for GASdf's ~130 series.
