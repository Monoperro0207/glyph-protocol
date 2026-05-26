# Threat Model: OpenAPI Adapter

> The OpenAPI adapter (`@glyphp/adapter-openapi`) converts OpenAPI 3.x
> documents into Glyph glyphs. The OpenAPI document is a **trust boundary** —
> it may come from an untrusted source and declare server URLs, schemas, and
> security requirements that the adapter must validate before any consumer
> trusts them.

## Scope

- **Package**: `packages/adapters/openapi` (`@glyphp/adapter-openapi`)
- **Entry point**: `glyphsFromOpenApi()`
- **Trust boundary**: OpenAPI document author ↔ glyph consumer. The adapter
  validates and constrains the document's declarations at adapt-time.
- **Key helper**: `redactUrl()` — prevents secret leakage in error messages.
- **Source**: `packages/adapters/openapi/src/index.ts`

## Threats

### Spoofing

| Threat | Description | Control | Test |
|--------|-------------|---------|------|
| Malicious server URLs | OpenAPI document declares `servers[0].url` pointing to an internal network address (`http://localhost:3000`, `http://169.254.0.1`) → SSRF vector. | `allowDocumentServerUrl: false` (default) refuses implicit document URLs. Explicit `baseUrl` always wins. `allowedHosts` filter provides an allowlist when `allowDocumentServerUrl` is opted in. | [Refuse implicit document URL by default](`../packages/adapters/openapi/test/baseurl.test.ts#L19`) — [Use explicit baseUrl regardless of spec content](`../packages/adapters/openapi/test/baseurl.test.ts#L30`) — [Opt-in to document URL with allowDocumentServerUrl](`../packages/adapters/openapi/test/baseurl.test.ts#L39`) — [AllowedHosts filter rejects unknown hosts from document URL](`../packages/adapters/openapi/test/baseurl.test.ts#L54`) — [AllowedHosts filter accepts known host from document URL](`../packages/adapters/openapi/test/baseurl.test.ts#L69`) — [BaseUrl from doc.servers[0].url requires explicit opt-in](`../packages/adapters/openapi/test/openapi.test.ts#L405`) |
| Missing base URL → silent default | Document has no `servers[]` and no explicit `baseUrl` → adapter silently uses an empty or wrong URL. | `glyphsFromOpenApi()` throws at adapt-time when neither `baseUrl` nor `servers[]` is available. Fail-fast, no silent default. | [Missing baseUrl and missing servers[] throws at adapt time](`../packages/adapters/openapi/test/openapi.test.ts#L423`) — [Explicit baseUrl still works without allowDocumentServerUrl](`../packages/adapters/openapi/test/baseurl.test.ts#L48`) |

### Tampering

| Threat | Description | Control | Test |
|--------|-------------|---------|------|
| Schema poisoning | OpenAPI document contains deliberately invalid or contradictory JSON Schema in response/request schemas → input validation bypass or output contract violation. | `$ref` resolution at adapt-time via `resolveRefs()` with cycle detection. Schema compilation via `compileJsonSchema()` from `@glyphp/core` (fail-fast). `outputValidation: 'schema'` (default) enforces response schema at runtime. | [Resolves local $ref in the generated card schemas](`../packages/adapters/openapi/test/openapi.test.ts#L99`) — [Output matching the declared response schema passes](`../packages/adapters/openapi/test/openapi.test.ts#L253`) — [Output violating the declared response schema is rejected](`../packages/adapters/openapi/test/openapi.test.ts#L259`) |
| Malicious parameter injection | OpenAPI document declares a path/header parameter that overwrites security headers (e.g., `Authorization` as a path param). | Parameters are applied in order: path → query → header → cookie. Explicit `Authorization` and security headers are set **after** document parameters via `applySecurity()`, so security headers win. | [Security: bearer scheme adds Authorization header](`../packages/adapters/openapi/test/openapi.test.ts#L334`) — [Security: apiKey-in-header scheme adds custom header](`../packages/adapters/openapi/test/openapi.test.ts#L371`) |
| $ref cycle bombs | OpenAPI document contains circular `$ref` references → infinite recursion at adapt-time. | `resolveRefs()` uses a `seen` Set to detect cycles; cycles resolve to `{}`. | [Resolves local $ref in the generated card schemas](`../packages/adapters/openapi/test/openapi.test.ts#L99`) covers resolution; no explicit cycle test — gap. |

### Repudiation

| Threat | Description | Control | Test |
|--------|-------------|---------|------|
| Unverifiable document origin | No way to trace which OpenAPI document produced a glyph or verify it hasn't been modified since adapt-time. | Glyph card `provider` field records the document title (or `"openapi"` default). Cards are content-addressed — the `id` is a SHA-256 hash of canonical card content. | [Every generated card is content-addressed](`../packages/adapters/openapi/test/openapi.test.ts#L107`) |

### Information Disclosure

| Threat | Description | Control | Test |
|--------|-------------|---------|------|
| Secret leakage in HTTP error messages | API keys, tokens, or passwords passed via query string are exposed in error messages (`HTTP 500 from GET /endpoint?api_key=sk-abc123`). | `redactUrl()` masks values for 16 built-in sensitive parameter names (case-insensitive: `api_key`, `token`, `password`, `secret`, `authorization`, etc.) plus any caller-supplied OpenAPI security scheme names in query position. Used in handler error path before throwing. | [API key in query string is redacted from HTTP error messages](`../packages/adapters/openapi/test/redact.test.ts#L8`) — [Multiple secrets in one URL are all redacted](`../packages/adapters/openapi/test/redact.test.ts#L70`) — [Single secret is redacted while preserving other params](`../packages/adapters/openapi/test/redact.test.ts#L82`) — [OpenAPI security scheme parameter name in query position is redacted](`../packages/adapters/openapi/test/redact.test.ts#L91`) — [Case-insensitive matching of built-in sensitive params](`../packages/adapters/openapi/test/redact.test.ts#L102`) |
| Bearer tokens in OpenAPI spec | Security scheme definitions in the document may describe token formats or include example tokens in descriptions. | Bearer tokens are supplied via `options.security.schemes` at adapt-time, not embedded in the document. The adapter reads the scheme type from the document but the **value** from the operator. | [Security: bearer scheme adds Authorization header](`../packages/adapters/openapi/test/openapi.test.ts#L334`) — token value comes from `options.security.schemes.bearerAuth.token`, not the spec |
| API key in cookie or header leaked via error | `apiKey` security scheme in `cookie` or `header` position — values travel in headers/cookies, not query strings, so they do not appear in `redactUrl()`. | Header and cookie values are not included in error messages (only the URL is reported). This is safe by design — headers are not reflected. | Control documented; no explicit header-value leak test — verified by design. |

### Denial of Service

| Threat | Description | Control | Test |
|--------|-------------|---------|------|
| Operation explosion | OpenAPI document with 1000+ operations → adapter generates 1000+ glyphs, exhausting consumer lexicon storage. | No explicit per-document operation limit in the adapter. Consumers control their lexicon size independently. Document-level validation (schema complexity guard at 1000 nodes / 32 depth in `@glyphp/core`) provides indirect protection against large documents. | No automated test for operation count limits. Control documented; tracked as future enhancement. |
| Slow handler execution | Upstream API hangs → handler blocks indefinitely, holding consumer resources. | No built-in timeout in the adapter. Consumers pass an `AbortSignal` via `GlyphContext` to cancel handler execution. | No explicit timeout test in adapter tests. Control documented; timeout is a consumer-level concern. |

### Elevation of Privilege

| Threat | Description | Control | Test |
|--------|-------------|---------|------|
| SSRF via implicit base URL | Adapter calls an attacker-controlled server because the OpenAPI document's `servers[0].url` was trusted implicitly → consumer executes operations against an internal service. | `allowDocumentServerUrl: false` (default) prevents implicit URL usage. Explicit `baseUrl` is the only trusted path by default. `allowedHosts` provides defense-in-depth when document URLs are opted in. | See Spoofing > Malicious server URLs for test links. Additionally: [BaseUrl from doc.servers[0].url requires explicit opt-in](`../packages/adapters/openapi/test/openapi.test.ts#L405`) |
| Cost misclassification | POST operation marked as idempotent at the HTTP level but actually performs non-idempotent mutations → wrong cost tier applied. | Cost is derived from the HTTP method: `GET` → safe, `POST`/`PUT`/`PATCH` → caution, `DELETE` → danger. `requiresConfirmation` is set for `DELETE`. Idempotency follows HTTP semantics: `GET`, `PUT`, `DELETE` are idempotent. | [Derives cost and risk from the HTTP method](`../packages/adapters/openapi/test/openapi.test.ts#L86`) — [Derives idempotency from the HTTP method](`../packages/adapters/openapi/test/openapi.test.ts#L93`) |
| Output validation bypass | Consumer sets `outputValidation: 'none'` → any upstream response passes, including malicious structured content or prompt injection payloads. | Opt-in escape hatch. Default is `'schema'`. Documented as unsafe — only use with fully trusted APIs. | [outputValidation: 'none' is opt-out](`../packages/adapters/openapi/test/openapi.test.ts#L265`) |
| Malicious security scheme override | OpenAPI document declares an `http`/`bearer` scheme but the operator supplies no credential → operation runs without auth, silently degrading to unauthenticated. | No enforcement that every declared security scheme must have a credential. The adapter skips schemes without credentials (see `applySecurity()` line `if (!scheme || !credential) continue`). This is a soft-fail design choice. | No test for missing credential enforcement. Control documented; gap. |

## Coverage Summary

| STRIDE category | Threats | Tested | Documented-only |
|-----------------|---------|--------|-----------------|
| Spoofing | 2 | 2 | 0 |
| Tampering | 3 | 2 | 1 ($ref cycle) |
| Repudiation | 1 | 1 | 0 |
| Information Disclosure | 3 | 2 | 1 (header leak) |
| Denial of Service | 2 | 0 | 2 (operation count, timeout) |
| Elevation of Privilege | 4 | 3 | 1 (missing credential) |
| **Total** | **15** | **10** | **5** |

## Related Documents

- [Glyph Protocol Threat Model](../spec/threat-model.md) — protocol-level STRIDE
- [Threat-to-Tests Mapping](./threat-to-tests.md) — traceability matrix
- [MCP Adapter Threat Model](./threat-model-mcp.md) — sister adapter document
- [ARCHITECTURE.md](../ARCHITECTURE.md) — trust boundary diagram
- [PR #40](https://github.com/Monoperro0207/glyph-protocol/pull/40) — schema compilation at adapt-time (fail-fast)
- [PR #41](https://github.com/Monoperro0207/glyph-protocol/pull/41) — `redactUrl()` secret masking
