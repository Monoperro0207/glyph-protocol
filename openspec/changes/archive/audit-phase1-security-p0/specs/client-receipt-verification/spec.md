# Client Receipt Verification Specification

## Purpose

Prevent receipt forgery and tampering attacks by requiring the strict client to automatically verify receipt integrity before delivering tool output to the consumer. All four verification checks MUST pass; any mismatch MUST reject the receipt.

## Requirements

### Requirement: Automatic Receipt Verification in Secure Mode (RECEIPTVERIFY-001)

In `secureMode`, the client MUST automatically verify receipts before delivering the payload to the consumer. Verification SHALL be enabled by default (`verifyReceipts: true`). The client MUST verify: (a) receipt Ed25519 signature is valid for the pinned public key, (b) `outputHash` matches the SHA-256 hash of the actual payload body, (c) `inspectionHash` matches the hash of the inspection report, and (d) `glyphId` matches the ID of the approved card.

#### Scenario: Valid receipt passes verification

- GIVEN a receipt with valid Ed25519 signature for the pinned key
- AND `outputHash` matches the payload body
- AND `inspectionHash` matches the inspection report
- AND `glyphId` matches the approved card ID
- WHEN the client verifies the receipt
- THEN verification passes and the payload is delivered to the consumer

#### Scenario: Invalid signature rejects receipt

- GIVEN a receipt signed with a key that does not match the pinned public key
- WHEN the client verifies the receipt
- THEN the client MUST throw an error and MUST NOT deliver the payload

#### Scenario: Mismatched outputHash rejects receipt

- GIVEN a receipt where `outputHash` does not match the SHA-256 of the actual payload
- WHEN the client verifies the receipt
- THEN the client MUST throw an error and MUST NOT deliver the payload

#### Scenario: Mismatched inspectionHash rejects receipt

- GIVEN a receipt where `inspectionHash` does not match the inspection report hash
- WHEN the client verifies the receipt
- THEN the client MUST throw an error and MUST NOT deliver the payload

#### Scenario: Mismatched glyphId rejects receipt

- GIVEN a receipt where `glyphId` does not match the approved card ID
- WHEN the client verifies the receipt
- THEN the client MUST throw an error and MUST NOT deliver the payload

### Requirement: Verification Disable Escape Hatch (RECEIPTVERIFY-002)

The client MAY support `verifyReceipts: false` to disable automatic verification. This option SHALL only take effect when explicitly set and SHALL be documented as a security risk. The default in `secureMode` MUST be `true`.

#### Scenario: Explicit disable skips verification

- GIVEN the client is running with `secureMode: true` and `verifyReceipts: false`
- AND a receipt with an invalid signature
- WHEN the client processes the receipt
- THEN verification is skipped and the payload is delivered

#### Scenario: Default is verification enabled

- GIVEN the client is running with `secureMode: true`
- AND `verifyReceipts` is not explicitly set
- WHEN a receipt is processed
- THEN the default behavior SHALL be `verifyReceipts: true` and verification MUST run
