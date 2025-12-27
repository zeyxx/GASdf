# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-12-27

### Added

- **Multi-RPC Failover**: Automatic failover between RPC providers (Helius → Triton → Public)
  - Circuit breaker per endpoint with health tracking
  - Latency monitoring and success rate metrics
  - `GET /health` now includes `rpcPool` status with per-endpoint details

- **Burn Proof System**: Verifiable on-chain burn records
  - `GET /v1/stats/burns` - List recent burns with Solscan explorer links
  - `GET /v1/stats/burns/:signature` - Verify specific burn transaction
  - Each burn includes: signature, amount, swap method, timestamp

- **SDK (@gasdf/sdk)**: Minimal JavaScript SDK for easy integration
  - `quote()`, `submit()`, `stats()`, `burnProofs()`, `verifyBurn()`, `health()`
  - TypeScript definitions included
  - Works with any bundler (CommonJS + ESM compatible)

- **API Versioning**: All endpoints now available under `/v1/` prefix
  - Legacy routes (`/quote`, `/submit`, etc.) include deprecation headers
  - Sunset date: July 1, 2025
  - `Link` header points to successor version

- **Public Status Page**: `GET /status` endpoint
  - Upptime-compatible format
  - Component-level health (API, RPC, Database, Oracle)
  - Simple indicators for monitoring integration

- **Test Suite**: Jest tests for core functionality
  - RPC failover tests
  - Burn proof storage tests
  - SDK tests
  - API integration tests

### Changed

- Oracle service now tracks health metrics (latency, error rate, consecutive errors)
- Error cache TTL reduced to 1 minute (was 5 minutes) for faster retry

### Fixed

- Hardcoded burn ratio (0.8) now uses `config.BURN_RATIO` for consistency

## [1.0.0] - 2025-12-26

### Added

- Initial release
- Gasless transaction support for Solana
- Quote and submit endpoints
- K-score token pricing
- 80/20 treasury model (80% burn, 20% operations)
- Fee payer pool with rotation
- Security hardening (Phase 1-3)
- Prometheus metrics
- Alerting and monitoring
