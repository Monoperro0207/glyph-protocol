# Conformance Internal Coverage Specification

## Purpose

Boost conformance test coverage for internal execution, security, and governance modules, including negative security paths. Target: >90% statements, >85% branches.

## Requirements

### Requirement: COV-001 — Unit Coverage for Conformance Internals

Unit tests MUST cover internal modules under `packages/conformance/test/` for `execution`, `security`, and `governance` internals. Coverage SHALL reach >90% statements and >85% branches.

#### Scenario: Execution internals have statement coverage

- GIVEN the conformance test suite runs with coverage instrumentation
- WHEN coverage is measured for `execution` internal functions
- THEN statement coverage MUST exceed 90%

#### Scenario: Governance internals have branch coverage

- GIVEN the conformance test suite runs with coverage instrumentation
- WHEN coverage is measured for `governance` internal functions
- THEN branch coverage MUST exceed 85%

#### Scenario: CLI importer has coverage

- GIVEN tests under `packages/cli/test/`
- WHEN those tests execute
- THEN importer-related functions are covered by assertions

### Requirement: COV-002 — Negative Path Coverage

Tests MUST include negative security paths: auth rejection, rate-limit 429 responses, manifest tampering, and key-registry attacks. Each negative path SHALL have at least one test case.

#### Scenario: Auth rejection is tested

- GIVEN a conformance check sends a request without valid auth
- WHEN the target server returns 401 Unauthorized
- THEN the test asserts the conformance check correctly reports the auth failure
- AND does not report a false negative

#### Scenario: Rate limit 429 is handled

- GIVEN a conformance check sends requests exceeding the rate limit
- WHEN the target server returns 429 Too Many Requests
- THEN the test asserts the check reports the rate-limit condition
- AND does not crash or hang

#### Scenario: Manifest tampering is detected

- GIVEN a manifest file has been modified after signing
- WHEN the governance check verifies the manifest
- THEN the test asserts the tampering is detected
- AND the check reports a governance failure

#### Scenario: Key registry attack is resisted

- GIVEN a key registry with an unauthorized key injection attempt
- WHEN the governance check validates the registry
- THEN the test asserts the unauthorized key is rejected
- AND the check reports the violation
