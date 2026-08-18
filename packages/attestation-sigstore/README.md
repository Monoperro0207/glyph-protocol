# @glyphp/attestation-sigstore

Real cryptographic Sigstore-bundle verification for Glyph Protocol cards.

This package implements [RFC-0008 §4.1 step 3](../../spec/rfcs/RFC-0008-execution-attestation.md):
it upgrades Glyph's attestation verification from **structure-only** validation
to a genuine **DSSE signature + certificate-chain** check.

It ships a `SigstoreBundleVerifier` — an opt-in `AttestationVerifier` that
verifies a Sigstore DSSE bundle via
[`@sigstore/verify`](https://www.npmjs.com/package/@sigstore/verify), enforces
the RFC-0008 §3.2 subject-digest binding, and returns `trusted: true` only on a
genuine cryptographic pass.

**That verdict is the point.** The `SigstoreVerifier` / `SlsaVerifier` shipped in
`@glyphp/client` validate envelope *shape* and hardcode `trusted: false`, and
`GlyphClient.ensureAttested()` opens the gate only on `valid && trusted !== false`.
So those verifiers can never satisfy `requireAttestation` — they are diagnostics.
This package is what makes `requireAttestation` usable.

## Install

```bash
npm install @glyphp/attestation-sigstore
```

## Usage

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

Register it as the `sigstore-bundle` attestation type (RFC-0008 §3.1). Do not
also register the legacy structure-only `SigstoreVerifier` for the same type —
`AttestationVerifierRegistry` is keyed by `type`, so the last registration wins.

## Design notes

- **The dependency is light and clean.** `@sigstore/verify` + `@sigstore/bundle`
  + `@sigstore/core` + `@sigstore/protobuf-specs` total **~940 KB**, **4
  packages**, **0 vulnerabilities**, **pure JS** (no native/WASM bindings — it
  uses Node's built-in `crypto`). Safe across the CI matrix.
- **Offline, deterministic verification works.** With injected trust material
  and the transparency-log thresholds set to 0, the verifier performs a real
  ECDSA + DSSE-PAE signature check with no network, Fulcio, or Rekor. The tests
  mint a key, sign an in-toto/SLSA statement, and prove a genuine bundle
  verifies while a tampered or wrong-key bundle fails closed.
- **Separate, injected package by design.** `@sigstore/verify` is a dependency of
  *this* package only. `@glyphp/core` and `@glyphp/client` gain **zero** new
  runtime dependencies; a consumer opts in by passing a configured verifier to
  `GlyphClient`'s `attestationVerifiers`. This keeps the core lean and the trust
  root pluggable.

## What this package does NOT do

- **Distribute trust roots.** The trusted root / TUF refresh is injected by the
  caller; this package never fetches it. Wiring `@sigstore/tuf` (which adds
  network + more deps) for the public-good root remains open (RFC-0008 §8 Q2).
- **Close the semantic residue.** A chain-valid, digest-bound attestation proves
  *which code* ran, never that the code's behavior matches the card's intent.
  The docs MUST NOT claim "guaranteed safe execution" (RFC-0008 §6).

## Test

```bash
pnpm --filter @glyphp/attestation-sigstore exec tsx --test test/*.test.ts
```
