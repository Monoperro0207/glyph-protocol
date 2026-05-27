# Delta for OpenAPI Trusted Base URL

## ADDED Requirements

### Requirement: URL Redaction in Error Messages (OPENAPI-URLREDACT-001)

When the OpenAPI adapter throws errors from upstream HTTP responses, it MUST redact sensitive query parameters before including the URL in error messages, logs, or traces. The parameters to redact SHALL include: `api_key`, `apikey`, `key`, `token`, `access_token`, `secret`, `password`, `authorization`, plus any parameter name defined by an OpenAPI security scheme with `in: query`. Redacted values MUST be replaced with a fixed placeholder string (e.g., `[REDACTED]`). No secret value MUST ever appear in error output.

#### Scenario: API key in query string is redacted

- GIVEN an upstream HTTP response with status 500
- AND the request URL is `https://api.example.com/users?api_key=sk-secret123&page=1`
- WHEN the adapter constructs the error message
- THEN the URL in the error reads `https://api.example.com/users?api_key=[REDACTED]&page=1`

#### Scenario: Token parameter is redacted

- GIVEN an upstream HTTP response with status 403
- AND the request URL is `https://api.example.com/data?token=ghp_abc123&limit=10`
- WHEN the adapter constructs the error message
- THEN the URL in the error reads `https://api.example.com/data?token=[REDACTED]&limit=10`

#### Scenario: OpenAPI security scheme query param is redacted

- GIVEN an OpenAPI spec with security scheme `ApiKeyAuth` of type `apiKey` with `in: query` and `name: x-api-key`
- AND the request URL is `https://api.example.com/secure?x-api-key=prod-key-456&resource=widgets`
- AND the upstream responds with 500
- WHEN the adapter constructs the error message
- THEN `x-api-key` is redacted because it matches a security scheme query parameter

#### Scenario: No secrets in URL — no redaction

- GIVEN an upstream HTTP response with status 500
- AND the request URL is `https://api.example.com/users?page=2&limit=50`
- WHEN the adapter constructs the error message
- THEN the URL appears unchanged since no sensitive parameters are present

#### Scenario: Secrets in logs and traces are also redacted

- GIVEN an error with a URL containing `secret=mysecret`
- WHEN the error is logged or traced
- THEN the logged/traced URL MUST also have `secret=[REDACTED]` — redaction applies to error messages, logs, AND traces
