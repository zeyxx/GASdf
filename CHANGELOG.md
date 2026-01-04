# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.0] - 2026-01-04

### Added

- **3D Landing Page**: Immersive space experience with Three.js
  - Stars with Harvard spectral classification (12,000 stars)
  - Milky Way particle cloud (6,000 particles)
  - Volumetric nebulae with FBM noise shaders
  - Cosmic dust with drift and parallax
  - Post-processing bloom effects
  - CSS singularity (black hole) fixed in background

- **Enhanced Alerting**: Rich alert messages with detailed context
  - Balance thresholds now include wallet addresses
  - Staleness tracking prevents false-positive alerts during RPC failures
  - Adjusted thresholds: CRITICAL=0.05 SOL, WARNING=0.2 SOL

### Changed

- **HolDex Integration**: Now using `holdex-api.onrender.com` (beta)
- **Token Symbol**: Consistently use `$asdfasdfa` across all documentation
- SDK version bumped to 1.8.0

### Fixed

- Prevent false-positive fee payer alerts on RPC 429 errors
- Balance data now tracks staleness (lastBalanceRefreshSuccess, isStale)

## [1.7.0] - 2026-01-03

### Added

- **Consumer UX Redesign**: Complete landing page overhaul
  - Wallet connection modal with token selector
  - Live HolDex integration for token metadata
  - Real-time burn statistics display
  - Mobile-responsive design

- **SDK Resilience**: Enhanced fetch with timeout, retry, and correlation IDs
  - Automatic retry with exponential backoff
  - Request correlation IDs for debugging
  - Configurable timeouts per request type

### Changed

- Filter spam tokens, show only verified community tokens
- HolDex proxy endpoints for frontend integration

### Fixed

- Handle supply object from proxy correctly
- Use correct ticker symbol from HolDex

## [1.6.0] - 2026-01-01

### Added

- **Helius Priority Fees**: Dynamic priority fee calculation using Helius SDK
  - Automatic priority fee estimation based on network conditions
  - Fallback to default priority fee on API failure

- **Grafana Monitoring**: Complete observability stack
  - Grafana Cloud metrics pusher (InfluxDB protocol)
  - Pre-built dashboard with key metrics
  - Dashboard compatible with Grafana 11 (schema v39)
  - Metrics include: tx count, burn rate, fee payer balance, RPC health

### Changed

- Alerting now delays on startup to avoid duplicate alerts during deploys
- Improved test coverage across multiple services:
  - data-sync: 7% → 94%
  - db.js: 21% → 73%
  - redis.js: 49% → 59%
  - rpc.js: 51% → 60%

### Security

- **Patched bigint-buffer vulnerability (CVE-2025-3194)**
  - Override with `@gsknnft/bigint-buffer@1.4.7`
  - `npm audit` now reports 0 vulnerabilities

## [1.5.4] - 2025-12-31

### Fixed

- **Jupiter API Migration**: Updated from deprecated `quote-api.jup.ag/v6` to `lite-api.jup.ag/swap/v1`
  - Old v6 endpoint was deprecated in September 2025
  - Using lite-api (no API key required) until January 31, 2026
  - TODO: Migrate to `api.jup.ag` with API key before deprecation

- **Fee Payer Thresholds**: Lowered balance thresholds to prevent service disruption
  - Critical threshold: 0.1 SOL → 0.01 SOL
  - Warning threshold: 0.2 SOL → 0.05 SOL
  - Allows service to continue operating with lower fee payer balance

### Changed

- Fee payer status now shows "warning" instead of "critical" at low balances
- Service remains operational with ~0.04 SOL (enough for ~8000 transactions)

## [1.2.5] - 2025-12-28

### Added

- **Comprehensive Test Suite**: Expanded test coverage from 51.73% to 60.55%
  - `routes/quote.test.js`: 19 tests for quote generation, K-score, circuit breaker, fee calculation
  - `routes/submit.test.js`: 30 tests for transaction submission, validation, anti-replay, blockhash
  - `middleware/validation.test.js`: 32 tests for Solana address, base64, UUID validation
  - `middleware/security.test.js`: 22 tests for rate limiting and IP normalization
  - `services/audit.test.js`: 55 tests for audit logging and PII anonymization
  - `services/anomaly-detector.test.js`: 37 tests for anomaly detection thresholds
  - `services/alerting.test.js`: Tests for alert service and webhooks
  - `services/oracle.test.js`: Tests for K-score oracle
  - `utils/redis.test.js`: 27 tests for Redis operations and in-memory fallback
  - `utils/metrics.test.js`: Tests for Prometheus metrics (Counter, Gauge, Histogram)
  - `utils/circuit-breaker.test.js`: Tests for circuit breaker pattern
  - `utils/safe-math.test.js`: 73 tests for safe math operations

### Changed

- **Test Infrastructure**: 587 total tests across 19 test suites
- **Route Coverage**: Improved from 34.93% to 77.02%
  - `quote.js`: 28.12% → 100%
  - `submit.js`: 13.57% → 97.14%

## [1.2.4] - 2025-12-28

### Added

- **Fetch Timeout Utilities**: HTTP request timeout protection (`src/utils/fetch-timeout.js`)
  - `fetchWithTimeout()` - Fetch with AbortController-based timeout
  - `fetchJsonWithTimeout()` - Combined fetch + JSON parsing with timeout
  - `withTimeout()` - Race any promise against a timeout
  - `timeoutPromise()` - Create a rejecting timeout promise
  - `retryWithTimeout()` - Retry function with per-attempt timeout

- **Timeout Constants**: Service-specific timeout values
  - `DEFAULT_TIMEOUT`: 10 seconds for general requests
  - `JUPITER_TIMEOUT`: 15 seconds for Jupiter API (can be slow)
  - `WEBHOOK_TIMEOUT`: 5 seconds for alerting webhooks
  - `HEALTH_CHECK_TIMEOUT`: 3 seconds for health checks

### Changed

- **Jupiter Integration**: All API calls now have 15-second timeout
  - `getQuote()` uses `fetchWithTimeout()` with `JUPITER_TIMEOUT`
  - `getSwapTransaction()` protected against hanging requests
  - Timeout errors include URL and duration for debugging

- **Alerting Service**: Webhook requests have 5-second timeout
  - Prevents hanging on unresponsive webhook endpoints
  - Logs timeout errors with alert context

- **Health Checks**: Individual 3-second timeouts per check
  - Redis, RPC, and fee payer checks wrapped with `withTimeout()`
  - Readiness probe also uses timeout protection
  - Graceful degradation on timeout (returns error status)

### Security

- Prevents service hangs from unresponsive external APIs
- Protects against slow loris-style attacks on health endpoints
- Added 15 new tests for timeout behavior

## [1.2.3] - 2025-12-28

### Added

- **Safe Math Utilities**: Numeric overflow/underflow protection (`src/utils/safe-math.js`)
  - `safeMul()`, `safeDiv()`, `safeAdd()`, `safeSub()` with null return on overflow
  - `safeCeil()`, `safeFloor()` with edge case handling
  - `clamp()` for value range enforcement
  - `safeProportion()` for (a * b) / c with zero-division protection
  - `calculateTreasurySplit()` ensures no lamports lost in 80/20 split
  - `validateSolanaAmount()` for input validation

### Changed

- **Fee Calculation**: Now uses safe math with overflow protection
  - Compute units clamped to Solana max (1,400,000)
  - Fee multiplier calculations protected against overflow
  - Returns `FEE_OVERFLOW` error instead of corrupt values

- **Jupiter Integration**: Safe proportional calculations
  - Division by zero protection on quote responses
  - Validates inAmount/outAmount before calculation
  - Graceful error handling for invalid quote data

- **Burn Worker**: Improved treasury split precision
  - Uses `calculateTreasurySplit()` to prevent lamport loss
  - Validates total amount before processing
  - Floor for burn, remainder for treasury (conservative approach)

### Security

- Fixed potential overflow in priority fee calculation
- Fixed division by zero vulnerability in Jupiter fee conversion
- Added 38 new tests for numeric edge cases

## [1.2.2] - 2025-12-28

### Added

- **Distributed Locking**: Race condition prevention for concurrent operations
  - `acquireLock()`, `releaseLock()`, `isLockHeld()`, `withLock()` utilities
  - Redis-based with in-memory fallback for development
  - Lua script for atomic check-and-delete on release

- **Burn Worker Mutex**: Prevents concurrent burn executions
  - Double-check pattern after lock acquisition
  - 2-minute TTL prevents deadlocks
  - Graceful handling when lock is already held

- **Balance Reservation Mutex**: Prevents race conditions in fee payer pool
  - In-process lock queue for reservation operations
  - Ensures atomic check-and-reserve operations
  - Prevents over-commitment of fee payer balances

### Security

- Fixed race condition where concurrent requests could over-reserve fee payer balance
- Fixed race condition where multiple burn cycles could execute simultaneously
- Added 12 new tests for distributed locking mechanism

## [1.2.1] - 2025-12-28

### Added

- **Transaction Size Validation**: Solana mainnet compliance
  - Validates transaction size against 1,232 byte limit before processing
  - Returns clear error with actual vs max size on rejection
  - Prevents network rejection after fee payer signs

### Changed

- **MAX_COMPUTE_UNITS**: Updated from 400,000 to 1,400,000 (Solana mainnet limit)
  - Allows processing of more complex transactions
  - Aligns with official Solana specifications

### Security

- Added `TX_TOO_LARGE` error code for oversized transactions
- Transaction size check happens before deserialization (defense in depth)

## [1.2.0] - 2025-12-27

### Added

- **Cryptographic Signature Verification**: Ed25519 verification via tweetnacl
  - Full cryptographic validation of user signatures (not just presence check)
  - Protects against signature spoofing attacks

- **Expanded Token Drain Protection**: Comprehensive instruction blocking
  - 11 dangerous Token Program instructions now blocked:
    - Transfer, TransferChecked, Approve, ApproveChecked
    - Burn, BurnChecked, CloseAccount, SetAuthority
    - MintTo, MintToChecked, Revoke
  - 6 dangerous System Program instructions blocked:
    - Transfer, TransferWithSeed, CreateAccountWithSeed
    - Allocate, AllocateWithSeed, AssignWithSeed

- **Durable Nonce Support**: Extended replay protection
  - Automatic detection of durable nonce transactions
  - `detectDurableNonce()` and `getReplayProtectionKey()` utilities
  - Supports offline transaction signing use cases

- **Fee Payer Key Rotation**: Secure key lifecycle management
  - `startKeyRetirement(pubkey, reason)` - Begin graceful retirement
  - `completeKeyRetirement(pubkey)` - Finalize after reservations clear
  - `emergencyRetireKey(pubkey, reason)` - Immediate retirement + cancel reservations
  - `reactivateKey(pubkey)` - Restore non-emergency retired keys
  - `getRotationStatus()` - View all keys with rotation state

- **Audit Log PII Anonymization**: GDPR-friendly logging
  - HMAC-SHA256 hashing replaces truncation
  - Configurable salt via `AUDIT_PII_SALT` environment variable
  - Consistent hashes for correlation without exposing raw data
  - `anonymizeWallet()`, `anonymizeIP()`, `anonymizeToken()` utilities

- **Anomaly Detector Baseline Learning**: Adaptive thresholds
  - 30-minute learning period on startup (configurable)
  - Dynamic thresholds using mean + 3σ calculation
  - Automatic threshold updates every 5 minutes
  - `getBaselineStatus()` to monitor learning progress
  - Environment variables: `BASELINE_LEARNING_PERIOD`, `BASELINE_MIN_SAMPLES`, `BASELINE_STDDEV_MULTIPLIER`

### Changed

- `validateTransaction()` now performs cryptographic signature verification
- Token drain validation checks authority position per instruction type
- Anomaly detector uses dynamic thresholds when baseline is ready
- Audit logs use hashed identifiers instead of truncated strings

### Security

- Security stack expanded from 8 to 12 layers
- All critical gaps from security audit addressed
- Fee payer protection now covers all known drain vectors

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
