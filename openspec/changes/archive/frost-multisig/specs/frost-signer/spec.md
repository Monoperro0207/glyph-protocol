# frost-signer Specification

## Purpose

Define the `FrostSigner` strategy implementing RFC 9591 FROST threshold signing. Produces standard ed25519 signatures from M-of-N partial signatures with support for autonomous and approval-required signing policies.

## Requirements

| # | Requirement | Strength |
|---|-------------|----------|
| R1 | FrostSigner MUST aggregate M-of-N partial signatures into a standard ed25519 signature | MUST |
| R2 | FrostSigner MUST reject signing when fewer than M partial signatures are collected | MUST |
| R3 | Aggregated FROST signatures MUST pass standard `crypto.verify()` verification | MUST |
| R4 | FrostSigner MUST support both `auto` and `approval-required` signing policies per participant | MUST |

### Requirement: Threshold signature aggregation

`FrostSigner` SHALL coordinate two-round signing (commit → signShare → aggregate) across M of N participants using `@noble/curves` `ed25519_FROST`. The resulting signature MUST be indistinguishable from a single-key ed25519 signature.

#### Scenario: Successful 2-of-3 aggregation

- GIVEN 3 FROST shares produced by trusted-dealer keygen with threshold 2
- WHEN 2 signers produce partial signatures for the same message
- THEN the aggregated result is a valid standard ed25519 signature

#### Scenario: Insufficient partials rejected

- GIVEN 3 FROST shares with threshold 3
- WHEN only 2 partial signatures are collected
- THEN `signGlyph()` rejects with an error indicating insufficient signers (M-of-N threshold not met)

#### Scenario: Aggregated signature passes standard verification

- GIVEN a valid FROST-aggregated signature from a 2-of-3 setup
- WHEN verified with `crypto.verify(groupPublicKey, message, signature)`
- THEN it returns `true` — verifiers need no FROST awareness

### Requirement: Signing policy support

`FrostSigner` SHALL delegate per-participant signing decisions to configurable policies.

#### Scenario: Auto policy signs immediately

- GIVEN a signer configured with policy `auto`
- WHEN `signGlyph()` requests its partial signature
- THEN it computes and returns the signature share without waiting for external input

#### Scenario: Approval-required policy awaits authorization

- GIVEN a signer configured with policy `approval-required`
- WHEN `signGlyph()` requests its partial signature
- THEN it returns a pending request identifier and SHALL wait for explicit approval before producing the share
