# Secure Mode Strict Enforcement Specification

## Purpose

Prevent the `secureMode` auto-approval loophole. In `secureMode`, the client MUST NOT automatically approve ANY card changes — including metadata-only changes (intent, examples, tags, description). An explicit `autoApproveReviewChanges` opt-in restores the prior permissive behavior.

## Requirements

### Requirement: SecureMode Blocks All Auto-Approvals (SECUREMODE-001)

In `secureMode`, the client MUST NOT auto-approve card changes of any kind. Metadata-only changes (intent, examples, tags, description) SHALL require explicit user review and approval, identical to content changes. The `secureMode` flag acts as a circuit breaker — no change bypasses it.

#### Scenario: Metadata change rejected without approval

- GIVEN the client is running with `secureMode: true`
- AND a card's intent field is modified
- WHEN the consumer attempts to process the change
- THEN the change is blocked and requires explicit user approval

#### Scenario: Tag change rejected without approval

- GIVEN the client is running with `secureMode: true`
- AND a card's tags are modified
- WHEN the consumer attempts to process the change
- THEN the change is blocked and requires explicit user approval

#### Scenario: Content change still rejected

- GIVEN the client is running with `secureMode: true`
- AND a card's tool output is modified
- WHEN the consumer attempts to process the change
- THEN the change is blocked and requires explicit user approval

### Requirement: Opt-In Escape Hatch (SECUREMODE-002)

The client MUST support an `autoApproveReviewChanges: true` option that restores the prior behavior where metadata-only changes (intent, examples, tags, description) are auto-approved without user review. This option SHALL be explicitly opt-in and SHALL NOT be the default.

#### Scenario: Opt-in restores metadata auto-approval

- GIVEN the client is running with `secureMode: true` and `autoApproveReviewChanges: true`
- AND a card's description is modified
- WHEN the consumer processes the change
- THEN the metadata change is auto-approved without user review

#### Scenario: Content changes still blocked with opt-in

- GIVEN the client is running with `secureMode: true` and `autoApproveReviewChanges: true`
- AND a card's tool output is modified
- WHEN the consumer processes the change
- THEN the content change is STILL blocked and requires explicit user approval

#### Scenario: Default is no auto-approval

- GIVEN the client is running with `secureMode: true`
- AND `autoApproveReviewChanges` is not set
- WHEN any card change is processed
- THEN NO change is auto-approved — the default SHALL be equivalent to `autoApproveReviewChanges: false`
