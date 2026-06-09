---
'@glyphp/core': minor
'@glyphp/server': minor
---

Remove the experimental FROST signer; add `GlyphServer.registerAsync` for async signers.

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
