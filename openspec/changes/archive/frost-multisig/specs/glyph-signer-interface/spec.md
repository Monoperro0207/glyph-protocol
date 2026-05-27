# glyph-signer-interface Specification

## Purpose

Define a pluggable `GlyphSigner` interface that decouples signature production from the concrete key type. Enables swapping signing strategies (single-key, FROST, HSM) without changing the server or verifier.

## Requirements

| # | Requirement | Strength | 
|---|-------------|----------|
| R1 | The server MUST delegate all signing to a `GlyphSigner` interface, not a concrete key pair | MUST |
| R2 | `GlyphSigner` MUST expose `publicKey`, `signGlyph`, `signReceipt`, and `signManifest` | MUST |
| R3 | `Ed25519Signer` MUST be the default implementation, preserving current single-key behavior | MUST |
| R4 | Signatures produced by any `GlyphSigner` implementation MUST be standard ed25519 verifiable with `crypto.verify()` | MUST |

### Requirement: GlyphSigner abstraction

The server SHALL call `this.signer.signGlyph(card)` for all signing operations. The server MUST NOT inspect or depend on the concrete signer type.

#### Scenario: Ed25519Signer produces valid ed25519 signature

- GIVEN a GlyphServer constructed with an `Ed25519Signer`
- WHEN a card is registered via `server.register(card)`
- THEN the signature is a valid ed25519 signature verifiable with `crypto.verify(publicKey, card.id, signature)`

#### Scenario: Default signer is Ed25519Signer

- GIVEN a GlyphServer constructed without a `signer` option
- WHEN a card is registered
- THEN it behaves identically to the current single-key implementation, producing ed25519 signatures via the default `Ed25519Signer`

#### Scenario: FrostSigner produces standard ed25519 signature

- GIVEN a GlyphServer with a `FrostSigner` configured as 2-of-3 threshold
- WHEN a card is registered
- THEN the aggregated signature verifies with standard `crypto.verify(groupPublicKey, card.id, signature)` — verifiers are unchanged

#### Scenario: Server is signer-agnostic

- GIVEN any `GlyphSigner` implementation
- WHEN `signGlyph()` is called by the server
- THEN the server does not need to know which implementation is in use; `publicKey`, `signGlyph`, `signReceipt`, and `signManifest` behave uniformly
