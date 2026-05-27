# Adapter Threat Models Specification

## Purpose

Dedicated STRIDE threat model documentation for MCP and OpenAPI adapters, each with threat-to-test mapping so every threat has a documented control or test.

## Requirements

### Requirement: THREAT-001 — MCP Adapter Threat Model

A threat model document MUST exist at `docs/threat-model-mcp.md` covering: tool-name collisions, malicious annotations, schema poisoning, and passthrough risks. Each threat SHALL be classified by STRIDE category and mapped to a control or test.

#### Scenario: Tool-name collision is documented

- GIVEN the MCP threat model document
- WHEN a reviewer reads the "Tool-name collisions" section
- THEN the threat is classified under STRIDE (Spoofing)
- AND a control or test reference is listed alongside it

#### Scenario: Malicious annotations are documented

- GIVEN the MCP threat model document
- WHEN a reviewer reads the "Malicious annotations" section
- THEN the threat is classified under STRIDE (Tampering)
- AND a control or test reference is listed alongside it

### Requirement: THREAT-002 — OpenAPI Adapter Threat Model

A threat model document MUST exist at `docs/threat-model-openapi.md` covering: SSRF, schema poisoning, malicious server URLs, and already-fixed secret leakage. Each threat SHALL be classified by STRIDE category and mapped to a control or test.

#### Scenario: SSRF threat is documented

- GIVEN the OpenAPI threat model document
- WHEN a reviewer reads the "SSRF" section
- THEN the threat is classified under STRIDE (Information Disclosure / Tampering)
- AND references the baseUrl trust model control

#### Scenario: Malicious server URL is documented

- GIVEN the OpenAPI threat model document
- WHEN a reviewer reads the "Malicious server URLs" section
- THEN the threat is classified under STRIDE (Spoofing)
- AND references the URL validation control

### Requirement: THREAT-003 — Threat-to-Test Mapping

Each threat in both models MUST map to an existing test or a documented control. Any threat without a current test SHALL be flagged with a tracking issue reference.

#### Scenario: Every threat has a test or control

- GIVEN the threat model documents for both adapters
- WHEN each threat row is inspected
- THEN every threat has a non-empty "Test / Control" column
- OR a GitHub issue reference if the test is not yet implemented

#### Scenario: Extends existing STRIDE mapping

- GIVEN the existing `docs/threat-to-tests.md` document
- WHEN the adapter threat models are created
- THEN they cross-reference the existing STRIDE mapping
- AND do not duplicate threats already covered at the protocol level
