# @glyphp/client

## 1.2.0

### Minor Changes

- 2fa9732: Add `FilePendingAuditQueue` (a persistent `PendingAuditQueue` that mirrors
  `FilePinStore`) and the `glyph audit list` CLI command. The command reads the
  persisted queue (default `~/.glyph/pending-audits.json`, override with `--file`)
  and renders each parked tool update with its diff and a breaking/review verdict,
  read-only. It exits non-zero when any parked update carries a breaking change
  awaiting review, so it can gate CI. Promotion stays a separate step
  (`glyph approve` or the autonomous runner).
- ad538e4: Add `GlyphClient.auditPending()` and the `AuditReport` type. This read-only
  primitive re-verifies every parked tool update in the `PendingAuditQueue`: the
  new card's signature and content hash, any signed update manifest (must verify
  and describe this exact update), and any attestation (run through the registered
  verifiers). It returns one `AuditReport` per entry and never promotes an update
  or drains the queue — promotion is a separate, policy-gated decision.
- 7945823: Add the autonomous audit layer to `GlyphClient`. A new `AutoPromotionPolicy`
  plus `processAudits()` and a background runner (`startAuditRunner()` /
  `stopAuditRunner()` / `flushAudits()`) let the client audit parked tool updates
  on its own and re-pin (promote) the ones that pass — without blocking the live
  workflow, which keeps running on the stable pin.

  Promotion is policy-gated and conservative by default (an unset policy promotes
  nothing). Each flag opens one change class: `allowBreaking`, `allowRiskEscalation`,
  `allowKeyChange`, `requireManifest`, `requireAttestation`. A failed audit is never
  promotable regardless of policy, and only the exact audited card is promoted —
  never a revoked tool. New exports: `AutoPromotionPolicy`, `AuditDecision`,
  `evaluatePromotion`, and `onAuditComplete`.

- 34dcfd4: Implement RFC-0003 public providers registry discovery. Adds the
  `PublicProvidersRegistry` / `RegistryProvider` types, `signProvidersRegistry()`
  - `verifyProvidersRegistry()` in core, and `GlyphClient.discoverProviders(url, {
trustRoot })`. The client fetches a signed provider directory from any URL and
    returns it only when its signature verifies against the `trustRoot` the
    consumer pinned out of band. The registry is a directory, not a name authority:
    `discoverProviders()` never approves a glyph — approval still requires the pin
    store and the normal `diffCards` flow on first `getCard()` per provider.
- 6dc6c84: Add opt-in `resilientUpdates` mode to `GlyphClient`. When enabled, a tool whose
  card changed since approval is no longer rejected with `GlyphNotApprovedError`:
  the new card is parked in a `PendingAuditQueue` for later audit while `call()`
  keeps running the last approved (stable) pin — fail-to-last-known-good instead
  of fail-closed. A never-pinned tool still throws (no stable version to fall back
  to), and under `secureMode` the receipt is verified against the stable pin so a
  server that actually swapped to the unaudited card has its output rejected.

  New exports: `PendingAuditQueue`, `PendingAuditEntry`, `MemoryPendingAuditQueue`,
  and `GlyphClient.pendingAudits()`. Defaults to `false` — existing behavior is
  unchanged.

- 2fb8e2b: Add opt-in `tofu` (trust-on-first-use) to `GlyphClient`. When enabled, a
  never-seen tool is auto-pinned on its first call — after its signature
  verifies — instead of throwing `GlyphNotApprovedError`, so an agent doesn't
  need an explicit `approveCard()` for every new tool. Only the first encounter
  is relaxed: once pinned, a later card change (key swap, schema, risk
  escalation) is gated by the pin exactly as without TOFU, and a card whose
  signature does not verify is never pinned. Defaults to `false` — existing
  behavior unchanged. Requires a PinStore.

### Patch Changes

- Updated dependencies [0e8846b]
- Updated dependencies [34dcfd4]
  - @glyphp/core@1.4.0
  - @glyphp/types@1.5.0

## 1.1.1

### Patch Changes

- 3900f5b: Harden protocol verification edge cases: required scope diffs now require approval, structural attestation helpers no longer satisfy enforcement, key registry resolution is validity-window aware, and conformance verifies key registries cryptographically.
- Updated dependencies [6062ac1]
- Updated dependencies [3900f5b]
  - @glyphp/types@1.4.0
  - @glyphp/core@1.3.1

## 1.1.0

### Minor Changes

- 60f21e0: Add attestation verification with SigstoreVerifier and SlsaVerifier. GlyphClient now supports requireAttestation policy ('none' | 'danger' | 'all') and custom attestationVerifiers to validate external trust attestations before tool execution.
- 85584c8: Add ProviderTrustResolver for provider trust discovery (HTTP, filesystem, explicit entries) with genesis key pinning (TRUSTREG-001/003). Add provider trust enforcement to GlyphClient via `trust` option: unknown providers are rejected, untrusted signing keys are blocked (TRUSTREG-002). Export GlyphTrustError and TrustConfig.
- a8f5656: secureMode strict enforcement: review-only card changes (intent, tags, examples) now require human approval in secureMode. Add `autoApproveReviewChanges` opt-in to restore old behavior. Add automatic receipt verification in secureMode — validates receipt signature against pinned key, outputHash, inspectionHash, and glyphId on every call. Add `verifyReceipts` option to opt out.

### Patch Changes

- Updated dependencies [f34252f]
- Updated dependencies [d868938]
- Updated dependencies [85584c8]
  - @glyphp/core@1.3.0
  - @glyphp/types@1.3.0

## 1.0.2

### Patch Changes

- Updated dependencies [44caa8c]
- Updated dependencies [1df7009]
- Updated dependencies [44caa8c]
  - @glyphp/core@1.2.0
  - @glyphp/types@1.2.0

## 1.0.1

### Patch Changes

- Updated dependencies [94c1b17]
  - @glyphp/types@1.1.0
  - @glyphp/core@1.1.0

## 1.0.0

### Major Changes

- a703d69: Bump every package to **1.0.0** alongside the **Glyph Protocol 1.0** wire
  release. See [`CHANGELOG-PROTOCOL.md`](../CHANGELOG-PROTOCOL.md) for the
  full wire changeset; the package-level highlights are:

  - **Adapters now validate output by default.** `@glyphp/adapter-mcp` and
    `@glyphp/adapter-openapi` honour the declared `outputSchema` via AJV
    (JSON Schema 2020-12). Pass `outputValidation: 'none'` to opt out.
  - **OpenAPI adapter — header / cookie / security / `servers[]`.** Bearer,
    basic and apiKey (header / query / cookie) security schemes; document
    servers[] fallback; per-style query serialisation; non-JSON response
    passthrough.
  - **`@glyphp/server` returns distinct `CONFIRMATION_REQUIRED` vs
    `INVALID_CONFIRMATION`** for missing-token vs unknown / expired /
    mismatched-token. `depth=bogus` rejects with `400 VALIDATION_FAILED`.
  - **`@glyphp/core` — `KeyRegistry` (RFC-0001).** New
    `FileKeyRegistry` / `HttpKeyRegistry` / `StaticKeyRegistry`, plus
    `buildKeyEntry`, `buildKeyRegistry`, `verifyKeyRegistry`,
    `resolveKey`, `fingerprintKey`. `GlyphServer` exposes `GET /keys`
    when configured with a `keyRegistry`.
  - **`@glyphp/cli` — `glyph keys init|rotate|revoke|list`** and
    `glyph init --profile <local-dev|production-server|consumer-agent>`.
  - **`@glyphp/conformance` — four levels** (`discovery`, `execution`,
    `security`, `governance`) with badge-shaped JSON + Markdown reports
    and standard fixture glyphs (`registerFixtures`).
  - **New framework integration packages** under `@glyphp/integration-*`:
    Vercel AI, LangChain, LlamaIndex, OpenAI Agents.
  - **Schema additions.** New `MALFORMED_JSON`, `INTERNAL_ERROR`,
    `KEY_REVOKED` error codes; new `key-registry.schema.json`.
  - **Cross-language SDKs.** `glyph-protocol` (PyPI) and the Go module
    at `github.com/Monoperro0207/glyph-protocol/sdks/go/glyphprotocol`
    ship at the same 1.0 cycle, sharing canonical test vectors with the
    TypeScript reference.

### Patch Changes

- Updated dependencies [704a89f]
- Updated dependencies [a703d69]
  - @glyphp/types@1.0.0
  - @glyphp/core@1.0.0

## 0.3.0

### Minor Changes

- 6cba6c8: Production-grade defaults for consumer-side update governance.

  - `FilePinStore` — a persistent `PinStore` that writes pins atomically to a
    JSON file. Survives restarts. Recommended for any deployed agent.
  - `secureMode: true` on `GlyphClient` refuses to construct without a
    `PinStore` configured, so a tool that has not been deliberately approved
    can never run.
  - New CLI commands: `glyph pins list`, `glyph approve <card>`,
    `glyph revoke <tool>`, `glyph manifest verify <src>`. Pins live at
    `~/.glyph/pins.json` by default; `--file <path>` keeps a project-local
    store.

  All additions are opt-in — existing callers that do not pass `secureMode`
  or use the new CLI commands behave exactly as before.

## 0.2.0

### Minor Changes

- 9236a66: Inert-data hardening — Glyph protocol `0.2`.

  The server now sanitizes every call result before delivery: it strips
  invisible Unicode (the tag block, zero-width characters, bidirectional
  overrides) and C0/C1 control characters, then applies NFKC normalization. The
  `SealedEnvelope` carries an `inspection` report of what was removed, and the
  signed `CallReceipt` commits to it via a new `inspectionHash` field.
  `@glyphp/core` exports a new pure `sanitize()`. `@glyphp/client` exports a
  spotlighting render layer (`renderEnvelope`, `dataPreamble`) that wraps tool
  output in an unforgeable nonce-delimited data block.

  This is a breaking wire change: `PROTOCOL_VERSION` is now `0.2`, and `0.1`
  peers are rejected at handshake with `426 PROTOCOL_VERSION_UNSUPPORTED`.

- 6d6ec5a: P0 hardening from the external audit.

  `@glyphp/client` — `GlyphClient` now accepts `authToken`, `headers` and a
  `fetch` override in its constructor, so it can talk to a server with bearer-token
  auth enabled (previously impossible with the official client). Glyph names are
  now percent-encoded into request paths.

  `@glyphp/server` — the rate limiter can no longer be bypassed by rotating fake
  bearer tokens: a token only earns its own bucket once it is verified, otherwise
  the request is keyed by IP. A malformed JSON request body now returns a
  `400 MALFORMED_JSON` `GlyphError` instead of an unhandled `500`. `register()`
  throws instead of silently overwriting when a glyph name is already registered.

- fcf5721: Tool update governance.

  A verified card is content-addressed, so a real change to a tool changes its
  id — but the protocol did not yet _govern_ what a consumer does when an
  approved tool changes underneath it. This adds that layer. It is entirely
  additive: no wire-breaking change, `PROTOCOL_VERSION` stays `0.2`.

  `@glyphp/client` — `GlyphClient` accepts a `PinStore`. It verifies every card
  signature, pins an approved `(id, publicKey)` pair per tool, and refuses in
  `call()` any tool that is new, changed, or revoked. New surface: `inspectCard`,
  `approveCard`, `revokeTool`, `inspectLexicon`, `getManifest`, `MemoryPinStore`,
  and the `GlyphVerificationError` / `GlyphNotApprovedError` / `GlyphRevokedError`
  error types.

  `@glyphp/core` — `diffCards()` classifies how two cards differ (breaking vs
  review changes); `signManifest()` / `verifyManifest()` sign and verify update
  manifests.

  `@glyphp/server` — `registerManifest()` publishes a signed `UpdateManifest`,
  served from the new optional `GET /glyphs/:name/manifest` endpoint.

  `@glyphp/cli` — `glyph diff-card <old> <new>` classifies how two cards differ
  and exits non-zero on a breaking change.

  `@glyphp/types` — new `Pin`, `CardDiff`, `CardFieldChange` and `UpdateManifest`
  types, and the `MANIFEST_VERSION` constant.

  The lifecycle, pinning model and update manifest are specified in
  `spec/update-governance.md`.

### Patch Changes

- Updated dependencies [9236a66]
- Updated dependencies [fcf5721]
  - @glyphp/types@0.2.0
  - @glyphp/core@0.2.0
