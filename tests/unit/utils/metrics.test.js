/**
 * Tests for Prometheus-style Metrics
 */

const {
  Counter,
  Gauge,
  Histogram,
  quotesTotal,
  submitsTotal,
  burnsTotal,
  feePayerBalance,
  activeQuotes,
  circuitBreakerState,
  quoteDuration,
  httpRequestsTotal,
  collect,
  metricsMiddleware,
  metrics,
} = require('../../../src/utils/metrics');

// Mock config
jest.mock('../../../src/utils/config', () => ({
  PROMETHEUS_ENABLED: true,
}));

describe('Metrics Module', () => {
  describe('Counter class', () => {
    let counter;

    beforeEach(() => {
      counter = new Counter('test_counter', 'A test counter', ['method', 'status']);
    });

    it('should create counter with name and help', () => {
      expect(counter.name).toBe('test_counter');
      expect(counter.help).toBe('A test counter');
    });

    it('should increment by 1 by default', () => {
      counter.inc({ method: 'GET', status: '200' });
      expect(counter.values.get('GET|200')).toBe(1);
    });

    it('should increment by specified value', () => {
      counter.inc({ method: 'POST', status: '201' }, 5);
      expect(counter.values.get('POST|201')).toBe(5);
    });

    it('should accumulate increments', () => {
      counter.inc({ method: 'GET', status: '200' });
      counter.inc({ method: 'GET', status: '200' });
      counter.inc({ method: 'GET', status: '200' }, 3);
      expect(counter.values.get('GET|200')).toBe(5);
    });

    it('should track different label combinations separately', () => {
      counter.inc({ method: 'GET', status: '200' });
      counter.inc({ method: 'GET', status: '404' });
      counter.inc({ method: 'POST', status: '200' });

      expect(counter.values.get('GET|200')).toBe(1);
      expect(counter.values.get('GET|404')).toBe(1);
      expect(counter.values.get('POST|200')).toBe(1);
    });

    it('should collect prometheus format output', () => {
      counter.inc({ method: 'GET', status: '200' }, 10);
      const output = counter.collect();

      expect(output).toContain('# HELP test_counter A test counter');
      expect(output).toContain('# TYPE test_counter counter');
      expect(output).toContain('test_counter{method="GET",status="200"} 10');
    });

    it('should handle counter without labels', () => {
      const simpleCounter = new Counter('simple', 'A simple counter');
      simpleCounter.inc({}, 5);

      const output = simpleCounter.collect();
      expect(output).toContain('simple 5');
    });
  });

  describe('Gauge class', () => {
    let gauge;

    beforeEach(() => {
      gauge = new Gauge('test_gauge', 'A test gauge', ['payer']);
    });

    it('should create gauge with name and help', () => {
      expect(gauge.name).toBe('test_gauge');
      expect(gauge.help).toBe('A test gauge');
    });

    it('should set value', () => {
      gauge.set({ payer: 'payer1' }, 100);
      expect(gauge.values.get('payer1')).toBe(100);
    });

    it('should overwrite previous value on set', () => {
      gauge.set({ payer: 'payer1' }, 100);
      gauge.set({ payer: 'payer1' }, 50);
      expect(gauge.values.get('payer1')).toBe(50);
    });

    it('should increment value', () => {
      gauge.set({ payer: 'payer1' }, 100);
      gauge.inc({ payer: 'payer1' }, 10);
      expect(gauge.values.get('payer1')).toBe(110);
    });

    it('should decrement value', () => {
      gauge.set({ payer: 'payer1' }, 100);
      gauge.dec({ payer: 'payer1' }, 30);
      expect(gauge.values.get('payer1')).toBe(70);
    });

    it('should not go below zero on decrement', () => {
      gauge.set({ payer: 'payer1' }, 10);
      gauge.dec({ payer: 'payer1' }, 100);
      expect(gauge.values.get('payer1')).toBe(0);
    });

    it('should collect prometheus format output', () => {
      gauge.set({ payer: 'payer1' }, 1.5);
      const output = gauge.collect();

      expect(output).toContain('# HELP test_gauge A test gauge');
      expect(output).toContain('# TYPE test_gauge gauge');
      expect(output).toContain('test_gauge{payer="payer1"} 1.5');
    });
  });

  describe('Histogram class', () => {
    let histogram;

    beforeEach(() => {
      histogram = new Histogram('test_histogram', 'A test histogram', ['path'], [0.1, 0.5, 1]);
    });

    it('should create histogram with name and help', () => {
      expect(histogram.name).toBe('test_histogram');
      expect(histogram.help).toBe('A test histogram');
    });

    it('should have sorted buckets', () => {
      expect(histogram.buckets).toEqual([0.1, 0.5, 1]);
    });

    it('should observe values', () => {
      histogram.observe({ path: '/quote' }, 0.25);
      histogram.observe({ path: '/quote' }, 0.75);

      const obs = histogram.observations.get('/quote');
      expect(obs).toBeDefined();
      expect(obs.count).toBe(2);
      expect(obs.sum).toBe(1.0);
    });

    it('should place values in correct buckets', () => {
      histogram.observe({ path: '/quote' }, 0.05); // <= 0.1
      histogram.observe({ path: '/quote' }, 0.25); // <= 0.5
      histogram.observe({ path: '/quote' }, 0.8);  // <= 1

      const obs = histogram.observations.get('/quote');
      // Buckets are stored in a Map with bucket boundary as key
      expect(obs.buckets.get(0.1)).toBe(1); // 0.1 bucket: 1 value (0.05)
      expect(obs.buckets.get(0.5)).toBe(2); // 0.5 bucket: 2 values (0.05, 0.25)
      expect(obs.buckets.get(1)).toBe(3);   // 1 bucket: 3 values (0.05, 0.25, 0.8)
    });

    it('should collect prometheus format output', () => {
      histogram.observe({ path: '/test' }, 0.25);
      const output = histogram.collect();

      expect(output).toContain('# HELP test_histogram A test histogram');
      expect(output).toContain('# TYPE test_histogram histogram');
      expect(output).toContain('test_histogram_bucket');
      expect(output).toContain('test_histogram_sum');
      expect(output).toContain('test_histogram_count');
    });
  });

  describe('Pre-defined metrics', () => {
    it('quotesTotal should be a Counter', () => {
      expect(quotesTotal).toBeInstanceOf(Counter);
      expect(quotesTotal.name).toBe('gasdf_quotes_total');
    });

    it('submitsTotal should be a Counter', () => {
      expect(submitsTotal).toBeInstanceOf(Counter);
      expect(submitsTotal.name).toBe('gasdf_submits_total');
    });

    it('burnsTotal should be a Counter', () => {
      expect(burnsTotal).toBeInstanceOf(Counter);
      expect(burnsTotal.name).toBe('gasdf_burns_total');
    });

    it('feePayerBalance should be a Gauge', () => {
      expect(feePayerBalance).toBeInstanceOf(Gauge);
      expect(feePayerBalance.name).toBe('gasdf_fee_payer_balance_lamports');
    });

    it('activeQuotes should be a Gauge', () => {
      expect(activeQuotes).toBeInstanceOf(Gauge);
      expect(activeQuotes.name).toBe('gasdf_active_quotes');
    });

    it('circuitBreakerState should be a Gauge', () => {
      expect(circuitBreakerState).toBeInstanceOf(Gauge);
      expect(circuitBreakerState.name).toBe('gasdf_circuit_breaker_state');
    });

    it('quoteDuration should be a Histogram', () => {
      expect(quoteDuration).toBeInstanceOf(Histogram);
      expect(quoteDuration.name).toBe('gasdf_quote_duration_seconds');
    });

    it('httpRequestsTotal should be a Counter', () => {
      expect(httpRequestsTotal).toBeInstanceOf(Counter);
      expect(httpRequestsTotal.name).toBe('gasdf_http_requests_total');
    });
  });

  describe('collect()', () => {
    it('should return prometheus format string', () => {
      const output = collect();
      expect(typeof output).toBe('string');
    });

    it('should include all registered metrics', () => {
      const output = collect();
      expect(output).toContain('gasdf_quotes_total');
      expect(output).toContain('gasdf_submits_total');
      expect(output).toContain('gasdf_fee_payer_balance');
    });
  });

  describe('metrics registry', () => {
    it('should be a Map', () => {
      expect(metrics).toBeInstanceOf(Map);
    });

    it('should contain registered metrics', () => {
      expect(metrics.size).toBeGreaterThan(0);
    });
  });

  describe('metricsMiddleware', () => {
    it('should be a function', () => {
      expect(typeof metricsMiddleware).toBe('function');
    });

    it('should call next', () => {
      const req = { method: 'GET', path: '/test' };
      const res = { on: jest.fn() };
      const next = jest.fn();

      metricsMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should register finish handler on response', () => {
      const req = { method: 'GET', path: '/test' };
      const res = { on: jest.fn() };
      const next = jest.fn();

      metricsMiddleware(req, res, next);

      expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    });
  });
});
