# Release Attestation Hardening Specification

## Purpose

Make SBOM and cosign attestation required for core packages, with visible public status on failure. Non-core packages remain best-effort.

## Requirements

### Requirement: ATTESTPUB-001 — Core Attestation Required

The release workflow MUST split attestation into two jobs: core (required) and rest (best-effort). Core packages (`@glyphp/core`, `@glyphp/server`, `@glyphp/client`, `@glyphp/conformance`) SHALL block the release status on attestation success. On transient failure, the core job MUST retry before marking failure.

#### Scenario: Core attestation succeeds

- GIVEN a release for a core package is triggered
- WHEN SBOM generation and cosign signing complete successfully
- THEN the release status reflects attestation success
- AND the package is published

#### Scenario: Core attestation retries on transient failure

- GIVEN a core package attestation job encounters a transient network error
- WHEN the error is retryable (network timeout, registry unavailable)
- THEN the job retries up to the configured limit
- AND on retry success, the release proceeds normally

#### Scenario: Core attestation retry exhausted

- GIVEN a core package attestation job fails after all retries
- WHEN retries are exhausted
- THEN the release is NOT blocked from publishing
- AND the failure is recorded with visible public status (see ATTESTPUB-002)

### Requirement: ATTESTPUB-002 — Public Status on Failure

If core attestation fails after retry, the release workflow MUST mark the release with a visible status indicating attestation was not completed. This status SHALL be machine-readable and human-visible.

#### Scenario: Failed attestation marks release

- GIVEN core attestation failed after retry exhaustion
- WHEN the release workflow completes
- THEN the release artifacts include an attestation status field set to `failed`
- AND `RELEASE.md` or release notes include a warning about missing attestation

#### Scenario: Non-core attestation failure is silent

- GIVEN a non-core package attestation job fails
- WHEN the release completes
- THEN the failure is logged as a warning
- AND the release status is unaffected
- AND the package is published normally
