const config = require('./config');
const logger = require('./logger');

// =============================================================================
// Prometheus-style Metrics (without prom-client dependency)
// =============================================================================

// Metric types
const COUNTER = 'counter';
const GAUGE = 'gauge';
const HISTOGRAM = 'histogram';

// Histogram bucket boundaries (seconds)
const DEFAULT_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// =============================================================================
// Metric Registry
// =============================================================================

const metrics = new Map();

class Counter {
  constructor(name, help, labels = []) {
    this.name = name;
    this.help = help;
    this.labels = labels;
    this.values = new Map();
  }

  inc(labelsObj = {}, value = 1) {
    const key = this.getKey(labelsObj);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  getKey(labelsObj) {
    return this.labels.map((l) => labelsObj[l] || '').join('|');
  }

  collect() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) {
      const labelValues = key.split('|');
      const labelStr =
        this.labels.length > 0
          ? `{${this.labels.map((l, i) => `${l}="${labelValues[i]}"`).join(',')}}`
          : '';
      lines.push(`${this.name}${labelStr} ${value}`);
    }
    return lines.join('\n');
  }
}

class Gauge {
  constructor(name, help, labels = []) {
    this.name = name;
    this.help = help;
    this.labels = labels;
    this.values = new Map();
  }

  set(labelsObj = {}, value) {
    const key = this.getKey(labelsObj);
    this.values.set(key, value);
  }

  inc(labelsObj = {}, value = 1) {
    const key = this.getKey(labelsObj);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  dec(labelsObj = {}, value = 1) {
    const key = this.getKey(labelsObj);
    const current = this.values.get(key) || 0;
    this.values.set(key, Math.max(0, current - value));
  }

  getKey(labelsObj) {
    return this.labels.map((l) => labelsObj[l] || '').join('|');
  }

  collect() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [key, value] of this.values) {
      const labelValues = key.split('|');
      const labelStr =
        this.labels.length > 0
          ? `{${this.labels.map((l, i) => `${l}="${labelValues[i]}"`).join(',')}}`
          : '';
      lines.push(`${this.name}${labelStr} ${value}`);
    }
    return lines.join('\n');
  }
}

class Histogram {
  constructor(name, help, labels = [], buckets = DEFAULT_BUCKETS) {
    this.name = name;
    this.help = help;
    this.labels = labels;
    this.buckets = buckets.sort((a, b) => a - b);
    this.observations = new Map();
  }

  observe(labelsObj = {}, value) {
    const key = this.getKey(labelsObj);
    if (!this.observations.has(key)) {
      this.observations.set(key, {
        buckets: new Map(this.buckets.map((b) => [b, 0])),
        sum: 0,
        count: 0,
      });
    }

    const obs = this.observations.get(key);
    obs.sum += value;
    obs.count += 1;

    for (const bucket of this.buckets) {
      if (value <= bucket) {
        obs.buckets.set(bucket, obs.buckets.get(bucket) + 1);
      }
    }
  }

  getKey(labelsObj) {
    return this.labels.map((l) => labelsObj[l] || '').join('|');
  }

  collect() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];

    for (const [key, obs] of this.observations) {
      const labelValues = key.split('|');
      const baseLabelStr =
        this.labels.length > 0
          ? this.labels.map((l, i) => `${l}="${labelValues[i]}"`).join(',')
          : '';

      let cumulative = 0;
      for (const bucket of this.buckets) {
        cumulative += obs.buckets.get(bucket);
        const labelStr = baseLabelStr ? `{${baseLabelStr},le="${bucket}"}` : `{le="${bucket}"}`;
        lines.push(`${this.name}_bucket${labelStr} ${cumulative}`);
      }

      const infLabelStr = baseLabelStr ? `{${baseLabelStr},le="+Inf"}` : `{le="+Inf"}`;
      lines.push(`${this.name}_bucket${infLabelStr} ${obs.count}`);

      const sumLabelStr = baseLabelStr ? `{${baseLabelStr}}` : '';
      lines.push(`${this.name}_sum${sumLabelStr} ${obs.sum}`);
      lines.push(`${this.name}_count${sumLabelStr} ${obs.count}`);
    }

    return lines.join('\n');
  }
}

// =============================================================================
// GASdf Metrics
// =============================================================================

// Request counters
const quotesTotal = new Counter('gasdf_quotes_total', 'Total number of quote requests', ['status']);

const submitsTotal = new Counter('gasdf_submits_total', 'Total number of submit requests', [
  'status',
]);

const burnsTotal = new Counter('gasdf_burns_total', 'Total number of burn operations', ['status']);

// Gauges
const feePayerBalance = new Gauge(
  'gasdf_fee_payer_balance_lamports',
  'Fee payer balance in lamports',
  ['pubkey']
);

const pendingSwapAmount = new Gauge(
  'gasdf_pending_swap_amount_lamports',
  'Amount of lamports pending to be swapped to ASDF',
  []
);

const activeQuotes = new Gauge('gasdf_active_quotes', 'Number of active quotes', []);

const circuitBreakerState = new Gauge(
  'gasdf_circuit_breaker_state',
  'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  ['name']
);

// Histograms
const quoteDuration = new Histogram(
  'gasdf_quote_duration_seconds',
  'Quote request duration in seconds',
  ['status'],
  [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]
);

const submitDuration = new Histogram(
  'gasdf_submit_duration_seconds',
  'Submit request duration in seconds',
  ['status'],
  [0.1, 0.5, 1, 2, 5, 10, 30]
);

// HTTP request metrics
const httpRequestsTotal = new Counter('gasdf_http_requests_total', 'Total HTTP requests', [
  'method',
  'path',
  'status',
]);

const httpRequestDuration = new Histogram(
  'gasdf_http_request_duration_seconds',
  'HTTP request duration in seconds',
  ['method', 'path'],
  [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
);

// Register all metrics
metrics.set('gasdf_quotes_total', quotesTotal);
metrics.set('gasdf_submits_total', submitsTotal);
metrics.set('gasdf_burns_total', burnsTotal);
metrics.set('gasdf_fee_payer_balance_lamports', feePayerBalance);
metrics.set('gasdf_pending_swap_amount_lamports', pendingSwapAmount);
metrics.set('gasdf_active_quotes', activeQuotes);
metrics.set('gasdf_circuit_breaker_state', circuitBreakerState);
metrics.set('gasdf_quote_duration_seconds', quoteDuration);
metrics.set('gasdf_submit_duration_seconds', submitDuration);
metrics.set('gasdf_http_requests_total', httpRequestsTotal);
metrics.set('gasdf_http_request_duration_seconds', httpRequestDuration);

// =============================================================================
// Collection and Export
// =============================================================================

function collect() {
  const lines = [];

  // Add process metrics
  lines.push('# HELP process_uptime_seconds Process uptime in seconds');
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${process.uptime()}`);

  lines.push('# HELP nodejs_heap_size_total_bytes Total heap size in bytes');
  lines.push('# TYPE nodejs_heap_size_total_bytes gauge');
  lines.push(`nodejs_heap_size_total_bytes ${process.memoryUsage().heapTotal}`);

  lines.push('# HELP nodejs_heap_size_used_bytes Used heap size in bytes');
  lines.push('# TYPE nodejs_heap_size_used_bytes gauge');
  lines.push(`nodejs_heap_size_used_bytes ${process.memoryUsage().heapUsed}`);

  // Collect all registered metrics
  for (const metric of metrics.values()) {
    lines.push('');
    lines.push(metric.collect());
  }

  return lines.join('\n');
}

// =============================================================================
// Express Middleware
// =============================================================================

function metricsMiddleware(req, res, next) {
  if (!config.PROMETHEUS_ENABLED) {
    return next();
  }

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;

    // Normalize path (remove dynamic segments)
    let path = req.path;
    // Replace UUIDs
    path = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
    // Replace pubkeys
    path = path.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, ':pubkey');

    httpRequestsTotal.inc({ method: req.method, path, status: res.statusCode });
    httpRequestDuration.observe({ method: req.method, path }, duration);
  });

  next();
}

module.exports = {
  // Metric classes
  Counter,
  Gauge,
  Histogram,

  // Pre-defined metrics
  quotesTotal,
  submitsTotal,
  burnsTotal,
  feePayerBalance,
  pendingSwapAmount,
  activeQuotes,
  circuitBreakerState,
  quoteDuration,
  submitDuration,
  httpRequestsTotal,
  httpRequestDuration,

  // Functions
  collect,
  metricsMiddleware,

  // Registry access
  metrics,
};
