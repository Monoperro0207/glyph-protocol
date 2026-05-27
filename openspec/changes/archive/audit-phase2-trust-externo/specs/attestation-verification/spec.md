# Attestation Verification Specification

## Purpose

Enable clients to verify what code and build process produced a glyph card, beyond cryptographic signature integrity. Pluggable verifiers and client-side policy determine whether a card's attestation is trusted.

## Requirements

### Requirement: Verifier Plug-in Interface (ATTESTVERIFY-001)

The system MUST provide a `AttestationVerifier` interface with a `verify(card: GlyphCard)` method. Built-in verifiers for Sigstore bundle, SLSA provenance, and container digest (`sha256:...`) MUST ship. Verifiers MUST return `AttestationResult` with status `valid | invalid | unknown`.

#### Scenario: Sigstore verifier succeeds

- GIVEN a glyph card with a valid Sigstore attestation bundle
- WHEN the Sigstore verifier processes the card
- THEN `AttestationResult.status` is `valid`
- AND the result includes the verified identity

#### Scenario: Container digest verifier succeeds

- GIVEN a glyph card with a `sha256:` container digest attestation
- WHEN the container digest verifier processes the card
- THEN `AttestationResult.status` is `valid`
- AND the digest matches the referenced container image

#### Scenario: Tampered attestation rejected

- GIVEN a glyph card whose attestation has been modified post-signing
- WHEN any verifier processes the card
- THEN `AttestationResult.status` is `invalid`

#### Scenario: Unsupported attestation type

- GIVEN a glyph card with an attestation type that has no registered verifier
- WHEN the verifier registry processes the card
- THEN `AttestationResult.status` is `unknown`

### Requirement: Client Attestation Policy (ATTESTVERIFY-002)

The client MUST support `requireAttestation` policy: `'none' | 'danger' | 'all'`. Cards without attestation SHALL pass when policy is `'none'`. When policy is `'all'`, every card MUST carry a `valid` attestation.

#### Scenario: Policy 'danger' — high-risk tools require attestation

- GIVEN client policy is `requireAttestation: 'danger'`
- WHEN a tool above the danger risk tier has no attestation
- THEN the client rejects the card

#### Scenario: Policy 'danger' — low-risk tools skip attestation

- GIVEN client policy is `requireAttestation: 'danger'`
- WHEN a tool at or below the danger risk tier has no attestation
- THEN the client accepts the card

#### Scenario: Policy 'none' — all cards accepted

- GIVEN client policy is `requireAttestation: 'none'`
- WHEN any card is processed, attested or not
- THEN the client accepts the card

#### Scenario: Policy 'all' — unattested card rejected

- GIVEN client policy is `requireAttestation: 'all'`
- WHEN a card with no attestation is processed
- THEN the client rejects the card with a clear error
