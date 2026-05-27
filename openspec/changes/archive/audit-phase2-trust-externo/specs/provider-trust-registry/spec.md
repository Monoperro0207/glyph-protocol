# Provider Trust Registry Specification

## Purpose

Establish a federated trust model where clients can trust provider organizations by identity and public keys, without per-tool key pinning. Discovery happens via filesystem and HTTP, with genesis-key pinning for bootstrap trust.

## Requirements

### Requirement: Registry Discovery (TRUSTREG-001)

The client MUST resolve a `ProviderTrustRegistry` from two sources in order: HTTP `/.well-known/glyph-trust`, then filesystem `.glyph-trust.json`. The first successful resolution SHALL be used.

#### Scenario: HTTP discovery succeeds

- GIVEN a provider hosts `/.well-known/glyph-trust` with valid trust metadata
- WHEN the client resolves the registry
- THEN the HTTP registry is loaded
- AND filesystem fallback is not attempted

#### Scenario: Filesystem fallback when HTTP unavailable

- GIVEN HTTP discovery is unreachable or returns 404
- WHEN the client resolves the registry
- THEN the local `.glyph-trust.json` is loaded

#### Scenario: No registry available

- GIVEN neither HTTP nor filesystem discovery succeeds
- WHEN the client resolves the registry
- THEN the client falls back to per-tool key pinning
- AND emits a discovery-failure warning

### Requirement: Client Enforcement (TRUSTREG-002)

The client MUST enforce provider identity against the registry. When policy requires registration, calls from unregistered providers SHALL be rejected.

#### Scenario: Trust org by key — no per-tool pinning

- GIVEN a provider is registered in the trust registry with an ed25519 public key
- WHEN the client receives a card signed by that provider's key
- THEN the card is trusted without additional per-tool key pinning

#### Scenario: Unregistered provider rejected

- GIVEN the client policy requires registered providers
- WHEN a card arrives from a provider not in the trust registry
- THEN the client rejects the call

#### Scenario: Permissive policy allows unregistered

- GIVEN the client policy does not require registered providers
- WHEN a card arrives from an unregistered provider
- THEN the client accepts the call
- AND logs a warning

### Requirement: Genesis Key Pinning (TRUSTREG-003)

Each organization entry in the registry MUST include a genesis public key for bootstrap trust. Key rotations MUST chain from the genesis key.

#### Scenario: Genesis key pinned on first trust

- GIVEN a provider registry entry with a genesis ed25519 key
- WHEN the client first resolves trust for that org
- THEN the genesis key is pinned as the root of trust

#### Scenario: Key rotation with valid genesis chain

- GIVEN a rotated key signed by the genesis key
- WHEN the client encounters the rotated key
- THEN the client accepts it as a valid successor

#### Scenario: Key rotation without genesis chain rejected

- GIVEN a key claiming to replace the current org key
- WHEN the key lacks a valid chain back to the pinned genesis key
- THEN the client rejects the key and logs a trust-chain failure
