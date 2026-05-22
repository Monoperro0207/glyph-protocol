---
"@glyphp/types": minor
"@glyphp/core": minor
"@glyphp/client": minor
"@glyphp/server": minor
"@glyphp/cli": minor
"@glyphp/conformance": minor
---

Tool update governance.

A verified card is content-addressed, so a real change to a tool changes its
id — but the protocol did not yet *govern* what a consumer does when an
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
