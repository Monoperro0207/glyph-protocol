# @glyphp/core

## 2.0.0

### Major Changes

- 346973e: **Breaking:** `DigestVerifier` now enforces the RFC-0008 §3.2 subject-digest
  binding, and no longer opens the `requireAttestation` gate without one.

  Previously the verifier checked the digest's _format_ only and returned
  `valid: true` with no `trusted` field. Because `GlyphClient.ensureAttested()`
  opens the gate on `valid && trusted !== false`, any well-formed `sha256:…`
  string in a `container-digest` attestation was enough to release a `danger`
  tool — a provider self-claim backed by no external evidence and tied to no
  consumer pin.

  - New `DigestVerifier({ expectedDigest })` option. When the attested digest does
    not equal the pin, verification fails closed with an explicit error.
  - Without `expectedDigest`, the verifier reports `valid: true, trusted: false`
    and can no longer satisfy `requireAttestation`.
  - `details` now carries `subjectBound`.

  **Migration:** if you construct `new DigestVerifier()` and rely on it to pass
  `requireAttestation`, pass the digest of the artifact that serves the card:
  `new DigestVerifier({ expectedDigest: 'sha256:…' })`. If you need the previous
  permissive behavior, you were not getting a security guarantee from it.

## 1.6.0

### Minor Changes

- 4418e47: Fix RFC-0007 §3.1.1: bind the keyless `subjectDigest` to the card's
  **attestation-exclusive** canonical id (new exported `keylessSubjectDigest()`)
  instead of `sha256(card.id)`. The bundle rides inside `card.attestation`,
  which itself enters `card.id`, so the original binding was an unsatisfiable
  fixed point — no keyless-attested card could pass both `verifyGlyph()` and
  keyless verification at once. `KeylessVerifier.verify` now recomputes the
  digest from the received card's content, never from `card.id` (whose own
  integrity stays `verifyGlyph`'s §3.2 check). For a card without an
  attestation the digest still equals `sha256(card.id)`.

## 1.5.0

### Minor Changes

- 755ebf6: Remove the experimental FROST signer; add `GlyphServer.registerAsync` for async signers.

  An external audit (confirmed by testing) found the `FrostSigner` route was
  broken end-to-end: it signed `canonicalHash(card)` while the protocol verifies
  signatures over `card.id`, exposed the FROST public-key package instead of a
  32-byte ed25519 verifying key, and — decisively — the underlying
  `@myecoria/frost-ed25519-blake2b-wasm` uses a BLAKE2b challenge hash, so its
  group signatures can never verify under RFC 8032 ed25519 (`verifyGlyph`).
  No published consumer is affected: `@glyphp/core`'s export map never exposed
  the module. RFC-0006 is updated to Withdrawn with the requirements a future
  implementation must meet.

  `GlyphServer.registerAsync(glyph)` is the new, additive registration path for
  signers that only support asynchronous signing (KMS/HSM-backed, threshold):
  `register()` stays synchronous for the default `Ed25519Signer`.

### Patch Changes

- 25173f4: Security fix: `KeylessVerifier` identity/issuer allow-lists no longer match
  bare prefixes. `repo:acme/tools` used to authorize `repo:acme/tools-evil` via
  `startsWith`; an allow-list entry now matches exactly or as a prefix ending at
  a segment boundary (`:` or `/`). Namespace entries like `repo:acme/` keep
  working. RFC-0007 §4.2 updated to make the boundary rule normative.

## 1.4.0

### Minor Changes

- 0e8846b: Add `KeylessVerifier` (RFC-0007) — an `AttestationVerifier` for the
  `glyph-keyless-v1` attestation type. It performs the dependency-free half of
  keyless verification: parsing the provenance bundle, enforcing the
  subject-digest binding (a bundle cannot be replayed onto another card), and
  matching an optional `KeylessIdentityPolicy` (issuer/identity allow-lists). The
  cryptographic certificate-chain + transparency-log check is **delegated** to an
  injected `KeylessBackend`; without one, a bundle is `valid` (well-formed and
  bound) but `trusted: false` — structural recognition without false confidence.
  New exports: `KeylessVerifier`, `KeylessBundle`, `KeylessIdentityPolicy`,
  `KeylessBackend`. The Sigstore-style backend dependency is intentionally left
  out (RFC-0007 §8) so core stays dependency-light.
- 34dcfd4: Implement RFC-0003 public providers registry discovery. Adds the
  `PublicProvidersRegistry` / `RegistryProvider` types, `signProvidersRegistry()`
  - `verifyProvidersRegistry()` in core, and `GlyphClient.discoverProviders(url, {
trustRoot })`. The client fetches a signed provider directory from any URL and
    returns it only when its signature verifies against the `trustRoot` the
    consumer pinned out of band. The registry is a directory, not a name authority:
    `discoverProviders()` never approves a glyph — approval still requires the pin
    store and the normal `diffCards` flow on first `getCard()` per provider.

### Patch Changes

- Updated dependencies [34dcfd4]
  - @glyphp/types@1.5.0

## 1.3.1

### Patch Changes

- 3900f5b: Harden protocol verification edge cases: required scope diffs now require approval, structural attestation helpers no longer satisfy enforcement, key registry resolution is validity-window aware, and conformance verifies key registries cryptographically.
- Updated dependencies [6062ac1]
  - @glyphp/types@1.4.0

## 1.3.0

### Minor Changes

- f34252f: Add AttestationVerifier interface, AttestationVerifierRegistry, and DigestVerifier. The DigestVerifier validates container image sha256 digests embedded in GlyphCard attestation payloads.
- d868938: `compileJsonSchema()` now throws `SchemaCompilationError` when a JSON Schema cannot be compiled by AJV, rather than silently degrading to `z.unknown()`. Add `outputValidation: 'none'` option as explicit opt-out for passthrough behavior. Export `SchemaCompilationError` and `CompileJsonSchemaOptions` types.

### Patch Changes

- Updated dependencies [85584c8]
  - @glyphp/types@1.3.0

## 1.2.0

### Minor Changes

- 44caa8c: Add `validateSchemaComplexity()` — a recursive pre-compile guard that rejects JSON Schemas with more than 1000 nodes or deeper than 32 levels before they reach AJV. Schemas exceeding the limit throw `SchemaComplexityError` with `code: 'SCHEMA_TOO_COMPLEX'`. Valid schemas pass through without change. This protects against adversarial schemas imported via the OpenAPI or MCP adapters.
- 1df7009: Add GlyphSigner abstraction and FROST threshold signatures

  - `GlyphSigner` interface abstracts card/manifest/receipt signing
  - `Ed25519Signer` preserves current single-key behavior (default)
  - `FrostSigner` enables M-of-N threshold signing via FROST (RFC 9591)
  - `@myecoria/frost-ed25519-blake2b-wasm` for Zcash Foundation reference impl
  - `GlyphServer` accepts optional `signer: GlyphSigner`, backward compatible

### Patch Changes

- Updated dependencies [44caa8c]
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

### Patch Changes

- Updated dependencies [704a89f]
- Updated dependencies [a703d69]
  - @glyphp/types@1.0.0

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

### Patch Changes

- Updated dependencies [9236a66]
- Updated dependencies [fcf5721]
  - @glyphp/types@0.2.0
