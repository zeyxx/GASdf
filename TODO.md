# GASdf - TODO

## Completed (2026-01-03)

- [x] ESLint + Prettier configured
- [x] Coverage thresholds enforced (55%/45%/50%/55%)
- [x] Jest open handles warnings fixed
- [x] Discord CI alerting (webhook configured)
- [x] db.js unit tests (42 tests)
- [x] All lint warnings fixed (unused variables prefixed with `_`)
- [x] 895 tests passing
- [x] Test coverage increased to 63% (1053 tests passing)
- [x] Added 158 new unit tests (tokens, admin, stats, tx-queue, pyth, revenue-channels)
- [x] Added 17 flow tests for quote endpoint lifecycle

## Next Steps

- [ ] Add E2E tests with test wallet
- [ ] Monitor burn worker in production
- [ ] Review Jito bundle success rate
- [ ] Add Prometheus metrics endpoint scraping
- [ ] Consider adding Sentry for error tracking

## Infrastructure

- **API:** https://gasdf-43r8.onrender.com
- **Status:** https://status.asdfasdfa.tech
- **Discord Alerts:** Configured via GitHub Actions secret

## Notes

- Fee payer: `9F5NUrZYjP5MRmqLBc8vd3rsmXiYQdqAMNF7VdKqM68w`
- Redis + Postgres on Render
- Helius RPC for mainnet
