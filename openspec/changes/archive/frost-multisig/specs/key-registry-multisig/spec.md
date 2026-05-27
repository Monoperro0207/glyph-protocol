# key-registry-multisig Specification

## Purpose

Extend `KeyEntry` with optional `groupKey` metadata so the `KeyRegistry` can store and resolve FROST group keys alongside single keys. Group keys carry threshold parameters and participant identifiers; key rotation and chain-of-trust verification treat them identically to single keys.

## Requirements

| # | Requirement | Strength |
|---|-------------|----------|
| R1 | KeyEntry MUST support an optional `groupKey` field with threshold and participant metadata | MUST |
| R2 | `resolveKey()` MUST return `active` for group keys with valid chain-of-trust | MUST |
| R3 | Key rotation chains from old group key to new group key MUST verify using standard rotation logic | MUST |
| R4 | Existing single-key entries MUST be unaffected — `groupKey` is additive and optional | MUST |

### Requirement: Group key metadata and resolution

`KeyEntry` SHALL accept an optional `groupKey` property containing `threshold: { min, max }` and `participants: string[]`. `resolveKey()` SHALL resolve group key fingerprints using the same verification chain as single keys.

#### Scenario: Group key resolves as active

- GIVEN a KeyRegistry containing a group key entry with `groupKey: { threshold: { min: 2, max: 3 }, participants: ["p1", "p2", "p3"] }`
- WHEN `resolveKey(groupPublicKey)` is called
- THEN it returns status `active` with the group key metadata intact

#### Scenario: Rotation chain includes group keys

- GIVEN a rotation chain from an old group key to a new group key, both with valid `groupKey` metadata
- WHEN the chain is verified by `verifyKeyRegistry()`
- THEN the verification succeeds — group keys rotate using the same signature-based chain-of-trust as single keys, with no special-casing
