# @glyphp/attestation-sigstore

## 1.0.0

### Major Changes

- 346973e: First public release (RFC-0008 §4.1 step 3).

  `SigstoreBundleVerifier` performs real cryptographic verification of a Sigstore
  bundle — DSSE signature plus certificate/key chain against injected trust
  material — and enforces the RFC-0008 §3.2 subject-digest binding. It is the only
  verifier that returns `trusted: true`, the verdict `GlyphClient.ensureAttested()`
  requires, so it is what makes `requireAttestation` usable: the structure-only
  `SigstoreVerifier`/`SlsaVerifier` in `@glyphp/client` hardcode `trusted: false`
  and can never open the gate.

  `@sigstore/verify` is a dependency of this package only — `@glyphp/core` and
  `@glyphp/client` take zero new runtime dependencies. Trust material is injected
  by the caller; the package never fetches it.

### Patch Changes

- Updated dependencies [346973e]
  - @glyphp/core@2.0.0

## 0.0.2

### Patch Changes

- Updated dependencies [4418e47]
  - @glyphp/core@1.6.0

## 0.0.1

### Patch Changes

- Updated dependencies [25173f4]
- Updated dependencies [755ebf6]
  - @glyphp/core@1.5.0
