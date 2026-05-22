---
"@glyphp/types": minor
"@glyphp/core": minor
"@glyphp/server": minor
"@glyphp/client": minor
"@glyphp/conformance": minor
---

Inert-data hardening — Glyph protocol `0.2`.

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
