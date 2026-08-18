---
'@glyphp/core': major
---

**Breaking:** `DigestVerifier` now enforces the RFC-0008 §3.2 subject-digest
binding, and no longer opens the `requireAttestation` gate without one.

Previously the verifier checked the digest's *format* only and returned
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
