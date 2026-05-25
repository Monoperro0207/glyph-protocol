# RFC-0005 Receipt CallId Specification

## Purpose

Document the receipt callId security change as a formal RFC, providing motivation, specification, migration guidance, and version history for future auditors and contributors.

## Requirements

### Requirement: RFC Documents the Change

The receipt callId change MUST be documented in `spec/rfcs/RFC-0005-receipt-callid.md`. The document MUST cover the motivation (prevent client-controlled callId from being signed), the specification change (always server-generated UUID v4, optional clientCallId), a migration guide for clients that previously relied on matching callId, and the receipt version bump to 0.3.

#### Scenario: Reader understands the change

- GIVEN a reader opens spec/rfcs/RFC-0005-receipt-callid.md
- WHEN they read through the document
- THEN they understand motivation, spec change, migration steps, and version history

### Requirement: RFC Follows Existing Format

The new RFC MUST follow the same structure, naming conventions, and metadata format as existing RFCs in the repository.

#### Scenario: Consistent with prior RFCs

- GIVEN spec/rfcs/RFC-0004-import-clients.md exists as a precedent
- WHEN RFC-0005 is compared against RFC-0004
- THEN it follows the same structure (Status, Author, Date, Summary, Motivation, Specification, Migration, References)
- AND uses the same naming convention (RFC-NNNN-slug.md)
