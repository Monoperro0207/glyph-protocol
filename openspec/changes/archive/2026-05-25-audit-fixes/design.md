# Design: Audit Fixes — Hardening Glyph Protocol

## Technical Approach

Defensive hardening across 5 security findings plus repo hygiene. Each fix independently testable and revertible. Implementation order follows dependency graph: `errors.ts` first (shared by Fix 1 and Fix 5A), then all other fixes in parallel. Test-first for every P0/P1 fix. All fixes reuse existing codebase patterns: sweep+reject from `rateLimitMiddleware` (middleware.ts:51-77), constructor options from `GlyphServer` (server.ts:86-125).

## Architecture Decisions

| Decision | Options | Tradeoffs | Choice |
|----------|---------|-----------|--------|
| Sweep strategy for confirmation backlog | Always sweep vs conditional (>1000) | Unconditional costs ~O(n) per prepare but prevents unbounded growth; conditional leaks under threshold | **Unconditional sweep** — safety over micro-optimization |
| Token comparison method | SHA-256+timingSafeEqual vs HMAC vs argon2 | SHA-256: fast, fixed-length output, built-in; HMAC needs shared secret; argon2 slows request path | **SHA-256 + timingSafeEqual** — eliminates length leak, negligible overhead for N<50 |
| OpenAPI baseUrl default | Explicit opt-in vs implicit trust | Opt-in breaks existing callers (MAJOR bump); implicit trust is SSRF vector | **Explicit opt-in, default false** — security > backwards compatibility |
| Schema complexity guard placement | Pre-compile recursive walk vs post-compile analysis | Pre-compile catches both DoS and stack overflow; AJV doesn't expose internal node count | **Pre-compile walk** — reject bad schemas before they reach AJV |
| Receipt version strategy | Bump to 0.3 vs keep 0.2 | 0.3 signals semantic change (server-owned callId); 0.2 hides protocol shift | **Bump to 0.3** — callId ownership is a meaningful contract change |

## Data Flow

```
POST /prepare ──→ [unconditional sweep expired] ──→ [size >= MAX?] ──→ 503 | ticket
POST /call    ──→ [readJson body limit 1 MiB] ──→ [server generate callId] ──→ [receipt 0.3]
auth Bearer   ──→ [SHA-256(token)] ──→ [timingSafeEqual vs each stored hash] ──→ pass/401
OpenAPI spec  ──→ [baseUrl: explicit? opt-in?] ──→ [allowedHosts filter] ──→ fetch | throw
AJV compile   ──→ [validateSchemaComplexity walk] ──→ pass: compile | fail: SCHEMA_TOO_COMPLEX
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/server/src/errors.ts` | Modify | Add `CONFIRMATION_BACKLOG_FULL`, `PAYLOAD_TOO_LARGE` to union; add `503` to `ErrorStatus` |
| `packages/server/src/server.ts` | Modify | MAX_PENDING_CONF (10K), unconditional sweep at ~362, reject+503 at limit, always `randomUUID()` at ~398, `clientCallId` in receipt at ~519, Content-Length check in `readJson` at ~46, bump `RECEIPT_VERSION` to `'0.3'` |
| `packages/server/src/middleware.ts` | Modify | Replace `.includes()` with SHA-256 + `timingSafeEqual` at ~20-24; import `createHash, timingSafeEqual` |
| `packages/types/src/types.ts` | Modify | Add optional `clientCallId?: string` to `CallReceipt` |
| `packages/adapters/openapi/src/index.ts` | Modify | Add `allowDocumentServerUrl`, `allowedHosts` to options; throw on implicit server URL at ~51-57 |
| `packages/core/src/json-schema-validator.ts` | Modify | Add `SchemaComplexityError` class, `validateSchemaComplexity()` recursive walk, call before AJV compile |
| `spec/rfcs/RFC-0005-receipt-callid.md` | Create | Motivation, spec change, migration guide, receipt 0.3 |
| `CODEOWNERS` | Create | `* @Monoperro0207` |
| `.github/dependabot.yml` | Create | npm, weekly, grouped |
| `.github/PULL_REQUEST_TEMPLATE.md` | Create | Checklist: verify, RFC, schema vector |

## Interfaces / Contracts

New constructor options on `GlyphServer`:
```typescript
maxPendingConfirmations?: number  // default 10_000
maxBodyBytes?: number              // default 1_048_576
```

New options on `OpenApiAdapterOptions`:
```typescript
allowDocumentServerUrl?: boolean   // default false
allowedHosts?: string[]            // optional host allowlist
```

New field on `CallReceipt`:
```typescript
clientCallId?: string  // optional, preserved client-supplied value
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Confirmation | 10_001 tickets → 503 | `server.fetch()` loop, assert status 503 + Retry-After |
| Receipt | Server generates UUID always | `server.fetch()` with/without body.callId, assert UUID shape |
| Middleware | SHA-256 CT comparison | Functional smoke: valid passes, invalid 401, varied lengths ok |
| OpenAPI | SSRF rejection by default, opt-in | 4 scenarios from spec (no opt-in throws, explicit baseUrl works, opt-in works, allowedHosts mismatch throws) |
| Body limit | 2 MiB → 413 | POST with oversized Content-Length |
| Schema complexity | 2000 nodes → throw, 50 depth → throw | Recursive schema builder in test |
| Core fixture | receiptVersion bump | Update `buildReceipt()` at core.test.ts:177 |

## Migration / Rollout

- **Receipt 0.3**: Clients comparing `callId` to sent value will no longer match. Migration: use `clientCallId` for correlation, `callId` for audit identity.
- **OpenAPI MAJOR**: Callers without `baseUrl` MUST set `allowDocumentServerUrl: true` or provide explicit `baseUrl`. Documented in changeset.
- **Schema complexity**: Legitimate complex schemas exceeding thresholds get error message with actual vs limit counts; future config overrides possible.
- All other fixes transparent — no client-side changes required.

## Open Questions

None — all five findings verified against real code. No blocking unknowns.
