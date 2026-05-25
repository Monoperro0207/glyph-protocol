# Server-Generated CallId Specification

## Purpose

Prevent client-controlled call identifiers from being signed into receipts. The server MUST always generate its own callId, preserving any client-supplied identifier as a separate optional field.

## Requirements

### Requirement: Server-Generated Call Identifier

The server MUST generate callId using a cryptographically random UUID v4 on every call. The client-supplied callId, if present, MUST be stored as a separate `clientCallId` field and MUST NOT influence the server-generated callId.

#### Scenario: Server generates UUID regardless of client input

- GIVEN a call request body contains callId: "attacker-chosen-value"
- WHEN the server processes the request
- THEN callId is a server-generated UUID v4
- AND it is NOT the client-supplied value

#### Scenario: Client callId preserved separately

- GIVEN a call request body contains callId: "client-tracker-123"
- WHEN the server processes the request
- THEN the receipt includes clientCallId: "client-tracker-123"
- AND callId is server-generated, independent of the client value

#### Scenario: No client callId supplied

- GIVEN a call request body does NOT contain callId
- WHEN the server processes the request
- THEN the receipt has no clientCallId field (or it is undefined)

### Requirement: Receipt Version Bump

The RECEIPT_VERSION constant MUST be bumped from `"0.2"` to `"0.3"` to reflect the changed callId semantics.

#### Scenario: Receipt version reflects new semantics

- GIVEN a receipt is generated under the new server
- WHEN serialized
- THEN RECEIPT_VERSION is "0.3"
