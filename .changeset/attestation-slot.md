---
'@glyphp/types': minor
'@glyphp/core': minor
'@glyphp/conformance': minor
---

Optional execution-attestation slot on `GlyphCard`.

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
