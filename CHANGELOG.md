# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
