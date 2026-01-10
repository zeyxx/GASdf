#!/usr/bin/env node
/**
 * GASdf Metrics Pusher
 * Scrapes /metrics and pushes to Grafana Cloud via InfluxDB protocol
 * Also reports to asdf-brain for ecosystem monitoring
 */

const https = require('https');
const http = require('http');

const config = {
  // GASdf metrics endpoint
  metricsUrl: process.env.GASDF_METRICS_URL || 'https://gasdf-43r8.onrender.com/metrics',
  metricsApiKey: process.env.METRICS_API_KEY,

  // Grafana Cloud - derive Influx endpoint from remote_write URL
  grafanaUrl: process.env.GRAFANA_REMOTE_WRITE_URL,
  grafanaUser: process.env.GRAFANA_USER_ID,
  grafanaKey: process.env.GRAFANA_API_KEY,

  // asdf-brain endpoint
  brainUrl: process.env.BRAIN_URL || 'https://asdf-brain.onrender.com',

  // Scrape interval (ms)
  interval: parseInt(process.env.SCRAPE_INTERVAL || '30000', 10),

  // Brain report interval (ms) - every 5 minutes
  brainInterval: parseInt(process.env.BRAIN_INTERVAL || '300000', 10),
};

// Track metrics for brain reporting
const brainMetrics = {
  startTime: Date.now(),
  scrapeCount: 0,
  scrapeErrors: 0,
  lastScrapeTime: null,
  lastMetrics: null,
};

// Validate config
function validateConfig() {
  const required = ['metricsApiKey', 'grafanaUrl', 'grafanaUser', 'grafanaKey'];
  const missing = required.filter((k) => !config[k]);
  if (missing.length > 0) {
    console.error('Missing required env vars:', missing.join(', '));
    process.exit(1);
  }
}

// Fetch metrics from GASdf
async function fetchMetrics() {
  return new Promise((resolve, reject) => {
    const url = new URL(config.metricsUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'GET',
      headers: {
        'x-metrics-key': config.metricsApiKey,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`Fetch failed: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Convert Prometheus text format to InfluxDB line protocol
function prometheusToInflux(text) {
  const lines = [];
  const timestamp = Date.now() * 1000000; // nanoseconds

  for (const line of text.split('\n')) {
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim() === '') continue;

    // Parse: metric_name{label="value"} 123.45
    const match = line.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)((?:\{[^}]*\})?)\s+([0-9.eE+-]+(?:e[+-]?\d+)?)/i
    );
    if (!match) continue;

    const [, name, labelsStr, valueStr] = match;
    const value = parseFloat(valueStr);

    // Skip NaN and Inf values
    if (!isFinite(value)) continue;

    // Parse labels
    const tags = ['service=gasdf', 'env=production'];
    if (labelsStr && labelsStr !== '{}') {
      const inner = labelsStr.slice(1, -1);
      const pairs = inner.match(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g) || [];
      for (const pair of pairs) {
        const eqIdx = pair.indexOf('=');
        const key = pair.slice(0, eqIdx);
        const val = pair.slice(eqIdx + 2, -1); // Remove =" and trailing "
        // Escape special chars in tag values
        const escaped = val.replace(/[,= ]/g, '\\$&');
        if (escaped) tags.push(`${key}=${escaped}`);
      }
    }

    // InfluxDB line protocol: measurement,tag1=v1,tag2=v2 value=123.45 timestamp
    const tagStr = tags.length > 0 ? ',' + tags.join(',') : '';
    lines.push(`${name}${tagStr} value=${value} ${timestamp}`);
  }

  return lines.join('\n');
}

// Push to Grafana Cloud via InfluxDB write endpoint
async function pushToGrafana(influxData) {
  return new Promise((resolve, reject) => {
    // Convert remote_write URL to influx write URL
    // From: https://prometheus-prod-XX-prod-XX.grafana.net/api/prom/push
    // To: https://influx-prod-XX-prod-XX.grafana.net/api/v1/push/influx/write
    const baseUrl = new URL(config.grafanaUrl);
    const influxHost = baseUrl.hostname.replace('prometheus-', 'influx-');

    const auth = Buffer.from(`${config.grafanaUser}:${config.grafanaKey}`).toString('base64');

    const options = {
      hostname: influxHost,
      port: 443,
      path: '/api/v1/push/influx/write',
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Authorization: `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(influxData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Push failed: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(influxData);
    req.end();
  });
}

// Extract key metrics from Prometheus text for brain reporting
function extractBrainMetrics(prometheusText) {
  const metrics = {
    uptime: 100, // If we can scrape, service is up
    response_time_ms: 50, // Default
    error_rate: 0,
    burns_total: 0,
    burns_24h: 0,
    transactions_total: 0,
  };

  for (const line of prometheusText.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;

    // Parse metric name and value
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)((?:\{[^}]*\})?)\s+([0-9.eE+-]+)/i);
    if (!match) continue;

    const [, name, , valueStr] = match;
    const value = parseFloat(valueStr);

    // Extract relevant metrics
    if (name === 'gasdf_http_request_duration_seconds_sum') {
      // Approximate avg response time
      metrics.response_time_ms = Math.round(value * 1000 / Math.max(brainMetrics.scrapeCount, 1));
    } else if (name === 'gasdf_burns_total') {
      metrics.burns_total = value;
    } else if (name === 'gasdf_transactions_total') {
      metrics.transactions_total = value;
    } else if (name === 'gasdf_errors_total') {
      metrics.error_rate = (value / Math.max(metrics.transactions_total, 1)) * 100;
    }
  }

  return metrics;
}

// Report to asdf-brain
async function reportToBrain() {
  try {
    const uptimeMs = Date.now() - brainMetrics.startTime;
    const errorRate = brainMetrics.scrapeCount > 0
      ? (brainMetrics.scrapeErrors / brainMetrics.scrapeCount) * 100
      : 0;

    // Get latest scraped metrics if available
    let serviceMetrics = {
      uptime: 100,
      response_time_ms: 50,
      error_rate: errorRate,
    };

    if (brainMetrics.lastMetrics) {
      serviceMetrics = { ...serviceMetrics, ...brainMetrics.lastMetrics };
    }

    const payload = JSON.stringify({
      service: 'gasdf',
      node: process.env.RENDER_INSTANCE_ID || 'metrics-pusher',
      period: new Date().toISOString().slice(0, 7),
      metrics: {
        uptime: serviceMetrics.uptime,
        response_time_ms: serviceMetrics.response_time_ms,
        error_rate: serviceMetrics.error_rate,
      },
      _extended: {
        scrape_count: brainMetrics.scrapeCount,
        scrape_errors: brainMetrics.scrapeErrors,
        uptime_ms: uptimeMs,
        burns_total: serviceMetrics.burns_total || 0,
      },
    });

    const url = new URL('/webhook/metrics', config.brainUrl);

    return new Promise((resolve) => {
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-Source': 'gasdf-metrics-pusher',
        },
        timeout: 10000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            const result = JSON.parse(data);
            console.log(`[${new Date().toISOString()}] 🧠 Brain: I_infra=${result.i_infra?.score || 'N/A'}`);
            resolve(result);
          } else {
            console.warn(`[${new Date().toISOString()}] Brain: ${res.statusCode}`);
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });

      req.write(payload);
      req.end();
    });
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] Brain error:`, err.message);
    return null;
  }
}

// Main scrape loop
async function scrape() {
  try {
    console.log(`[${new Date().toISOString()}] Scraping metrics...`);
    const prometheusText = await fetchMetrics();

    // Track for brain reporting
    brainMetrics.scrapeCount++;
    brainMetrics.lastScrapeTime = Date.now();
    brainMetrics.lastMetrics = extractBrainMetrics(prometheusText);

    const influxData = prometheusToInflux(prometheusText);
    const lineCount = influxData.split('\n').filter((l) => l).length;
    console.log(`[${new Date().toISOString()}] Converted ${lineCount} metrics to InfluxDB format`);

    await pushToGrafana(influxData);
    console.log(`[${new Date().toISOString()}] Pushed to Grafana Cloud`);
  } catch (err) {
    brainMetrics.scrapeErrors++;
    console.error(`[${new Date().toISOString()}] Error:`, err.message);
  }
}

// Health endpoint for Render
function startHealthServer() {
  const port = process.env.PORT || 10000;
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'gasdf-metrics-pusher' }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    console.log(`Health server listening on port ${port}`);
  });
}

// Main
async function main() {
  console.log('GASdf Metrics Pusher starting...');
  validateConfig();

  // Start health server for Render
  startHealthServer();

  // Initial scrape
  await scrape();

  // Schedule periodic scrapes
  setInterval(scrape, config.interval);

  console.log(`Scraping every ${config.interval / 1000}s`);

  // Start brain reporting (after first scrape)
  console.log(`🧠 Brain reporting to ${config.brainUrl} every ${config.brainInterval / 1000}s`);

  // Initial brain report after 30 seconds
  setTimeout(async () => {
    await reportToBrain();
    // Then report every brainInterval
    setInterval(reportToBrain, config.brainInterval);
  }, 30000);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
