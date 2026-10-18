# Collaboration Policy — GASdf ↔ @gcrtrd ecosystem

**Status:** draft v0.1 — operator-decided, 2026-10-18
**Scope:** all joint touchpoints between GASdf (gasless relay, operator-owned) and the projects maintained by @gcrtrd (TrenchScanner, XSCanner, TokenSage, CultScreener, and successors).
**Companion docs:** `gasdf-DECISIONS.md` (decisions log), `MVP_SCOPE.md`, `TOKENOMICS.md`.

---

## 1. Purpose & scope

This policy formalizes how two independent projects collaborate across every
aspect — not only technical. It applies to every integration, data flow,
revenue link, and public communication between GASdf and any @gcrtrd project.

It does **not** merge the projects. Each remains sovereign, with its own repo,
revenue, and release cycle. Integration happens through **APIs only**.

## 2. Parties & roles

| Party | Role | Public posture |
|---|---|---|
| **Operator (GASdf)** | Builder of the gasless relay + Kora host. Owns infra, signer, treasury. | Gray zone (proxy pirate) — does not front in external comms. |
| **@gcrtrd** | Builder of TrenchScanner, XSCanner, TokenSage, CultScreener. | Legal/ToS-friendly — front-facing, owns user-facing surfaces and ToS. |

**Division of labor (from decision log C1):**
- @gcrtrd owns legal/ToS-friendly surfaces and user onboarding.
- Operator owns gray-zone data acquisition and gasless execution.
- Neither may front the other's identity in public without consent.

## 3. Technical interface contract

1. **API-only integration.** No shared codebase, no shared database, no shared
   deploy. Communication via normalized JSON/HTTP over the public API.
2. **Versioned API.** GASdf exposes `/v1/*` with a documented contract
   (`docs/api/*.md`). Breaking changes require a version bump and 30 days notice.
3. **Auth.** API keys (per-consumer) + HMAC for privileged calls. No shared
   secrets. Each party rotates its own keys independently.
4. **Rate limits & quotas.** Enforced per API key by GASdf (Kora `rate_limit`,
   plus application-level limits). @gcrtrd's tier (Guest/Retail/Agent) maps to
   GASdf rate limits.
5. **Fail-closed.** If GASdf is unreachable, @gcrtrd surfaces degrade
   gracefully (cached data, delayed scans) — never silently drop user funds.
6. **No direct DB access.** @gcrtrd never reads GASdf's Redis/Postgres;
   GASdf never reads @gcrtrd's DB.
7. **Idempotency.** All mutating calls accept an idempotency key; retries are
   safe.
8. **Deprecation.** 30 days notice before removing an endpoint; migration guide
   provided.

## 4. Economic model

1. **Independent revenues.** Each party keeps its own revenue. No revenue sharing
   unless explicitly agreed in writing per feature.
2. **Fee attribution.** GASdf charges its own fee (flat, see `TOKENOMICS.md`).
   @gcrtrd's monetization (subscriptions, pay-per-scan, x402) is separate.
   GASdf fees are a cost of execution for @gcrtrd's users, not a revenue share.
3. **No cross-subsidy.** GASdf does not subsidize @gcrtrd users' fees below cost.
   Any discount (e.g. ASDF holder tier) is funded by GASdf's own margin, not
   by @gcrtrd.
4. **Burn attribution.** Burns executed via GASdf are attributed to GASdf's
   treasury/protocol. @gcrtrd does not claim burn credit.
5. **Infra cost ownership.** Each party pays its own infra. GASdf's Kora host,
   signer, and RPC costs are GASdf's. @gcrtrd's hosting is @gcrtrd's.
6. **Conditional raise.** Any joint fundraising (e.g. Colosseum, Superteam)
   requires explicit agreement on split and IP transfer (see §6).

## 5. Legal & Terms of Service

1. **Separate ToS.** Each party maintains its own ToS. Users of @gcrtrd
   services agree to @gcrtrd's ToS; users of GASdf agree to GASdf's ToS.
2. **No liability transfer.** GASdf is not liable for @gcrtrd's service
   outcomes (scan accuracy, KOL detection, ML predictions). @gcrtrd is not
   liable for GASdf execution failures.
3. **Compliance boundaries.** @gcrtrd (legal/ToS-friendly) handles all
   user-facing compliance (KYC if needed, ToS enforcement, abuse reports).
   Operator (gray zone) handles data acquisition within its own risk tolerance.
   Neither may push compliance liability onto the other.
4. **Gray-zone isolation.** @gcrtrd must not depend on or reference the
   operator's gray-zone data pipelines in its public-facing surfaces. GASdf's
   public API must not expose gray-zone data.
5. **Regulatory changes.** If a jurisdiction blocks one party's activity, the
   other is not obligated to follow; integration degrades per §3.5.

## 6. Intellectual property & licensing

1. **Code ownership.** Each party owns its own repo and code. No IP transfer
   without a written agreement and, for GASdf, without the Cayman SPC entity
   (per FOUNDATION.md BLOC 3).
2. **License.** GASdf is MIT (confirmed). @gcrtrd projects choose their own
   license. Cross-use of code requires explicit license grant.
3. **Trademarks.** Each party owns its name/brand. No use of the other's brand
   in marketing without written consent.
4. **Patents.** None filed by either party as of this document. If either files,
   the other is notified 30 days before filing if the patent touches the
   integration surface.

## 7. Data governance

1. **Data ownership.** Each party owns the data it collects. GASdf does not claim
   ownership of @gcrtrd's scan results; @gcrtrd does not claim ownership of
   GASdf's cost ledger.
2. **Data flow.** Only aggregated, non-PII data crosses the API boundary (e.g.
   scan counts, fee amounts, tx signatures). No user PII, no wallet-to-identity
   mapping, no raw captures.
3. **Anonymization.** Any data shared must be anonymized per GASdf's pirate-data
   rules (zero-credential forwarding, IP scrubbing). @gcrtrd applies equivalent
   standards on its side.
4. **Retention.** Each party sets its own retention policy. GASdf retains cost
   ledger (JSONL, append-only) indefinitely for proof; @gcrtrd retains scan
   data per its own policy.
5. **Right to delete.** A user requesting deletion from one party does not
   automatically propagate to the other; each handles its own data.

## 8. Security & secrets

1. **No shared secrets.** Each party manages its own keys (API keys, signer
   keys, HMAC secrets). No secret is shared via chat, docs, or git.
2. **Secret storage.** Secrets live in `/etc/cynic/secrets/` (GASdf side) or
   @gcrtrd's equivalent. Never in git, never in logs, never in chat.
3. **Threat model.** Each party is responsible for its own attack surface.
   Integration points (API, x402) are reviewed by both before go-live.
4. **Incident response.** Each party notifies the other within 24h of a
   security incident affecting the integration. Joint post-mortem within 7 days.
5. **Responsible disclosure.** Vulnerabilities in the integration are reported
   privately to the affected party first, with 14 days to patch before public
   disclosure.

## 9. Operational responsibilities

1. **Deployment ownership.** Each party deploys and operates its own services.
   GASdf operates the Kora host + relay-gateway; @gcrtrd operates TrenchScanner
   + XSCanner.
2. **SLA.** No formal SLA at MVP. Best-effort availability. Formal SLA only
   after both parties agree on metrics (uptime, latency p95, error rate).
3. **Monitoring.** Each party monitors its own service. Integration health
   (API reachability, error rates) is checked by both.
4. **On-call.** Each party is on-call for its own service. No shared on-call
   rotation at MVP.
5. **Maintenance windows.** Each party schedules its own maintenance. Breaking
   changes follow §3.8 (30 days notice).

## 10. Governance & decision rights

1. **Sovereignty.** Each party has full decision rights over its own project.
   No veto from the other on internal decisions.
2. **Integration decisions.** Changes to the API contract, fee model, or data
   flow require mutual agreement. Either party may block an integration change.
3. **Disagreement.** If mutual agreement cannot be reached, the status quo
   holds (no change). No escalation beyond the two parties.
4. **Roadmap.** Each party publishes its own roadmap. Joint features require a
   written mini-spec agreed by both before implementation.

## 11. Communication & branding

1. **External comms rule (CYNIC doctrine).** GASdf produces nothing observable
   yet — do not front it in external conversation, pitches, or replies. Talk
   only about shippable products. GASdf appears only once it has a live,
   verifiable output.
2. **@gcrtrd's comms.** @gcrtrd may reference GASdf as an execution layer
   once GASdf has a live, verifiable output (per rule 1).
3. **No joint branding without consent.** Neither party may use the other's
   name/logo in marketing without written consent.
4. **Public statements.** Statements about the collaboration must be accurate
   and non-exclusive ("we integrate with X" not "X is our partner").

## 12. Change management

1. **Policy changes.** This policy is versioned. Changes require mutual
   agreement and a version bump (v0.x → v1.0 when both parties sign off).
2. **Deprecation of integration.** Either party may deprecate the integration
   with 60 days notice. Deprecation includes: API sunset, data flow stop,
   revenue link termination.
3. **Amendment process.** Proposed changes are shared as a PR (or doc diff) to
   both parties. Merged only when both agree.

## 13. Dispute resolution

1. **Direct negotiation.** Disputes are resolved by direct discussion between
   the two parties. No third-party arbitration at MVP.
2. **Mediation (optional).** If direct negotiation fails, a mutually agreed
   mediator may be engaged. Cost split 50/50.
3. **Escalation.** No escalation to legal action without 30 days of attempted
   negotiation.

## 14. Exit / termination

1. **Voluntary exit.** Either party may exit the collaboration at any time with
   30 days notice. No penalty.
2. **Effect of exit.** Integration degrades per §3.5 (fail-closed). Data flows
   stop. Revenue links terminate. No data retention obligation beyond each
   party's own policy.
3. **Surviving clauses.** §5 (legal), §6 (IP), §7 (data), §8 (security) survive
   termination.

---

## Open items (to resolve with @gcrtrd)

- [ ] C1, C2, C3: XSCanner build + integration (decision log)
- [ ] Burn gate model extension (B4)
- [ ] Whether @gcrtrd wants the pay-per-scan MVP on TrenchScanner
- [ ] Revenue split if joint fundraising (Colosseum, Superteam)
- [ ] Entity structure (Cayman SPC) timing for IP transfer
