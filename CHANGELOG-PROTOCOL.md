# Wire Protocol — Changelog

This file tracks **wire-protocol** changes, separate from the per-package
CHANGELOGs in each `packages/*/CHANGELOG.md`. The wire version is the
`PROTOCOL_VERSION` constant in `@glyphp/types` — clients and servers must
agree on it at the handshake.

## 1.0 — pending

Pending wire-protocol bump to be released alongside the v1.0 stable SDK
line.

Additive on top of 0.2 (all existing 0.2 endpoints remain), plus:

- **New `MALFORMED_JSON`, `INTERNAL_ERROR`, `KEY_REVOKED` error codes.**
  See `spec/schemas/glyph-error.schema.json`.
- **Strict `depth` enum.** `GET /glyphs/:name?depth=<x>` returns
  `400 VALIDATION_FAILED` when `<x>` is not `minimal | standard | rich`.
- **`CONFIRMATION_REQUIRED` vs `INVALID_CONFIRMATION`** are now strictly
  distinguished by code. A missing token returns `CONFIRMATION_REQUIRED`;
  a token that is unknown, expired or bound to a different input returns
  `INVALID_CONFIRMATION`.
- **`GET /keys` Key Registry endpoint** ([RFC-0001](spec/rfcs/RFC-0001-key-registry.md)).
  Optional. Servers that publish a registry advertise their currently
  active key plus any retired or revoked keys, with a verifiable chain of
  trust. Clients gain key rotation and revocation without breaking 0.2
  verification.
- **Adapter output validation.** Glyphs produced by
  `@glyphp/adapter-mcp` and `@glyphp/adapter-openapi` validate handler
  output against the schema declared on the card by default (opt-in
  `outputValidation: 'none'` for the laxer behaviour).
- **OpenAPI adapter — header, cookie, security schemes, servers[].**
  See `packages/adapters/openapi/src/index.ts`.
- **Conformance suite v1.0** — four levels (`discovery`, `execution`,
  `security`, `governance`) with a signed-shape JSON report and a
  badge-compatible markdown render.
- **Canonical test vectors** — `spec/canonical/` documents the exact
  bytes for canonicalize / hashing / signature / sanitize across SDKs.
- **Python and Go SDKs** — `sdks/python/glyph_protocol` and
  `sdks/go/glyphprotocol`. Verify cards, receipts, manifests and key
  registries; consume Glyph servers from non-Node hosts. Pass the same
  canonical vectors as the TS reference implementation.

### Migration from 0.2

A 0.2 server can be upgraded to 1.0 without touching its cards: the new
error codes are additive, `depth` validation rejects only invalid inputs
that were previously misinterpreted, `INVALID_CONFIRMATION` was already
documented as a distinct code, and `GET /keys` is optional. Clients that
predate 1.0 keep working — they simply do not benefit from key rotation
or revocation.

## 0.2 — released

- **Inert-data hardening.** Server-side sanitization of every string in
  an output payload, a signed inspection report on every envelope, and
  the `@glyphp/client` spotlighting render layer.
- **Update governance.** Card pinning, tool lifecycle (approve / review
  on change / revoke), `diffCards`, signed `UpdateManifest`.
- **Hardening.** Optional bearer-token auth and fixed-window rate
  limiting on `GlyphServer`.
- **Adapters.** OpenAPI and MCP adapters become first-class glyph
  producers.

## 0.1 — released

- Initial public spec. Cards, signed by ed25519, served over HTTP.
  Handshake, lexicon, card depth, prepare/call flow, sealed envelope
  with a `CallReceipt`.
