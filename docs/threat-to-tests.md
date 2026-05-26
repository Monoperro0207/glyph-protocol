# Threat-to-Tests Mapping

> Every row of the [STRIDE threat model](../spec/threat-model.md) maps to at
> least one automated test or conformance check. This document is the
> traceability matrix — open it alongside `spec/threat-model.md §4` when
> verifying the security posture.

## Spoofing

| Threat | Test / Conformance | File |
|---|---|---|
| Attacker claims to be the server | `discovery.card.signature` — verifies card signature against server key. `execution.call.receipt` — verifies receipt signature. | `packages/conformance/src/levels/discovery.ts`, `packages/conformance/src/levels/execution.ts` |
| Attacker swaps a rotated key for one they control | `governance.keyRegistry` — checks key chain integrity. `packages/core/test/key-registry.test.ts` — verifies chain validation logic. | `packages/conformance/src/levels/governance.ts`, `packages/core/test/key-registry.test.ts` |
| Attacker forges a confirmation token | `security.confirmation.invalid` — bogus token → 403 INVALID_CONFIRMATION. `packages/server/test/confirmation.test.ts` — token life cycle (prepare, use, expiry, single-use). | `packages/conformance/src/levels/security.ts`, `packages/server/test/confirmation.test.ts` |
| Attacker claims a glyph card they did not provide | `discovery.card.signature` — content hash + signature check. `packages/core/test/core.test.ts` — `verifyGlyph`, `buildReceipt`. | `packages/conformance/src/levels/discovery.ts`, `packages/core/test/core.test.ts` |
| **MCP**: Tool-name collision — two servers export tools with the same name | Glyph names are kebab-cased; `provider` field disambiguates origin. See [threat-model-mcp.md](./threat-model-mcp.md#spoofing). | `packages/adapters/mcp/test/mcp.test.ts` |
| **OpenAPI**: Malicious server URL in `servers[0].url` points to internal network | `allowDocumentServerUrl: false` (default), `allowedHosts` filter, explicit `baseUrl`. See [threat-model-openapi.md](./threat-model-openapi.md#spoofing). | `packages/adapters/openapi/test/baseurl.test.ts`, `packages/adapters/openapi/test/openapi.test.ts` |

## Tampering

| Threat | Test / Conformance | File |
|---|---|---|
| In-flight card modification | `discovery.card.signature` — re-computes id from canonical content, verifies signature. `packages/core/test/core.test.ts` — `canonicalize` + `hashGlyph`. | `packages/conformance/src/levels/discovery.ts`, `packages/core/test/core.test.ts` |
| In-flight receipt modification | `execution.call.receipt` — verifies ed25519 signature over canonical receipt. `packages/server/test/receipt.test.ts` — receipt content shape, server-generated callId, clientCallId. | `packages/conformance/src/levels/execution.ts`, `packages/server/test/receipt.test.ts` |
| Server lies about sanitization | `execution.call.sanitization` — checks inspection report shape. `packages/server/test/inspection.test.ts` — inspection report matches actual sanitization. | `packages/conformance/src/levels/execution.ts`, `packages/server/test/inspection.test.ts` |
| Handler returns out-of-schema output | `execution.call.outputValidation` — 502 OUTPUT_VALIDATION_FAILED. `packages/adapters/openapi/test/openapi.test.ts` — adapter output validation. | `packages/conformance/src/levels/execution.ts`, `packages/adapters/openapi/test/openapi.test.ts` |
| Symlink confused deputy | `packages/server/test/hardening.test.ts` — jail path resolution checks. | `packages/server/test/hardening.test.ts` |
| **MCP**: Malicious annotations — `readOnlyHint` on destructive tool to bypass confirmation | Dangerous tool name regex overrides annotations. See [threat-model-mcp.md](./threat-model-mcp.md#tampering). | `packages/adapters/mcp/test/mcp.test.ts` |
| **MCP**: Schema poisoning — invalid JSON Schema in `inputSchema`/`outputSchema` | Zod compilation at adapt-time; `outputValidation: 'schema'` (default). See [threat-model-mcp.md](./threat-model-mcp.md#tampering). | `packages/adapters/mcp/test/mcp.test.ts` |
| **OpenAPI**: Schema poisoning — invalid or contradictory schemas in request/response | `$ref` resolution with cycle detection; `compileJsonSchema()` fail-fast. See [threat-model-openapi.md](./threat-model-openapi.md#tampering). | `packages/adapters/openapi/test/openapi.test.ts` |

## Repudiation

| Threat | Test / Conformance | File |
|---|---|---|
| Provider denies a call happened | `execution.call.receipt` — receipt signature verifies end-to-end. `packages/core/test/core.test.ts` — `verifyReceipt`. | `packages/conformance/src/levels/execution.ts`, `packages/core/test/core.test.ts` |
| Consumer denies invoking a high-risk glyph | `security.confirmation.unlocks` — valid token unlocks. `packages/server/test/receipt.test.ts` — receipt commits to inputHash. | `packages/conformance/src/levels/security.ts`, `packages/server/test/receipt.test.ts` |
| Provider repudiates published card | `governance.card.depthIdentity` — card id stable across depth. `packages/core/test/diff.test.ts` — card diff detection. `packages/client/test/pinning.test.ts` — pin/approve/review lifecycle. | `packages/conformance/src/levels/governance.ts`, `packages/core/test/diff.test.ts`, `packages/client/test/pinning.test.ts` |
| **MCP**: Unverifiable tool origin — can't trace which MCP server produced a tool | Card `provider` field records server name; content-addressed card ID. See [threat-model-mcp.md](./threat-model-mcp.md#repudiation). | `packages/adapters/mcp/test/mcp.test.ts` |
| **OpenAPI**: Unverifiable document origin — can't trace which spec produced a glyph | Card `provider` field records document title; content-addressed card ID. See [threat-model-openapi.md](./threat-model-openapi.md#repudiation). | `packages/adapters/openapi/test/openapi.test.ts` |

## Information Disclosure

| Threat | Test / Conformance | File |
|---|---|---|
| Hostile output smuggles prompt injection | `execution.call.sanitization` — inspection report present. `packages/server/test/inspection.test.ts` — Unicode tag block, zero-width, bidi-override removal. `packages/client/test/render.test.ts` — inert-data preamble rendering. | `packages/conformance/src/levels/execution.ts`, `packages/server/test/inspection.test.ts`, `packages/client/test/render.test.ts` |
| Handler leaks data (incorrect implementation) | `execution.call.outputValidation` — 502 on schema mismatch. `packages/core/test/json-schema-validator.test.ts` — schema validation + complexity guard. | `packages/conformance/src/levels/execution.ts`, `packages/core/test/json-schema-validator.test.ts` |
| Token discloses prepared input | `security.confirmation.invalid` — bogus token rejected without input leak. `packages/server/test/confirmation.test.ts` — token bound to canonical input hash. | `packages/conformance/src/levels/security.ts`, `packages/server/test/confirmation.test.ts` |
| Revoked key continues to authenticate | `governance.keyRegistry` — key registry check. `packages/core/test/key-registry.test.ts` — revokedAt enforcement. | `packages/conformance/src/levels/governance.ts`, `packages/core/test/key-registry.test.ts` |
| **MCP**: Sensitive annotations — tool descriptions may contain secrets published on public card | Card `intent` inherits MCP description verbatim; documented risk, no automated sanitization. See [threat-model-mcp.md](./threat-model-mcp.md#information-disclosure). | `packages/adapters/mcp/test/mcp.test.ts` |
| **OpenAPI**: Secret leakage — API keys/tokens in query strings exposed in HTTP error messages | `redactUrl()` masks 16 built-in sensitive param names plus security scheme query params. See [threat-model-openapi.md](./threat-model-openapi.md#information-disclosure). | `packages/adapters/openapi/test/redact.test.ts` |
| **OpenAPI**: Bearer tokens in spec — security scheme definitions may leak token patterns | Bearer tokens supplied via `options.security.schemes`, not embedded in spec content. See [threat-model-openapi.md](./threat-model-openapi.md#information-disclosure). | `packages/adapters/openapi/test/openapi.test.ts` |

## Denial of Service

| Threat | Test / Conformance | File |
|---|---|---|
| Flood under one bearer token | `security.rateLimit` — burst produces 429. `packages/server/test/middleware.test.ts` — rate limiter bucket exhaustion. | `packages/conformance/src/levels/security.ts`, `packages/server/test/middleware.test.ts` |
| Anonymous flood from many IPs | `security.rateLimit` — rate limiting active. Same tests. | `packages/conformance/src/levels/security.ts` |
| Slow / hanging handler | `security.timeout` — 504 HANDLER_TIMEOUT on slow handler. `packages/server/test/hardening.test.ts` — timeout enforcement. | `packages/conformance/src/levels/security.ts`, `packages/server/test/hardening.test.ts` |
| Confirmation map unbounded growth | `packages/server/test/confirmation.test.ts` — backlog limit + sweep. 10k+1 tickets → 503 CONFIRMATION_BACKLOG_FULL. | `packages/server/test/confirmation.test.ts` |
| Fake tokens escape rate limit | `security.rateLimit` — only verified tokens get per-token bucket. `packages/server/test/middleware.test.ts` — auth + rate limit interaction. | `packages/conformance/src/levels/security.ts`, `packages/server/test/middleware.test.ts` |
| Malicious MCP/OpenAPI upstream | `execution.call.outputValidation` — output re-validation. `packages/adapters/openapi/test/openapi.test.ts` — adapter timeout + validation. | `packages/conformance/src/levels/execution.ts`, `packages/adapters/openapi/test/openapi.test.ts` |
| Oversized body payload | `packages/server/test/runtime.test.ts` — 2 MiB → 413 PAYLOAD_TOO_LARGE. | `packages/server/test/runtime.test.ts` |
| Complex schema bombing | `packages/core/test/json-schema-validator.test.ts` — 2000 nodes / 50 depth → SCHEMA_TOO_COMPLEX. | `packages/core/test/json-schema-validator.test.ts` |
| **MCP**: Massive tool explosion — MCP server exports 1000+ tools → resource exhaustion | No explicit adapter limit; consumer controls lexicon size. See [threat-model-mcp.md](./threat-model-mcp.md#denial-of-service). | Documented control — no automated test |
| **OpenAPI**: Operation explosion — spec with 1000+ operations → resource exhaustion | No explicit adapter limit; consumer controls lexicon size. See [threat-model-openapi.md](./threat-model-openapi.md#denial-of-service). | Documented control — no automated test |

## Elevation of Privilege

| Threat | Test / Conformance | File |
|---|---|---|
| Caller without scopes invokes privileged glyph | `packages/server/test/policy.test.ts` — scope gate. `packages/core/test/core.test.ts` — requiredScopes canonical content. | `packages/server/test/policy.test.ts`, `packages/core/test/core.test.ts` |
| Token grants privileges beyond bound call | `security.confirmation.invalid` — token bound to (glyphName, inputHash, expiresAt). `packages/server/test/confirmation.test.ts` — token mismatch rejection. | `packages/conformance/src/levels/security.ts`, `packages/server/test/confirmation.test.ts` |
| Revoked tool keeps running on consumer | `packages/client/test/pinning.test.ts` — revokedAt blocks execution. `packages/cli/test/pins.test.ts` — revoke command. | `packages/client/test/pinning.test.ts`, `packages/cli/test/pins.test.ts` |
| Attacker confuses consumer into approving unsafe card | `packages/core/test/diff.test.ts` — breaking vs review classification. `packages/client/test/manifest.test.ts` — manifest verification. | `packages/core/test/diff.test.ts`, `packages/client/test/manifest.test.ts` |
| **MCP**: Overbroad passthrough — `readOnlyHint` on a tool that actually writes → wrong risk tier | Dangerous tool name regex overrides annotations; `requiresConfirmation` derived from `destructiveHint OR dangerousName`. See [threat-model-mcp.md](./threat-model-mcp.md#elevation-of-privilege). | `packages/adapters/mcp/test/mcp.test.ts` |
| **OpenAPI**: SSRF via implicit base URL — adapter calls internal services using spec-defined URLs | `allowDocumentServerUrl: false` (default); explicit `baseUrl` required. See [threat-model-openapi.md](./threat-model-openapi.md#elevation-of-privilege). | `packages/adapters/openapi/test/baseurl.test.ts`, `packages/adapters/openapi/test/openapi.test.ts` |
| **OpenAPI**: Cost misclassification — POST marked idempotent but actually mutates → wrong cost tier | Cost derived from HTTP method: GET→safe, POST/PUT/PATCH→caution, DELETE→danger. See [threat-model-openapi.md](./threat-model-openapi.md#elevation-of-privilege). | `packages/adapters/openapi/test/openapi.test.ts` |

## Conformance suite (normative)

Four executable conformance levels independently verify the protocol contract:

| Level | Checks | File |
|---|---|---|
| `discovery` | health, handshake accept/reject, lexicon, card shape + signature, depth enum, error envelope, schema sanity | `packages/conformance/src/levels/discovery.ts` |
| `execution` | call success, envelope shape, receipt signature, sanitization report, input validation, malformed JSON, output validation | `packages/conformance/src/levels/execution.ts` |
| `security` | confirmation required/invalid/unlocks, auth, rate limit, handler timeout | `packages/conformance/src/levels/security.ts` |
| `governance` | card depth identity, update manifest, key registry | `packages/conformance/src/levels/governance.ts` |

Run with: `pnpm conformance:self`

## Coverage summary

| STRIDE category | Test files (unique) | Conformance checks | Adapter threats |
|---|---|---|---|
| Spoofing | 5 | 3 | 2 |
| Tampering | 8 | 4 | 3 |
| Repudiation | 6 | 3 | 2 |
| Information Disclosure | 7 | 3 | 3 |
| Denial of Service | 7 | 2 | 2 |
| Elevation of Privilege | 7 | 1 | 3 |
| **Total** | **20 files** | **20 checks** | **15 threats** |

### Adapter Threat Models

Dedicated STRIDE threat model documents exist for each adapter with full
threat-to-test traceability:

| Adapter | Document | Threats | Tested | Documented-only |
|---------|----------|---------|--------|-----------------|
| MCP | [`docs/threat-model-mcp.md`](./threat-model-mcp.md) | 14 | 8 | 6 |
| OpenAPI | [`docs/threat-model-openapi.md`](./threat-model-openapi.md) | 15 | 10 | 5 |
