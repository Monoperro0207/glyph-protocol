# @glyphp/attestation-sigstore — SPIKE

**Status: spike / proof-of-concept. Private, unpublished.**

This package answers [RFC-0008 §4.1 step 3](../../spec/rfcs/RFC-0008-execution-attestation.md)
and [§8 open question 1](../../spec/rfcs/RFC-0008-execution-attestation.md): can Glyph
upgrade its attestation verifiers from **structure-only** validation to **real
cryptographic** verification, and at what cost?

It ships a `SigstoreBundleVerifier` — an opt-in `AttestationVerifier` that
verifies a Sigstore DSSE bundle's signature and chain via
[`@sigstore/verify`](https://www.npmjs.com/package/@sigstore/verify), enforces
the RFC-0008 §3.2 subject-digest binding, and returns `trusted: true` only on a
genuine cryptographic pass — the verdict that actually opens the
`requireAttestation` gate. Contrast with the shipped
`SigstoreVerifier`/`SlsaVerifier` in `@glyphp/client`, which validate envelope
*shape* and return `trusted: false` (see `examples/08-attestation-gate`).

## Spike findings

- **The dependency is light and clean.** `@sigstore/verify` + `@sigstore/bundle`
  + `@sigstore/core` + `@sigstore/protobuf-specs` total **~940 KB**, **4
  packages**, **0 vulnerabilities**, **pure JS** (no native/WASM bindings — it
  uses Node's built-in `crypto`). Safe across the CI matrix.
- **Offline, deterministic verification works.** With injected trust material
  and the transparency-log thresholds set to 0, the verifier performs a real
  ECDSA + DSSE-PAE signature check with no network, Fulcio, or Rekor. The tests
  mint a key, sign an in-toto/SLSA statement, and prove a genuine bundle
  verifies while a tampered or wrong-key bundle fails closed.
- **Architecture: separate, injected package.** `@sigstore/verify` is a
  dependency of *this* package only. `@glyphp/core` and `@glyphp/client` gain
  **zero** new runtime dependencies; a consumer opts in by passing a configured
  verifier to `GlyphClient`'s `attestationVerifiers`. This is the right shape
  even though the dep is light, because it keeps the core lean and the trust
  root pluggable.

## Usage (illustrative)

```ts
import { GlyphClient } from '@glyphp/client'
import { toTrustMaterial } from '@sigstore/verify'
import { SigstoreBundleVerifier } from '@glyphp/attestation-sigstore'

const client = new GlyphClient({
  baseUrl: 'https://glyph.example',
  requireAttestation: 'danger',
  attestationVerifiers: [
    new SigstoreBundleVerifier({
      trustMaterial: toTrustMaterial(myTrustedRoot), // Fulcio roots, or a key finder
      expectedSubjectDigest: 'sha256-of-the-serving-artifact', // RFC-0008 §3.2 binding
      thresholds: { tlog: 1 }, // require a transparency-log entry for public-good keyless
    }),
  ],
})

// A `danger` tool now executes only if its card carries a bundle that verifies
// cryptographically AND binds to the expected serving-artifact digest.
await client.call('deploy-release', input)
```

## What this spike does NOT do

- **Distribute trust roots.** The trusted root / TUF refresh is injected by the
  caller; wiring `@sigstore/tuf` (which adds network + more deps) for the
  public-good root is the productization follow-up (RFC-0008 §8 Q2).
- **Close the semantic residue.** A chain-valid, digest-bound attestation proves
  *which code* ran, never that the code's behavior matches the card's intent.
  The docs MUST NOT claim "guaranteed safe execution" (RFC-0008 §6).
- **Ship.** Publishing this as a real `@glyphp/*` package (flip `private`, add a
  changeset, decide the public API) is a deliberate release decision, out of
  scope for the spike.

## Run it

```bash
pnpm --filter @glyphp/attestation-sigstore exec tsx --test test/*.test.ts
```
