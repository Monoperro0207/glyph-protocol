# Exploration: audit-fixes

## Current State

The Glyph Protocol codebase is at wire protocol `1.0` (stable line), with 282 TS tests passing, `pnpm verify` clean, and `pnpm audit --prod` with no CVEs. An external CEO/Producto/Security audit scored it **8.4/10** and identified 5 actionable security/correctness issues that prevent promotion to ≥9.0.

This exploration verifies each finding against the actual code before committing to changes.

## Verified Findings

### Finding 1 — Unbounded `pendingConfirmations` (VERIFIED)

**Plan claim:** Map has conditional sweep only when `> 1000`, no hard ceiling.

**Code:** `packages/server/src/server.ts:362-375`
```typescript
const now = Date.now()
if (this.pendingConfirmations.size > 1000) {        // CONDITIONAL — not always
  for (const [token, pending] of this.pendingConfirmations) {
    if (now >= pending.expiresAt) this.pendingConfirmations.delete(token)
  }
}

const confirmationToken = randomUUID()
const expiresAt = now + CONFIRMATION_TTL_MS
this.pendingConfirmations.set(confirmationToken, {   // UNBOUNDED — no rejection
  glyphName: name,
  inputHash: canonicalHash(parsed.data),
  expiresAt,
})
```

**Verdict:** EXACT MATCH. The sweep only runs when `size > 1000`, and even after sweeping, there's no rejection if the map is still full. A malicious client can fill the map with long-lived tickets and cause OOM.

**What needs to change:**
- Add `MAX_PENDING_CONFIRMATIONS` constant (default `10_000`, overridable via constructor)
- Make sweep **unconditional** (always run before insertion)
- After sweep, if `size >= MAX_PENDING_CONFIRMATIONS`, reject with `503 CONFIRMATION_BACKLOG_FULL` + `Retry-After`
- Add new error code `CONFIRMATION_BACKLOG_FULL` to `errors.ts`
- Test: `packages/server/test/confirmation.test.ts` — new test creating 10_001 tickets → assert 503

**Dependencies:** Constructor option `maxPendingConfirmations` (server.ts:86-100), error code addition (errors.ts:5-18)

---

### Finding 2 — Client-controlled `callId` (VERIFIED, with surprise)

**Plan claim:** `callId` comes from `body.callId ?? randomUUID()`, is signed into receipt.

**Code — resolution:** `packages/server/src/server.ts:393-398`
```typescript
const body = await readJson<{
  input: unknown
  callId?: string
  confirmationToken?: string
}>(c)
const callId = body.callId ?? randomUUID()  // Client can set callId
```

**Code — signing:** `packages/server/src/server.ts:519-523`
```typescript
const receiptBase: Omit<CallReceipt, 'signature'> = {
  receiptVersion: RECEIPT_VERSION,
  callId,                 // <-- used in signature
  glyphId: glyph.card.id,
  ...
```

**Verdict:** EXACT MATCH on the logic. Client-provided `callId` is used as the server's call identifier and signed into the receipt.

**SURPRISE:** The plan references `packages/types/src/receipt.ts` — this file **does not exist**. All types live in:
- `packages/types/src/types.ts` — `CallReceipt` interface (lines 100-115), `SealedEnvelope` (line 88)
- `packages/types/src/protocol.ts` — `PROTOCOL_VERSION` (`'1.0'`), `MANIFEST_VERSION` (`'0.1'`)
- `RECEIPT_VERSION = '0.2'` is defined locally at `packages/server/src/server.ts:36`

The `CallReceipt` interface currently has no `clientCallId` field:
```typescript
export interface CallReceipt {
  receiptVersion: string
  callId: string
  glyphId: string
  glyphName: string
  inputHash: string
  outputHash: string
  inspectionHash: string
  riskTier: 'safe' | 'caution' | 'danger'
  provider: string
  latencyMs: number
  timestamp: string
  serverPublicKey: string
  signature: string
}
```

**What needs to change:**
- `server.ts:393-398`: Replace `body.callId ?? randomUUID()` with `randomUUID()` only; if `body.callId` present, store as `clientCallId`
- `server.ts:519-523`: Add optional `clientCallId` to receipt base
- `packages/types/src/types.ts`: Add optional `clientCallId?: string` to `CallReceipt`
- `server.ts:36`: Bump `RECEIPT_VERSION` from `'0.2'` to `'0.3'`
- New file: `spec/rfcs/RFC-0005-receipt-callid.md`
- Update `spec/protocol.md` — document receipt version 0.3
- Update `CHANGELOG-PROTOCOL.md` — wire-protocol changelog entry
- Test: `packages/server/test/receipt.test.ts` — verify `callId` is always UUID v4 even when client sends one; verify `clientCallId` preserved when sent
- **Note:** `core.test.ts:177` has `receiptVersion: '0.2'` hardcoded — will need updating

**Dependencies:** Types package bump (minor), server receipt construction, core test update, RFC document creation

---

### Finding 3 — Token comparison not constant-time (VERIFIED)

**Plan claim:** `tokens.includes(token)` is timing-attackable.

**Code:** `packages/server/src/middleware.ts:20-24`
```typescript
export function buildVerify(config: AuthConfig): (token: string) => boolean {
  return (
    config.verify ?? ((token: string) => (config.tokens ?? []).includes(token))
  )
}
```

**Verdict:** EXACT MATCH. `String.prototype.includes()` compares byte-by-byte and short-circuits on first mismatch, leaking token length and prefix via timing. `config.verify` custom functions may have the same problem.

**What needs to change:**
- Import `timingSafeEqual` from `node:crypto` (already imported for `randomUUID`)
- Replace `.includes()` with SHA-256 hash of both sides + `timingSafeEqual`
- Pattern: `hash(supplied) → hash(expected) → timingSafeEqual` prevents length leak
- Test: `packages/server/test/middleware.test.ts` — new test that smoke-verifies valid and invalid tokens of varying lengths still resolve correctly (functional smoke, not timing benchmark)

**Dependencies:** None. Self-contained in `middleware.ts`.

---

### Finding 4 — OpenAPI adapter trusts `doc.servers[0].url` (VERIFIED)

**Plan claim:** Adapter falls back to `doc.servers[0].url` without opt-in.

**Code — resolution:** `packages/adapters/openapi/src/index.ts:51-57`
```typescript
export function glyphsFromOpenApi(
  doc: OpenApiDoc,
  options: OpenApiAdapterOptions
): GlyphDefinition<any, any>[] {
  const provider = options.provider ?? doc.info?.title ?? 'openapi'
  const baseUrl = options.baseUrl ?? doc.servers?.[0]?.url    // <-- trusts spec
  if (!baseUrl) {
    throw new Error(
      'OpenAPI adapter requires a baseUrl (or a `servers[]` entry in the document)'
    )
  }
```

**Code — usage:** `packages/adapters/openapi/src/index.ts:263-291`
```typescript
// Inside buildHandler — baseUrl used in fetch:
let url = baseUrl.replace(/\/$/, '') + path
// ...params substituted...
const res = await fetch(url, init)  // SSRF vector if spec is untrusted
```

**Verdict:** EXACT MATCH. If `options.baseUrl` is not provided, the adapter silently uses whatever URL the OpenAPI spec declares. A compromised or malicious spec can redirect server-side requests to internal hosts (SSRF).

Existing test at `openapi.test.ts:403-417` already tests the `servers[0].url` fallback — this test will need updating.

**What needs to change:**
- Add `allowDocumentServerUrl?: boolean` to `OpenApiAdapterOptions` (default `false`)
- Add `allowedHosts?: string[]` to `OpenApiAdapterOptions`
- If `options.baseUrl` is absent AND `allowDocumentServerUrl !== true`: throw with explicit error message including SSRF warning
- If `allowedHosts` is set, validate resolved host against the list before any fetch
- Test: `packages/adapters/openapi/test/baseurl.test.ts` (new):
  - Spec with malicious `servers[0].url` → `assert.throws` by default
  - Same spec with `allowDocumentServerUrl: true` → works
  - `allowedHosts` mismatch → throws
- **This is a MAJOR semver bump for `@glyphp/adapter-openapi`** — existing callers that relied on implicit `servers[0].url` will break

**Dependencies:** Self-contained in `packages/adapters/openapi`. Requires changeset with major bump note.

---

### Finding 5 — Body size + schema complexity not bounded (VERIFIED)

**Plan claim:** `readJson()` no size check; AJV no `maxDepth`/`maxProperties`.

**Code — readJson:** `packages/server/src/server.ts:46-52`
```typescript
async function readJson<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T    // No Content-Length check
  } catch {
    throw new MalformedJsonError()
  }
}
```

**Code — AJV creation:** `packages/core/src/json-schema-validator.ts:44-48`
```typescript
const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  coerceTypes: false,
  // No maxDepth, no maxProperties, no schema complexity limit
})
addFormats(ajv)
```

**Verdict:** EXACT MATCH. `readJson()` has no size limit — an attacker can send a multi-GB JSON body. The AJV instance compiles schemas without any complexity guard — an adversarial schema (e.g., deeply nested `$ref` from an untrusted OpenAPI spec) can cause exponential compile time or stack overflow.

**What needs to change:**

*Part A — Body size limit:*
- Add `MAX_BODY_BYTES` constant (default 1 MiB, overridable via `options.maxBodyBytes` in constructor)
- In `readJson()`: check `Content-Length` header before parsing → `413 PAYLOAD_TOO_LARGE` if exceeded
- Fallback: if `Content-Length` absent, read stream with byte counter
- Add `PAYLOAD_TOO_LARGE` error code to `errors.ts`
- Test: `packages/server/test/runtime.test.ts` — POST with 2 MiB body → 413

*Part B — Schema complexity guard:*
- Add `maxSchemaNodes` (default `1000`) and `maxSchemaDepth` (default `32`) checks in `compileJsonSchema()`
- Before passing to AJV, recursively walk the schema object counting nodes and tracking depth
- Reject with `SCHEMA_TOO_COMPLEX` error (throw a specific error, caught by server)
- Test: `packages/core/test/json-schema-validator.test.ts` (new):
  - Schema with 2000 nodes → `SCHEMA_TOO_COMPLEX`
  - Schema with 50 levels of nested `$ref` → `SCHEMA_TOO_COMPLEX`

**Dependencies:** 
- Part A: `errors.ts` (new error code), server constructor opts
- Part B: Self-contained in `compileJsonSchema()`. Note: the function currently catches malformed schemas and degrades to `z.unknown()` silently — the complexity rejection should be a separate guard before that catch block.

---

## Affected Areas

### Code files to modify

| File | Findings | Changes |
|------|----------|---------|
| `packages/server/src/server.ts` | #1, #2, #5A | Add `MAX_PENDING_CONFIRMATIONS`, unconditional sweep, backlog full rejection; always-generate `callId`, preserve `clientCallId`; `Content-Length` check in `readJson()`; new constructor options |
| `packages/server/src/middleware.ts` | #3 | Replace `.includes()` with SHA-256 + `timingSafeEqual` |
| `packages/adapters/openapi/src/index.ts` | #4 | Add `allowDocumentServerUrl`, `allowedHosts` to options; throw on implicit `servers[0].url` |
| `packages/core/src/json-schema-validator.ts` | #5B | Add schema node/depth traversal before AJV compilation |
| `packages/types/src/types.ts` | #2 | Add optional `clientCallId?: string` to `CallReceipt` |
| `packages/server/src/errors.ts` | #1, #5A | Add `CONFIRMATION_BACKLOG_FULL`, `PAYLOAD_TOO_LARGE` error codes |

### Documentation files to modify/create

| File | Finding | Action |
|------|---------|--------|
| `spec/rfcs/RFC-0005-receipt-callid.md` | #2 | CREATE — documents receipt v0.3, `clientCallId` semantics |
| `spec/protocol.md` | #2 | UPDATE — add receipt version 0.3 to §8 |
| `CHANGELOG-PROTOCOL.md` | #2 | UPDATE — add wire-protocol entry for receipt 0.3 |
| `CODEOWNERS` | Hygiene | CREATE |
| `.github/dependabot.yml` | Hygiene | CREATE |
| `.github/PULL_REQUEST_TEMPLATE.md` | Hygiene | CREATE |
| `ARCHITECTURE.md` | Hygiene | CREATE |
| `docs/threat-to-tests.md` | Hygiene | CREATE |

### Test files to create/modify

| File | Findings | Action |
|------|----------|--------|
| `packages/server/test/confirmation.test.ts` | #1 | ADD test: 10_001 tickets → 503 |
| `packages/server/test/receipt.test.ts` | #2 | ADD test: server-generated UUID v4 always; `clientCallId` preserved |
| `packages/server/test/middleware.test.ts` | #3 | ADD test: constant-time smoke (valid/invalid, varied lengths) |
| `packages/adapters/openapi/test/baseurl.test.ts` | #4 | CREATE: SSRF rejection by default, opt-in, allowedHosts |
| `packages/server/test/runtime.test.ts` | #5A | ADD test: 2 MiB body → 413 |
| `packages/core/test/json-schema-validator.test.ts` | #5B | CREATE: node/depth complexity rejection |
| `packages/core/test/core.test.ts` | #2 | UPDATE: `receiptVersion: '0.2'` → `'0.3'` on line 177 |

---

## Codebase Patterns to Reuse

### 1. Sweep + limit pattern from `rateLimitMiddleware`

`packages/server/src/middleware.ts:51-77` already implements a sweep-then-reject pattern with `Retry-After`:
```typescript
// middleware.ts:59-63 — sweep
if (hits.size > 5000) {
  for (const [key, entry] of hits) {
    if (now >= entry.resetAt) hits.delete(key)
  }
}
// middleware.ts:71-73 — reject with Retry-After
if (entry.count > config.max) {
  c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
  return errorResponse(c, 429, 'RATE_LIMITED', 'Too many requests')
}
```

For the confirmation backlog, the pattern should be:
- Sweep **unconditionally** (not conditional on `> 1000`)
- After sweep, check size against hard limit
- Return 503 with `Retry-After` header (approximation based on oldest TTL)

### 2. Constructor options pattern

`packages/server/src/server.ts:86-125` already accepts optional config with defaults:
```typescript
constructor(options?: {
  port?: number
  keyPair?: GlyphKeyPair
  auth?: AuthConfig
  rateLimit?: RateLimitConfig
  callTimeoutMs?: number
  onCall?: (receipt: CallReceipt) => void
  keyRegistry?: KeyRegistrySource
  policy?: PolicyResolver
}) {
  this.port = options?.port ?? 3100
  this.auth = options?.auth
  // ...
```

Two new options to add: `maxPendingConfirmations?: number`, `maxBodyBytes?: number`.

### 3. RFC document format

`spec/rfcs/RFC-0004-import-clients.md` shows the standard format:
```markdown
# RFC-0004 — Title
Status: accepted (V1 partial).
Author: Patrick Espino.
Date: 2026-05-24.

## Summary
...
```

### 4. Test patterns

All tests use `node:test` + `node:assert/strict` + inline `GlyphServer` construction:
```typescript
const server = new GlyphServer({ /* options */ })
server.register(myGlyph)
const res = await server.fetch(new Request('http://glyph/...', { ... }))
assert.equal(res.status, 200)
```

The `hardening.test.ts` shows the pattern for testing constructor options (auth + rateLimit).

### 5. Error code registration

`packages/server/src/errors.ts:5-18` defines all error codes as a union type. New codes (`CONFIRMATION_BACKLOG_FULL`, `PAYLOAD_TOO_LARGE`) must be added here, plus any documentation in `spec/protocol.md §7`.

---

## Dependencies Between Fixes

```
Finding 1 (confirmations) ──┐
  depends on: errors.ts     │
  blocks: nothing           │
                            │
Finding 2 (callId) ─────────┤
  depends on: types.ts,     │
              server.ts:36  │
  blocks: RFC-0005,         │
          CHANGELOG-PROTOCOL│
                            ├── All independent of each other.
Finding 3 (token timing) ───┤    No fix blocks another.
  depends on: nothing       │    Implement in any order.
  blocks: nothing           │
                            │
Finding 4 (OpenAPI baseUrl)─┤
  depends on: nothing       │
  blocks: nothing           │
  NOTE: MAJOR bump          │
                            │
Finding 5A (body size) ─────┤
  depends on: errors.ts     │
  blocks: nothing           │
                            │
Finding 5B (schema limit) ──┘
  depends on: nothing
  blocks: nothing
```

**Parallel implementation is safe.** The fixes touch different modules with no code overlap except:
- Finding #1 and #5A both add entries to `errors.ts` — a minor merge dependency
- Finding #2 touches `server.ts:36` (RECEIPT_VERSION) and `core.test.ts:177` (hardcoded receipt version) — but these don't conflict with other fixes

---

## Risks and Surprises Not in the Plan

### Surprise 1: `packages/types/src/receipt.ts` does not exist
The plan references a file that doesn't exist in the codebase. All receipt types are in `packages/types/src/types.ts`. No functional impact — just a file path correction.

### Surprise 2: `core.test.ts` hardcodes `receiptVersion: '0.2'`
Line 177 of `packages/core/test/core.test.ts` has:
```typescript
const base: Omit<CallReceipt, 'signature'> = {
  receiptVersion: '0.2',  // <-- will need bump to '0.3'
```
After bumping `RECEIPT_VERSION` in server.ts and adding `clientCallId` to `CallReceipt`, this test fixture needs updating too. The plan didn't mention this.

### Surprise 3: PROTOCOL_VERSION is already `1.0`, not `0.2`
The plan mentions wire protocol `0.2` in context, but the actual `PROTOCOL_VERSION` constant is `'1.0'` (stable line). The receipt version (`0.2` → `0.3`) is a **receipt format version**, not the wire protocol version. These are independent — the plan's semantics are correct but the terminology could confuse if someone conflates `PROTOCOL_VERSION` with `RECEIPT_VERSION`.

### Surprise 4: `compileJsonSchema` silently degrades on error
Current behavior at `json-schema-validator.ts:52-57`:
```typescript
try {
  validate = ajv.compile(schema as object)
} catch {
  return z.unknown()  // silently swallows bad schemas
}
```
The plan's complexity guard should run **before** this try/catch, not replace it. The silent degradation for genuinely malformed schemas is a separate concern (and arguably a bug itself, but out of scope for this audit fix).

### Risk 1: OpenAPI MAJOR bump will break existing consumers
Finding #4 changes `allowDocumentServerUrl` default from implicit-true to explicit-false. Anyone currently calling `glyphsFromOpenApi(doc, {})` without `baseUrl` will get a runtime error. This is the correct security posture but requires clear changelog communication and a migration guide.

### Risk 2: Timing-safe comparison impacts auth performance marginally
SHA-256 hashing of every token on every request adds overhead. For token lists of typical size (< 100 tokens), the impact is negligible. For token lists in the thousands, consider adding `config.verify` as a custom function that uses a `Set` or `Map` for O(1) lookup if timing attacks aren't a concern in that deployment.

### Risk 3: Schema complexity walk may reject legitimate schemas
The 1000-node / 32-depth thresholds are heuristics. A complex but legitimate JSON Schema (e.g., an OpenAPI spec with many types) could exceed these. The thresholds should be documented as overridable, and the error message should include actual vs. limit counts to help operators adjust.

---

## Ready for Proposal

**Yes.** All five findings are verified against real code. The plan is accurate with two minor corrections (file path for types, core test fixture). No blocking unknowns. Proceed to `sdd-propose`.
