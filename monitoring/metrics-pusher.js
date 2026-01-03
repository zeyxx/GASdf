#!/usr/bin/env node
/**
 * GASdf Metrics Pusher
 * Scrapes /metrics and pushes to Grafana Cloud
 */

const https = require('https');
const http = require('http');

const config = {
  // GASdf metrics endpoint
  metricsUrl: process.env.GASDF_METRICS_URL || 'https://gasdf-43r8.onrender.com/metrics',
  metricsApiKey: process.env.METRICS_API_KEY,

  // Grafana Cloud
  grafanaUrl: process.env.GRAFANA_REMOTE_WRITE_URL,
  grafanaUser: process.env.GRAFANA_USER_ID,
  grafanaKey: process.env.GRAFANA_API_KEY,

  // Scrape interval (ms)
  interval: parseInt(process.env.SCRAPE_INTERVAL || '30000', 10),
};

// Validate config
function validateConfig() {
  const required = ['metricsApiKey', 'grafanaUrl', 'grafanaUser', 'grafanaKey'];
  const missing = required.filter(k => !config[k]);
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
      res.on('data', chunk => data += chunk);
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

// Parse Prometheus text format to samples
function parsePrometheusText(text) {
  const samples = [];
  const lines = text.split('\n');

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim() === '') continue;

    // Parse: metric_name{label="value"} 123.45 timestamp
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)((?:\{[^}]*\})?)?\s+([0-9.eE+-]+)(?:\s+(\d+))?$/);
    if (match) {
      const [, name, labelsStr, value] = match;
      const labels = parseLabels(labelsStr || '');
      samples.push({
        name,
        labels,
        value: parseFloat(value),
        timestamp: Date.now(),
      });
    }
  }

  return samples;
}

// Parse labels string {foo="bar",baz="qux"} to object
function parseLabels(str) {
  const labels = { service: 'gasdf', env: 'production' };
  if (!str || str === '{}') return labels;

  const inner = str.slice(1, -1); // Remove { }
  const pairs = inner.match(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g) || [];

  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    labels[key] = value.replace(/^"|"$/g, '');
  }

  return labels;
}

// Convert samples to Prometheus remote write format (snappy compressed protobuf)
// For simplicity, we'll use the Influx line protocol via Grafana's carbon endpoint
// Or use the simpler JSON push endpoint

// Actually, let's use the Prometheus push gateway format which is simpler
async function pushToGrafana(metricsText) {
  return new Promise((resolve, reject) => {
    const url = new URL(config.grafanaUrl);

    // Add job label for push gateway compatibility
    const body = metricsText;

    const auth = Buffer.from(`${config.grafanaUser}:${config.grafanaKey}`).toString('base64');

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Authorization': `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Push failed: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Main scrape loop
async function scrape() {
  try {
    console.log(`[${new Date().toISOString()}] Scraping metrics...`);
    const metrics = await fetchMetrics();
    const lineCount = metrics.split('\n').filter(l => l && !l.startsWith('#')).length;
    console.log(`[${new Date().toISOString()}] Fetched ${lineCount} metrics`);

    await pushToGrafana(metrics);
    console.log(`[${new Date().toISOString()}] Pushed to Grafana Cloud`);
  } catch (err) {
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
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
