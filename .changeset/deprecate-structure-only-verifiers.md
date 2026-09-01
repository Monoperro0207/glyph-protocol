---
'@glyphp/client': patch
---

Deprecate `SigstoreVerifier` and `SlsaVerifier` in favour of
`SigstoreBundleVerifier` from `@glyphp/attestation-sigstore`.

Both validate envelope *shape* and return `trusted: false` unconditionally, so
they can never satisfy `requireAttestation` — they are diagnostics, not security
controls. `SlsaVerifier` in particular reads `subject[0].digest.sha256` without
binding it to anything, so a statement lifted from another artifact passes.

They keep their legacy `type` strings (`sigstore`, `slsa`) rather than the
RFC-0008 §3.1 registered names: `AttestationVerifierRegistry` is keyed by
`type`, so reusing the registered names would let a structure-only verifier
silently displace the chain-verifying one. No runtime behavior changes.
