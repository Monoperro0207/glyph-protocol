---
"@glyphp/core": minor
---

Add `KeylessVerifier` (RFC-0007) — an `AttestationVerifier` for the
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
