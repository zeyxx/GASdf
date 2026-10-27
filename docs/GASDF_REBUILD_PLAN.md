# GASdf Rebuild Plan — Kora core, GASdf economics

> Decision: Kora (solana-foundation) signs and relays. GASdf keeps only
> what Kora cannot do. No Docker: bare Rust binary + systemd (Redis only
> if cache is enabled later).

## Target

```
user (SOL/USDC/whitelisted memecoin)
  → Kora signAndSendTransaction (fee in token, allowlist, rate-limit)
  → fee lands in GASdf treasury ATA
  → sidecar batch (hourly): Jupiter swap → 55,200 lots → ASDF burn
  → ledger: per-tx cost + per-batch burn proof
```

Per-tx burn is replaced by batched burn: same deflation, fewer txs,
measurable. TrenchScanner reconciler still sees standard burns.

## GASdf keeps (sidecar)

- Jupiter pricing + swap execution (currently price-only — must execute).
- Batch swap→burn job + treasury accounting (80/20 model stays).
- Cost ledger + calibration (unitsConsumed per tx via Kora logs/sim).
- Pay-per-scan metering, HolDex allowlist sync, burn-credit attribution.
- `gasdf-sdk` (repoint to Kora JSON-RPC + quote endpoint).

## GASdf deletes

- Node relay paths (`src/routes/quote|submit`, `helius.js` sender,
  fee-payer hot signer) once Kora config covers them. Helius RPC stays
  as read-only data source (free tier) until proven otherwise.
- Duplicate monitoring/rate-limit already built into Kora.

## Hosting (no Docker)

- `kora` binary (pinned audited tag) + `kora.toml` (fee token, allowlist,
  our signer via Turnkey/privkey) + systemd unit, 24/7 on CYNIC host.
- Sidecar: existing Node service, slimmed, same host.
- Secrets: `/etc/cynic/secrets/gasdf/` only (signer config, no values in git).

## Phases

0. Pin Kora tag + `kora.toml` devnet, boot bare binary, 1 relayed tx.
1. Sidecar: Jupiter swap execution + batch burn job, devnet proof.
2. Delete Node relay paths; full suite green on Kora flow.
3. Mainnet: funded treasury, 24/7 unit, alerts. Then GCRtrd integration.
