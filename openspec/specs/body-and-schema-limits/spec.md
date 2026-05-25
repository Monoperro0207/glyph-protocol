# Body and Schema Limits Specification

## Purpose

Prevent resource exhaustion via oversized HTTP request bodies and adversarial JSON Schemas. The server MUST enforce body size limits, and the schema validator MUST reject overly complex schemas before compilation.

## Requirements

### Requirement: Body Size Limit

The server MUST reject request bodies larger than a configurable maximum. The default limit is 1 MiB (MAX_BODY_BYTES). Exceeding this limit MUST result in a 413 PAYLOAD_TOO_LARGE response.

#### Scenario: Body too large

- GIVEN Content-Length exceeds 1 MiB (MAX_BODY_BYTES)
- WHEN the request is processed
- THEN the server responds with 413 PAYLOAD_TOO_LARGE

#### Scenario: Body within limit

- GIVEN Content-Length is <= 1 MiB
- WHEN the request is processed
- THEN the body is parsed normally

### Requirement: Schema Complexity Guard

The JSON Schema validator MUST reject schemas exceeding configurable complexity thresholds before passing them to AJV. The default limits are 1000 total nodes and 32 levels of nesting depth.

#### Scenario: Too many nodes

- GIVEN a JSON Schema with > 1000 total nodes
- WHEN the schema is validated
- THEN the validator throws SCHEMA_TOO_COMPLEX

#### Scenario: Too deep nesting

- GIVEN a JSON Schema with > 32 levels of nesting
- WHEN the schema is validated
- THEN the validator throws SCHEMA_TOO_COMPLEX

#### Scenario: Valid schema accepted

- GIVEN a JSON Schema with <= 1000 nodes and <= 32 depth
- WHEN the schema is validated
- THEN it compiles normally via AJV
