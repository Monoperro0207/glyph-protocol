# @glyphp/server

## 0.2.1

### Patch Changes

- Updated dependencies [704a89f]
  - @glyphp/types@0.3.0
  - @glyphp/core@0.3.0

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
