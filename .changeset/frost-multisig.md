---
"@glyphp/server": minor
"@glyphp/core": minor
---

Add GlyphSigner abstraction and FROST threshold signatures

- `GlyphSigner` interface abstracts card/manifest/receipt signing
- `Ed25519Signer` preserves current single-key behavior (default)
- `FrostSigner` enables M-of-N threshold signing via FROST (RFC 9591)
- `@myecoria/frost-ed25519-blake2b-wasm` for Zcash Foundation reference impl
- `GlyphServer` accepts optional `signer: GlyphSigner`, backward compatible
