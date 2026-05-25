# OpenAPI Trusted Base URL Specification

## Purpose

Prevent SSRF attacks by requiring explicit opt-in before the OpenAPI adapter uses server URLs declared in a potentially untrusted specification document.

## Requirements

### Requirement: Explicit Base URL Trust Model

The OpenAPI adapter MUST NOT implicitly trust `doc.servers[0].url`. Consumers MUST either provide an explicit `options.baseUrl` or opt in via `allowDocumentServerUrl: true`. An optional `allowedHosts` list MUST restrict the resolved host when provided.

#### Scenario: Refuse implicit document URL by default

- GIVEN an OpenAPI spec with servers: [{url: "http://attacker.example.com"}]
- WHEN creating an adapter WITHOUT allowDocumentServerUrl or baseUrl
- THEN the adapter throws with a clear error message mentioning SSRF risk

#### Scenario: Use explicit baseUrl

- GIVEN an OpenAPI spec with any servers declaration
- WHEN creating an adapter with options.baseUrl = "http://trusted.local"
- THEN the adapter uses the explicit baseUrl regardless of spec content

#### Scenario: Opt-in to document URL

- GIVEN an OpenAPI spec with servers: [{url: "http://safe.local"}]
- WHEN creating an adapter with allowDocumentServerUrl: true
- THEN the adapter uses the document-declared URL

#### Scenario: Allowed hosts filter rejects unknown hosts

- GIVEN an OpenAPI spec with servers: [{url: "http://attacker.example.com"}]
- WHEN creating an adapter with allowedHosts: ["safe.local"]
- THEN the adapter throws because the resolved host is not in the allowed list
