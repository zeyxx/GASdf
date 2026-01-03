# GASdf - TODO

## Completed (2026-01-03)

- [x] ESLint + Prettier configured
- [x] Coverage thresholds enforced (55%/45%/50%/55%)
- [x] Jest open handles warnings fixed
- [x] Discord CI alerting (webhook configured)
- [x] db.js unit tests (42 tests)
- [x] All lint warnings fixed (unused variables prefixed with `_`)
- [x] 895 tests passing
- [x] Test coverage increased to 67% (1097 tests passing)
- [x] Added 158 new unit tests (tokens, admin, stats, tx-queue, pyth, revenue-channels)
- [x] Added 21 flow tests for quote endpoint lifecycle
- [x] Added E2E test suite (20 tests: quote, tokens, burn worker, submit)
- [x] npm run test:e2e command
- [x] ARCHITECTURE.md for developer onboarding
- [x] MONITORING.md with Grafana Cloud setup guide
- [x] validator.js security tests (52% → 81% coverage)
- [x] alerting.js tests improved (30% → 58% coverage)
- [x] burn.js tests improved (57% → 62% coverage)
- [x] k6 load test script
- [x] fee-payer-pool.js tests (29% → 46% coverage)
- [x] anomaly-detector.js tests (25% → 46% coverage)
- [x] data-sync.js tests (7% → 94% coverage)
- [x] db.js tests (21% → 73% coverage)
- [x] redis.js tests (49% → 59% coverage)
- [x] rpc.js tests (51% → 60% coverage)
- [x] 1232 tests passing, 74% overall coverage

## Next Steps

- [x] Monitor burn worker (E2E tests added, 76.4% burn ratio confirmed)
- [x] Jito bundles: Currently disabled (optional feature)
- [x] Prometheus metrics enabled (requires `x-metrics-key` header)
- [x] Sentry: Not needed - alerting.js covers fee payer, circuit breaker, Redis alerts
- [x] Prometheus scraper setup (monitoring/ directory with Docker Compose)

## Infrastructure

- **API:** https://gasdf-43r8.onrender.com
- **Status:** https://status.asdfasdfa.tech
- **Discord Alerts:** Configured via GitHub Actions secret
- **Monitoring:** `monitoring/` (Grafana Agent + Docker Compose)

## Notes

- Fee payer: `9F5NUrZYjP5MRmqLBc8vd3rsmXiYQdqAMNF7VdKqM68w`
- Redis + Postgres on Render
- Helius RPC for mainnet
