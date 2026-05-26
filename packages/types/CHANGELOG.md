# @glyphp/types

## 1.3.0

### Minor Changes

- 85584c8: Add ProviderTrustEntry, ProviderPolicies, and RiskTier types for the consumer-side provider trust registry (TRUSTREG-001/002).

## 1.2.0

### Minor Changes

- 44caa8c: Add optional `clientCallId?: string` field to `CallReceipt`. When a client sends a `callId` in the request body, the server now preserves it as `clientCallId` on the receipt while generating its own UUID v4 for `callId`. This is an additive change — existing consumers that ignore the new field continue to work. See [RFC-0005](../spec/rfcs/RFC-0005-receipt-callid.md).

## 1.1.0

### Minor Changes

- 94c1b17: Add an optional scope-based policy layer (RFC-0002).

  - `GlyphCard.requiredScopes?: string[]` is now part of the canonical card
    content, so a change to it produces a new card id and forces consumer
    re-approval.
  - `defineGlyph({ requiredScopes })` declares the scopes the caller must
    carry. An empty/omitted list keeps the previous open-to-any-caller
    behaviour.
  - `new GlyphServer({ policy })` accepts a `PolicyResolver` that maps each
    request to a `CallerPrincipal` carrying scopes and an optional tenant.
  - A scoped glyph called without the required scopes (or without a
    configured resolver) returns `403 INSUFFICIENT_SCOPE` with the missing
    scopes echoed under `details.missing`.

  Backwards compatible: glyphs that don't declare `requiredScopes` keep their
  previous id and behaviour. See `spec/rfcs/RFC-0002-policy-layer.md`.

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

### Minor Changes

- 704a89f: Optional execution-attestation slot on `GlyphCard`.

  A card may now carry an optional `attestation: { type, payload, reference? }`
  envelope — opaque external evidence (Sigstore bundle, SLSA provenance, in-toto
  statement, or vendor-specific format) of what code is running behind the
  declared contract. The field enters canonical content, so a change to it
  moves the card `id`; `diffCards()` flags any change as `breaking`.

  `verifyAttestation()` checks the envelope is well-formed and reports whether
  the `type` is one the SDK has a known schema for. Verifying the payload
  against a trust root (Sigstore registry, OIDC, SLSA verifier, etc.) is the
  consumer's responsibility — the SDK cannot certify its own host process.

  Backwards compatible: a card without an attestation hashes identically to a
  0.2-era card.

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
