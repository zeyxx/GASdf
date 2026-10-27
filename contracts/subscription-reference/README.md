# Subscription contract — reference (Rust, read-only)

Status: reference copy moved out of CYNIC (`cynic-protocol/src/gasdf/`, CYNIC PR #448).

- This directory is NOT compiled by GASdf. It is the pure decision logic and types
  that were previously in CYNIC, kept here as the contract reference for the
  GASdf subscription flow (quote, session transitions, settlement).
- The production implementation lives in GASdf itself (Kora-based backend).
  Port to the production language is a separate decision.
- Fixtures (`fixtures/`) were loaded by path from the CYNIC tree
  (`/tests/fixtures/gasdf/...`). Adjust paths if you run the tests here.
- Source of truth for the spec: `docs/GASDF_REBUILD_PLAN.md` and the subscription spec.

No secret, key or endpoint is stored in this directory.
