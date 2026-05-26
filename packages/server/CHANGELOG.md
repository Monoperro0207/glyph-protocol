# @glyphp/server

## 1.3.1

### Patch Changes

- Updated dependencies [6062ac1]
- Updated dependencies [3900f5b]
  - @glyphp/types@1.4.0
  - @glyphp/core@1.3.1

## 1.3.0

### Minor Changes

- 8ec3e34: Add `strictProduction` option to `GlyphServerOptions`. When `NODE_ENV=production` and `strictProduction: true` (the default in production), the constructor throws if auth, rateLimit, or a stable keyPair/signer are missing. When `strictProduction: false`, only a warning is logged. Non-production environments are unaffected. Update `glyph init production-server` scaffold to include `strictProduction: true`.

### Patch Changes

- Updated dependencies [f34252f]
- Updated dependencies [d868938]
- Updated dependencies [85584c8]
  - @glyphp/core@1.3.0
  - @glyphp/types@1.3.0

## 1.2.0

### Minor Changes

- 1df7009: Add GlyphSigner abstraction and FROST threshold signatures

  - `GlyphSigner` interface abstracts card/manifest/receipt signing
  - `Ed25519Signer` preserves current single-key behavior (default)
  - `FrostSigner` enables M-of-N threshold signing via FROST (RFC 9591)
  - `@myecoria/frost-ed25519-blake2b-wasm` for Zcash Foundation reference impl
  - `GlyphServer` accepts optional `signer: GlyphSigner`, backward compatible

- 44caa8c: **Operational hardening** — three security improvements:

  - **Confirmation backlog limit.** Added `maxPendingConfirmations` option (default 10 000). When the pending confirmation map is full, the server returns `503 CONFIRMATION_BACKLOG_FULL` with a `Retry-After` header. The sweep is now unconditional rather than conditional on reaching a soft threshold.
  - **Body size limit.** Added `maxBodyBytes` option (default 1 MiB). Requests exceeding the limit are rejected with `413 PAYLOAD_TOO_LARGE`. The `readJson()` helper checks `Content-Length` upfront and falls back to a streaming counter when absent.
  - **Constant-time token comparison.** Bearer token checks now use SHA-256 hashing + `crypto.timingSafeEqual` instead of `Array.includes()`, eliminating timing-based token enumeration.

  **Receipt version 0.3.** `callId` is now always server-generated (`randomUUID()` v4). The client-supplied value, if present, is preserved in the new optional `clientCallId` field on `CallReceipt`. `RECEIPT_VERSION` is bumped from `0.2` to `0.3`. See [RFC-0005](../spec/rfcs/RFC-0005-receipt-callid.md).

### Patch Changes

- Updated dependencies [44caa8c]
- Updated dependencies [1df7009]
- Updated dependencies [44caa8c]
  - @glyphp/core@1.2.0
  - @glyphp/types@1.2.0

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

- 2c64c2d: P1 hardening from the external audit.

  `@glyphp/server` — a glyph handler now receives a `GlyphHandlerContext` with an
  `AbortSignal` that fires when the call exceeds its timeout, so a cooperating
  handler can stop doing real work instead of running on in the background after
  the `504`.

  `@glyphp/adapter-openapi` / `@glyphp/adapter-mcp` — the JSON Schema → Zod
  conversion is now recursive: enums, typed arrays, nested objects and common
  string formats are enforced, instead of only a value's top-level type.

  `@glyphp/cli` — `glyph init` scaffolds `@glyphp/server` at `latest` rather than
  a pinned version that goes stale.

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
